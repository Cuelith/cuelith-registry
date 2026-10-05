// Unisce i file di plugins/ negli indici pubblicati su GitHub Pages, che
// Cuelith legge per mostrare il marketplace. Si esegue dopo validate.mjs.
//
// Due indici (decisione 0013):
// - index.json (schema 1): solo i plugin gratuiti e solo i campi che i
//   programmi gia' installati conoscono. Un programma vecchio rifiuta un
//   indice con campi nuovi, quindi questo file non cambia forma.
// - index-2.json (schema 2): tutti i plugin, anche a pagamento, coi campi nuovi.
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

const files = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
const plugins = [];
for (const file of files) {
  const plugin = JSON.parse(await readFile(join(dir, file), "utf8"));
  // L'icona (controllata da validate.mjs) viaggia nell'indice: il marketplace
  // la mostra prima di installare, senza altre richieste.
  const icon = await readFile(join(dir, `${plugin.id}.svg`));
  plugins.push({ ...plugin, icon: `data:image/svg+xml;base64,${icon.toString("base64")}` });
}
const byName = (a, b) => a.name.localeCompare(b.name, "it");
const generatedAt = new Date().toISOString();

/** Campi nati con lo schema 2: l'indice 1 non li porta. */
const NEW_FIELDS = ["access", "price", "checkoutUrl", "licensing", "authorKey"];
const legacy = plugins
  .filter((plugin) => (plugin.access ?? "free") === "free")
  .map((plugin) => Object.fromEntries(Object.entries(plugin).filter(([k]) => !NEW_FIELDS.includes(k))));

// parse() serve solo a controllare: aggiunge i valori predefiniti (access), che
// nell'indice 1 non devono comparire, quindi si scrive l'oggetto originale.
const v1 = { schema: 1, generatedAt, plugins: legacy.sort(byName) };
const v2 = {
  schema: 2,
  generatedAt,
  plugins: plugins.map((plugin) => ({ ...plugin, access: plugin.access ?? "free" })).sort(byName),
};
RegistryIndexSchema.parse(v1);
RegistryIndexSchema.parse(v2);
await mkdir(out, { recursive: true });
await writeFile(join(out, "index.json"), `${JSON.stringify(v1)}\n`);
await writeFile(join(out, "index-2.json"), `${JSON.stringify(v2)}\n`);
console.log(`index.json con ${v1.plugins.length} plugin gratuiti, index-2.json con ${v2.plugins.length} plugin.`);
