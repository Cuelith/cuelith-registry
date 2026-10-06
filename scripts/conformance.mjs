// Prova ogni plugin del catalogo con la suite di conformita' del nucleo:
// scarica l'ultima versione di ognuno, verifica l'impronta e lancia le prove.
//   node scripts/conformance.mjs --cli <cuelith-core>/apps/conformance/dist/cli.js --core 0.3.1 [--only id]
// Esito: 0 se nessun plugin e' "non conforme". Un plugin fuori dall'intervallo del nucleo
// e' segnalato come "fuori intervallo" (obsoleto per questa versione), non come errore.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cli = opt("--cli");
const core = opt("--core");
const only = opt("--only");
if (cli === undefined || core === undefined) {
  console.error("Uso: node scripts/conformance.mjs --cli <cli.js> --core <versione> [--only <id>]");
  process.exit(2);
}

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const work = join(tmpdir(), `cuelith-matrix-${String(Date.now())}`);
mkdirSync(work, { recursive: true });

const rows = [];
for (const file of readdirSync(join(root, "plugins")).filter((f) => f.endsWith(".json")).sort()) {
  const entry = JSON.parse(readFileSync(join(root, "plugins", file), "utf8"));
  if (only !== undefined && entry.id !== only) continue;
  const latest = entry.versions?.[0];
  const row = { id: entry.id, version: latest?.version ?? "-", result: "", detail: "" };
  rows.push(row);
  if (latest === undefined) {
    row.result = "non conforme";
    row.detail = "nessuna versione";
    continue;
  }
  try {
    const response = await fetch(latest.url);
    if (!response.ok) throw new Error(`download ${String(response.status)}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(data).digest("hex") !== latest.sha256) {
      throw new Error("l'impronta del pacchetto non coincide con quella del registro");
    }
    const path = join(work, `${entry.id}-${latest.version}.cpkg`);
    writeFileSync(path, data);
    const run = spawnSync(process.execPath, [cli, path, "--core", core, "--json", "--seconds", "3"], {
      encoding: "utf8",
      timeout: 240_000,
    });
    const report = JSON.parse(run.stdout);
    const errors = report.findings.filter((f) => f.level === "error");
    const outOfRange = errors.length > 0 && errors.every((f) => f.id === "compat-range");
    row.result = report.ok ? "conforme" : outOfRange ? "fuori intervallo" : "non conforme";
    row.detail = errors.map((f) => `${f.id}: ${f.message}`).join(" | ").slice(0, 300);
  } catch (error) {
    row.result = "non conforme";
    row.detail = error instanceof Error ? error.message : String(error);
  }
}

const table = [
  `Nucleo ${core}`,
  "",
  "| Plugin | Versione | Esito | Dettaglio |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${r.version} | ${r.result} | ${r.detail.replaceAll("|", "/")} |`),
].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
process.exit(rows.some((r) => r.result === "non conforme") ? 1 : 0);
