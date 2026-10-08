// Controlla ogni modulo del registry (cap. 26): file valido e col nome giusto,
// id unici, e per ogni versione il pacchetto scaricato corrisponde a quanto
// dichiarato (dimensione, impronta SHA-256, manifest con stesso id, versione,
// compatibilita' e permessi). Con --offline salta i download (controllo veloce).
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  COVER_MAX_BYTES,
  packageSignatureMessage,
  PluginManifestSchema,
  RegistryPluginSchema,
} from "@cuelith/protocol";
import { strFromU8, unzipSync } from "fflate";

const offline = process.argv.includes("--offline");
// --dir <cartella>: per le prove, al posto di plugins/.
const dirArg = process.argv.indexOf("--dir");
const dir =
  dirArg === -1 ? join(import.meta.dirname, "..", "plugins") : resolve(process.argv[dirArg + 1]);
// --withdrawn <cartella>: i plugin ritirati dalla vetrina (withdrawn/). Restano
// nel registro perche' le licenze gia' vendute continuino a rinnovarsi.
const withdrawnArg = process.argv.indexOf("--withdrawn");
const withdrawnDir =
  withdrawnArg === -1
    ? join(import.meta.dirname, "..", "withdrawn")
    : resolve(process.argv[withdrawnArg + 1]);

// Prefisso DER di una chiave pubblica Ed25519: seguono i 32 byte della chiave.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const authorPublicKey = (authorKey) =>
  createPublicKey({
    key: Buffer.concat([ED25519_SPKI, Buffer.from(authorKey, "base64url")]),
    format: "der",
    type: "spki",
  });
/** Dove chiedere aiuto: pagina https (senza utente@) o mailto:. */
function isSupport(value) {
  return (
    typeof value === "string" &&
    value.length <= 300 &&
    (/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s@]*)?$/i.test(value) ||
      /^mailto:[^\s@,;?]+@[^\s@,;?]+\.[^\s@,;?]+$/i.test(value))
  );
}
const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const listed = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
const withdrawn = existsSync(withdrawnDir)
  ? (await readdir(withdrawnDir)).filter((name) => name.endsWith(".json")).sort()
  : [];
const entries = [
  ...listed.map((file) => ({ file, from: dir, isWithdrawn: false })),
  ...withdrawn.map((file) => ({ file, from: withdrawnDir, isWithdrawn: true })),
];
const seen = new Set();
/** Impronta dell'icona -> id del modulo: ogni modulo ha un'icona sua. */
const icons = new Map();
const MAX_ICON = 40 * 1024;

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
/** Che immagine e' davvero, dai primi byte (non dal nome): "png", "jpeg", "webp" o niente. */
export function imageKind(bytes) {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return undefined;
}

/**
 * Immagine di copertina del registry (plugins/<id>.png|jpg|jpeg|webp), facoltativa (protocollo
 * 1.19): un solo file, entro il limite, e un'immagine vera del formato dichiarato dal nome.
 */
async function checkImage(file, id, dir) {
  const found = IMAGE_EXTS.filter((ext) => existsSync(join(dir, `${id}.${ext}`)));
  if (found.length === 0) return undefined;
  if (found.length > 1) fail(file, "ci sono piu' immagini di copertina: ne serve una sola");
  const ext = found[0];
  const bytes = await readFile(join(dir, `${id}.${ext}`));
  if (bytes.length > COVER_MAX_BYTES) fail(file, `immagine troppo grande (massimo ${COVER_MAX_BYTES} byte)`);
  const kind = imageKind(bytes);
  if (kind === undefined || kind !== (ext === "jpg" ? "jpeg" : ext)) {
    fail(file, `il file ${id}.${ext} non e' un'immagine ${ext === "jpg" ? "jpeg" : ext}`);
  }
  return bytes;
}

/** Icona del registry (plugins/<id>.svg): SVG semplice, senza script ne' risorse esterne. */
async function checkIcon(file, id, dir) {
  let icon;
  try {
    icon = await readFile(join(dir, `${id}.svg`));
  } catch {
    fail(file, `manca l'icona plugins/${id}.svg (obbligatoria, SVG)`);
    return undefined;
  }
  const text = icon.toString("utf8");
  if (icon.length > MAX_ICON) fail(file, `icona troppo grande (massimo ${MAX_ICON} byte)`);
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(text)) fail(file, "l'icona non e' un file SVG");
  if (/<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:)/i.test(text)) {
    fail(file, "l'icona contiene script o risorse esterne");
  }
  const sha = createHash("sha256").update(icon).digest("hex");
  const other = icons.get(sha);
  if (other !== undefined) fail(file, `icona identica a quella di ${other}: ogni modulo ne ha una sua`);
  icons.set(sha, id);
  return icon;
}

for (const { file, from, isWithdrawn } of entries) {
  let entry;
  try {
    entry = JSON.parse(await readFile(join(from, file), "utf8"));
  } catch {
    fail(file, "JSON illeggibile");
    continue;
  }
  // "support" (dove chiedere aiuto) non fa parte dello schema che leggono le app: non va negli
  // indici, solo in support.json (lo legge il sito). Si controlla qui, a parte.
  const { support, ...forSchema } = entry;
  // L'immagine e' un file accanto alla voce (plugins/<id>.png...), non un campo del JSON.
  if (entry.image !== undefined) fail(file, "image: l'immagine e' un file plugins/<id>.png (o jpg, webp), non un campo");
  delete forSchema.image;
  if (support !== undefined && !isSupport(support)) {
    fail(file, "support: serve un indirizzo https:// senza credenziali o un mailto:indirizzo");
  }
  const parsed = RegistryPluginSchema.safeParse(forSchema);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fail(file, `${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  const plugin = parsed.data;
  if (file !== `${plugin.id}.json`) fail(file, `il file deve chiamarsi ${plugin.id}.json`);
  if (seen.has(plugin.id)) fail(file, `id ripetuto: ${plugin.id}`);
  seen.add(plugin.id);

  const icon = await checkIcon(file, plugin.id, from);
  const cover = await checkImage(file, plugin.id, from);

  const versions = plugin.versions.map((v) => v.version);
  if (new Set(versions).size !== versions.length) fail(file, "versioni ripetute");

  // Chiave dell'autore: ogni versione porta la firma del suo pacchetto (id,
  // versione e impronta), verificabile senza scaricare nulla.
  if (plugin.authorKey !== undefined) {
    const key = authorPublicKey(plugin.authorKey);
    for (const version of plugin.versions) {
      const text = packageSignatureMessage(plugin.id, version.version, version.sha256);
      const signature = Buffer.from(version.signature ?? "", "base64url");
      if (!verify(null, Buffer.from(text), key, signature)) {
        fail(`${file} ${version.version}`, "la firma non corrisponde alla chiave dell'autore");
      }
    }
  }

  // I pacchetti dei plugin ritirati non si scaricano: potrebbero non esserci piu'.
  if (offline || isWithdrawn) continue;
  for (const [position, version] of plugin.versions.entries()) {
    const where = `${file} ${version.version}`;
    let data;
    try {
      const response = await fetch(version.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      fail(where, `pacchetto non scaricabile (${error.message})`);
      continue;
    }
    if (data.byteLength !== version.size) fail(where, `dimensione ${data.byteLength}, dichiarata ${version.size}`);
    const sha = createHash("sha256").update(data).digest("hex");
    if (sha !== version.sha256) fail(where, "impronta SHA-256 diversa da quella dichiarata");

    let manifest;
    try {
      const entries = unzipSync(data);
      manifest = PluginManifestSchema.parse(JSON.parse(strFromU8(entries["cuelith-plugin.json"])));
      // L'ultima versione porta l'icona del registry, identica.
      if (position === 0) {
        const packaged = manifest.icon === undefined ? undefined : entries[manifest.icon];
        if (packaged === undefined) fail(where, "il pacchetto non ha l'icona (campo icon del manifest)");
        else if (icon !== undefined && !Buffer.from(packaged).equals(icon)) {
          fail(where, `l'icona del pacchetto e' diversa da plugins/${plugin.id}.svg`);
        }
        // Se il registry ha un'immagine di copertina, e' quella del pacchetto, identica.
        if (cover !== undefined) {
          const image = manifest.image === undefined ? undefined : entries[manifest.image];
          if (image === undefined) fail(where, "il pacchetto non ha l'immagine di copertina (campo image del manifest)");
          else if (!Buffer.from(image).equals(cover)) {
            fail(where, `l'immagine del pacchetto e' diversa da quella di plugins/${plugin.id}`);
          }
        }
      }
    } catch {
      fail(where, "il pacchetto non contiene un manifest valido nella radice");
      continue;
    }
    if (manifest.id !== plugin.id) fail(where, `il manifest dice id ${manifest.id}`);
    if (manifest.version !== version.version) fail(where, `il manifest dice versione ${manifest.version}`);
    if (manifest.family !== plugin.family) fail(where, `il manifest dice famiglia ${manifest.family}`);
    if (!same(manifest.engines, version.engines)) fail(where, "compatibilita' (engines) diversa dal manifest");
    if (!same([...manifest.permissions].sort(), [...version.permissions].sort())) {
      fail(where, "permessi diversi da quelli del manifest");
    }
  }
}

if (errors.length > 0) {
  console.error(`Registry non valido:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(`Registry valido: ${entries.length} moduli${offline ? " (senza scaricare i pacchetti)" : ""}.`);
