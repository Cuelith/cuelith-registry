// Controlla ogni modulo del registry (cap. 26): file valido e col nome giusto,
// id unici, e per ogni versione il pacchetto scaricato corrisponde a quanto
// dichiarato (dimensione, impronta SHA-256, manifest con stesso id, versione,
// compatibilita' e permessi). Con --offline salta i download (controllo veloce).
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PluginManifestSchema, RegistryPluginSchema } from "@cuelith/protocol";
import { strFromU8, unzipSync } from "fflate";

const offline = process.argv.includes("--offline");
const dir = join(import.meta.dirname, "..", "plugins");
const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
const seen = new Set();

for (const file of files) {
  let entry;
  try {
    entry = JSON.parse(await readFile(join(dir, file), "utf8"));
  } catch {
    fail(file, "JSON illeggibile");
    continue;
  }
  const parsed = RegistryPluginSchema.safeParse(entry);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fail(file, `${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  const plugin = parsed.data;
  if (file !== `${plugin.id}.json`) fail(file, `il file deve chiamarsi ${plugin.id}.json`);
  if (seen.has(plugin.id)) fail(file, `id ripetuto: ${plugin.id}`);
  seen.add(plugin.id);

  const versions = plugin.versions.map((v) => v.version);
  if (new Set(versions).size !== versions.length) fail(file, "versioni ripetute");

  if (offline) continue;
  for (const version of plugin.versions) {
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
      const entries = unzipSync(data, { filter: (f) => f.name === "cuelith-plugin.json" });
      manifest = PluginManifestSchema.parse(JSON.parse(strFromU8(entries["cuelith-plugin.json"])));
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
console.log(`Registry valido: ${files.length} moduli${offline ? " (senza scaricare i pacchetti)" : ""}.`);
