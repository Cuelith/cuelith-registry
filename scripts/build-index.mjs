// Unisce i file di plugins/ nell'index.json pubblicato su GitHub Pages, che
// Cuelith legge per mostrare il marketplace. Si esegue dopo validate.mjs.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RegistryIndexSchema } from "@cuelith/protocol";

const root = join(import.meta.dirname, "..");
const files = (await readdir(join(root, "plugins"))).filter((n) => n.endsWith(".json")).sort();
const plugins = [];
for (const file of files) {
  const plugin = JSON.parse(await readFile(join(root, "plugins", file), "utf8"));
  // L'icona (controllata da validate.mjs) viaggia nell'indice: il marketplace
  // la mostra prima di installare, senza altre richieste.
  const icon = await readFile(join(root, "plugins", `${plugin.id}.svg`));
  plugins.push({ ...plugin, icon: `data:image/svg+xml;base64,${icon.toString("base64")}` });
}

const index = RegistryIndexSchema.parse({
  schema: 1,
  generatedAt: new Date().toISOString(),
  plugins: plugins.sort((a, b) => a.name.localeCompare(b.name, "it")),
});
await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist", "index.json"), `${JSON.stringify(index)}\n`);
console.log(`index.json con ${index.plugins.length} moduli.`);
