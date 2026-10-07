// Unisce i file di plugins/ negli indici pubblicati su GitHub Pages, che
// Cuelith legge per mostrare il marketplace. Si esegue dopo validate.mjs.
//
// Due indici (decisione 0013):
// - index.json (schema 1): solo i plugin gratuiti e solo i campi che i
//   programmi gia' installati conoscono. Un programma vecchio rifiuta un
//   indice con campi nuovi, quindi questo file non cambia forma.
// - index-2.json (schema 2): tutti i plugin, anche a pagamento, coi campi nuovi.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RegistryIndexSchema } from "@cuelith/protocol";

const root = join(import.meta.dirname, "..");
// --dir <plugins> e --out <cartella>: per le prove.
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : resolve(process.argv[at + 1]);
};
const dir = arg("--dir", join(root, "plugins"));
const out = arg("--out", join(root, "dist"));
// withdrawn/: plugin tolti dalla vetrina. Non compaiono negli indici, ma la loro
// licenza resta in licenses.json, cosi' chi li ha comprati continua a rinnovarla.
const withdrawnDir = arg("--withdrawn", join(root, "withdrawn"));

// Plugin dormienti (l autore non risponde alle email di verifica): non compaiono negli
// indici, quindi non si installano piu' da nuovi; le copie installate e le licenze
// restano (licenses.json li tiene). L elenco viene dal Worker di verifica; se non
// risponde non si nasconde nulla e la pubblicazione prosegue.
const dormantFile = arg("--dormant-file", undefined);
const DORMANT_URL = "https://liveness-cuelith.lzrhive.it/status.json";
async function loadDormant() {
  try {
    const text = dormantFile
      ? await readFile(dormantFile, "utf8")
      : await (await fetch(DORMANT_URL, { signal: AbortSignal.timeout(8000) })).text();
    const list = JSON.parse(text).dormant;
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch (error) {
    console.warn(`Elenco dei dormienti non disponibile (${error instanceof Error ? error.message : error}): nessun plugin nascosto.`);
    return [];
  }
}
const dormant = new Set(process.argv.includes("--no-dormant") ? [] : await loadDormant());

const files = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
const plugins = [];
// Dove chiedere aiuto per plugin: non entra negli indici (le app li leggono con uno schema rigido).
const supportLinks = {};
for (const file of files) {
  const plugin = JSON.parse(await readFile(join(dir, file), "utf8"));
  // L'icona (controllata da validate.mjs) viaggia nell'indice: il marketplace
  // la mostra prima di installare, senza altre richieste.
  const icon = await readFile(join(dir, `${plugin.id}.svg`));
  const { support, ...rest } = plugin;
  if (support !== undefined) supportLinks[plugin.id] = support;
  plugins.push({ ...rest, icon: `data:image/svg+xml;base64,${icon.toString("base64")}` });
}
const withdrawn = existsSync(withdrawnDir)
  ? await Promise.all(
      (await readdir(withdrawnDir))
        .filter((n) => n.endsWith(".json"))
        .sort()
        .map(async (file) => JSON.parse(await readFile(join(withdrawnDir, file), "utf8"))),
    )
  : [];
const byName = (a, b) => a.name.localeCompare(b.name, "it");
const generatedAt = new Date().toISOString();

/** Campi nati con lo schema 2: l'indice 1 non li porta. */
const NEW_FIELDS = ["access", "price", "checkoutUrl", "licensing", "authorKey"];
const listed = plugins.filter((plugin) => !dormant.has(plugin.id));
const legacy = listed
  .filter((plugin) => (plugin.access ?? "free") === "free")
  .map((plugin) => Object.fromEntries(Object.entries(plugin).filter(([k]) => !NEW_FIELDS.includes(k))));

// parse() serve solo a controllare: aggiunge i valori predefiniti (access), che
// nell'indice 1 non devono comparire, quindi si scrive l'oggetto originale.
const v1 = { schema: 1, generatedAt, plugins: legacy.sort(byName) };
const v2 = {
  schema: 2,
  generatedAt,
  plugins: listed.map((plugin) => ({ ...plugin, access: plugin.access ?? "free" })).sort(byName),
};
RegistryIndexSchema.parse(v1);
RegistryIndexSchema.parse(v2);
// Licenze: tutti i plugin a pagamento, anche ritirati. Lo legge solo il Notaio.
const licenses = {
  schema: 1,
  generatedAt,
  plugins: [...plugins, ...withdrawn]
    .filter((plugin) => plugin.access === "paid" && plugin.licensing !== undefined)
    .map((plugin) => ({ id: plugin.id, licensing: plugin.licensing, withdrawn: withdrawn.includes(plugin) }))
    .sort((a, b) => a.id.localeCompare(b.id)),
};
await mkdir(out, { recursive: true });
await writeFile(join(out, "licenses.json"), `${JSON.stringify(licenses)}\n`);
await writeFile(
  join(out, "support.json"),
  `${JSON.stringify({ schema: 1, support: Object.fromEntries(Object.entries(supportLinks).filter(([id]) => !dormant.has(id)).sort()) })}
`,
);
await writeFile(join(out, "index.json"), `${JSON.stringify(v1)}\n`);
await writeFile(join(out, "index-2.json"), `${JSON.stringify(v2)}\n`);
console.log(`index.json con ${v1.plugins.length} plugin gratuiti, index-2.json con ${v2.plugins.length} plugin (${dormant.size} dormienti nascosti), licenses.json con ${licenses.plugins.length}.`);
