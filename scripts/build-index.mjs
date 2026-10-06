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

const files = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
const plugins = [];
for (const file of files) {
  const plugin = JSON.parse(await readFile(join(dir, file), "utf8"));
  // L'icona (controllata da validate.mjs) viaggia nell'indice: il marketplace
  // la mostra prima di installare, senza altre richieste.
  const icon = await readFile(join(dir, `${plugin.id}.svg`));
  plugins.push({ ...plugin, icon: `data:image/svg+xml;base64,${icon.toString("base64")}` });
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
await writeFile(join(out, "index.json"), `${JSON.stringify(v1)}\n`);
await writeFile(join(out, "index-2.json"), `${JSON.stringify(v2)}\n`);
console.log(`index.json con ${v1.plugins.length} plugin gratuiti, index-2.json con ${v2.plugins.length} plugin, licenses.json con ${licenses.plugins.length}.`);
