// Prove dei controlli e degli indici del registry (decisione 0013), con voci
// di prova in una cartella temporanea: niente rete, niente file veri.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { packageSignatureMessage } from "@cuelith/protocol";

const scripts = join(import.meta.dirname, "..", "scripts");
const temp = mkdtempSync(join(tmpdir(), "cuelith-registry-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const b64url = (data) => Buffer.from(data).toString("base64url");
const newKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const authorKey = b64url(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  return { privateKey, authorKey };
};

let counter = 0;
const icon = (n) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="${n}"/></svg>`;
const SHA = "a".repeat(64);

function version(id, extra = {}) {
  return {
    version: "1.0.0",
    engines: { cuelith: ">=0.2.0 <1.0.0", protocol: "^1.14.0" },
    url: `https://example.com/${id}-1.0.0.cpkg`,
    sha256: SHA,
    size: 1000,
    permissions: [],
    published: "2026-10-05T10:00:00.000Z",
    ...extra,
  };
}
const free = (id, extra = {}) => ({
  id,
  name: `Plugin ${id}`,
  description: "Un plugin.",
  publisher: "Prova",
  license: "MIT",
  repository: "https://github.com/prova/plugin",
  family: "function",
  verified: false,
  versions: [version(id)],
  ...extra,
});
const paid = (id, extra = {}) =>
  free(id, {
    access: "paid",
    price: "9 €",
    checkoutUrl: "https://prova.lemonsqueezy.com/checkout/buy/abc",
    licensing: { provider: "lemonsqueezy", storeId: 1, productId: 2 },
    ...extra,
  });

/** Scrive le voci in una cartella nuova e restituisce il suo percorso. */
function registry(entries) {
  const dir = join(temp, `r${String((counter += 1))}`);
  mkdirSync(dir);
  for (const entry of entries) {
    writeFileSync(join(dir, `${entry.id}.json`), JSON.stringify(entry));
    writeFileSync(join(dir, `${entry.id}.svg`), icon(counter * 100 + entries.indexOf(entry) + 1));
  }
  return dir;
}
const run = (script, args) => {
  // Le prove non vanno in rete: senza un elenco di dormienti proprio, non se ne nasconde nessuno.
  if (script === "build-index.mjs" && !args.includes("--dormant-file")) args = [...args, "--no-dormant"];
  try {
    const out = execFileSync(process.execPath, [join(scripts, script), ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: `${String(error.stdout)}${String(error.stderr)}` };
  }
};
const validate = (dir) => run("validate.mjs", ["--offline", "--dir", dir]);

test("voci gratuite e a pagamento valide passano i controlli", () => {
  const result = validate(registry([free("prova.uno"), paid("prova.due")]));
  assert.equal(result.ok, true, result.out);
});

test("un plugin a pagamento senza licenza, prezzo o acquisto non passa", () => {
  const { licensing: _l, ...noLicensing } = paid("prova.tre");
  const result = validate(registry([noLicensing]));
  assert.equal(result.ok, false);
  assert.match(result.out, /paidNeedsLicensing/);
});

test("la pagina di acquisto deve essere di un negozio ammesso", () => {
  const result = validate(registry([paid("prova.quattro", { checkoutUrl: "https://evil.example/x" })]));
  assert.equal(result.ok, false);
});

test("con la chiave dell'autore: firma giusta passa, firma di un altro o di un'altra versione no", () => {
  const { privateKey, authorKey } = newKey();
  const other = newKey();
  const id = "prova.cinque";
  const sig = (key, v = "1.0.0", sha = SHA) =>
    b64url(sign(null, Buffer.from(packageSignatureMessage(id, v, sha)), key));
  const entry = (signature) =>
    free(id, { authorKey, versions: [version(id, { signature })] });

  assert.equal(validate(registry([entry(sig(privateKey))])).ok, true);

  for (const wrong of [sig(other.privateKey), sig(privateKey, "1.0.1"), sig(privateKey, "1.0.0", "b".repeat(64))]) {
    const result = validate(registry([entry(wrong)]));
    assert.equal(result.ok, false);
    assert.match(result.out, /firma non corrisponde/);
  }
});

test("senza firma ma con la chiave dell'autore la voce e' rifiutata", () => {
  const { authorKey } = newKey();
  const result = validate(registry([free("prova.sei", { authorKey })]));
  assert.equal(result.ok, false);
  assert.match(result.out, /signatureRequired/);
});

test("indici: il primo ha solo i gratuiti e nessun campo nuovo, il secondo ha tutto", () => {
  const { privateKey, authorKey } = newKey();
  const id = "prova.otto";
  const signature = b64url(sign(null, Buffer.from(packageSignatureMessage(id, "1.0.0", SHA)), privateKey));
  const dir = registry([free("prova.sette", { authorKey: undefined }), paid("prova.nove"), free(id, { authorKey, versions: [version(id, { signature })] })]);
  const out = join(temp, `out${String(counter)}`);
  const built = run("build-index.mjs", ["--dir", dir, "--out", out]);
  assert.equal(built.ok, true, built.out);

  const v1 = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
  const v2 = JSON.parse(readFileSync(join(out, "index-2.json"), "utf8"));
  assert.equal(v1.schema, 1);
  assert.deepEqual(v1.plugins.map((p) => p.id).sort(), ["prova.otto", "prova.sette"]);
  // Un programma vecchio rifiuta i campi che non conosce: l'indice 1 non ne porta.
  for (const field of ["access", "price", "checkoutUrl", "licensing", "authorKey"]) {
    assert.equal(JSON.stringify(v1).includes(`"${field}"`), false, field);
  }
  assert.equal(v2.schema, 2);
  assert.equal(v2.plugins.length, 3);
  const paidPlugin = v2.plugins.find((p) => p.id === "prova.nove");
  assert.equal(paidPlugin.access, "paid");
  assert.equal(paidPlugin.licensing.provider, "lemonsqueezy");
  assert.equal(v2.plugins.find((p) => p.id === "prova.sette").access, "free");
  assert.ok(v2.plugins.find((p) => p.id === id).authorKey);
});

test("ritirato: fuori dagli indici, ma la sua licenza resta in licenses.json", () => {
  const dir = registry([free("prova.libero"), paid("prova.visibile")]);
  const gone = join(temp, `w${String(counter)}`);
  mkdirSync(gone);
  const entry = paid("prova.ritirato", { licensing: { provider: "lemonsqueezy", storeId: 7, productId: 8 } });
  writeFileSync(join(gone, "prova.ritirato.json"), JSON.stringify(entry));
  writeFileSync(join(gone, "prova.ritirato.svg"), icon(9999));

  const checked = run("validate.mjs", ["--offline", "--dir", dir, "--withdrawn", gone]);
  assert.equal(checked.ok, true, checked.out);

  const out = join(temp, `outw${String(counter)}`);
  const built = run("build-index.mjs", ["--dir", dir, "--withdrawn", gone, "--out", out]);
  assert.equal(built.ok, true, built.out);
  const v1 = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
  const v2 = JSON.parse(readFileSync(join(out, "index-2.json"), "utf8"));
  const licenses = JSON.parse(readFileSync(join(out, "licenses.json"), "utf8"));
  // Nessuno dei due indici (quelli che leggono i programmi) nomina il ritirato.
  assert.equal(JSON.stringify(v1).includes("prova.ritirato"), false);
  assert.equal(JSON.stringify(v2).includes("prova.ritirato"), false);
  assert.deepEqual(
    licenses.plugins.map((p) => [p.id, p.withdrawn]),
    [["prova.ritirato", true], ["prova.visibile", false]],
  );
  assert.deepEqual(licenses.plugins[0].licensing, { provider: "lemonsqueezy", storeId: 7, productId: 8 });
  // I gratuiti non hanno licenza da rinnovare.
  assert.equal(JSON.stringify(licenses).includes("prova.libero"), false);
});

test("ritirato: stesso id nella vetrina e tra i ritirati e' rifiutato; voce non valida anche", () => {
  const dir = registry([paid("prova.doppio")]);
  const gone = join(temp, `w2${String(counter)}`);
  mkdirSync(gone);
  writeFileSync(join(gone, "prova.doppio.json"), JSON.stringify(paid("prova.doppio")));
  writeFileSync(join(gone, "prova.doppio.svg"), icon(7777));
  const twice = run("validate.mjs", ["--offline", "--dir", dir, "--withdrawn", gone]);
  assert.equal(twice.ok, false);
  assert.match(twice.out, /id ripetuto/);

  const bad = join(temp, `w3${String(counter)}`);
  mkdirSync(bad);
  const { licensing: _l, ...noLicensing } = paid("prova.rotto");
  writeFileSync(join(bad, "prova.rotto.json"), JSON.stringify(noLicensing));
  writeFileSync(join(bad, "prova.rotto.svg"), icon(5555));
  assert.equal(run("validate.mjs", ["--offline", "--dir", registry([free("prova.altro")]), "--withdrawn", bad]).ok, false);
});

test("dormienti: spariscono dai due indici ma restano in licenses.json; un elenco illeggibile non nasconde nulla", () => {
  const dir = registry([free("prova.uno"), free("prova.due"), paid("prova.tre")]);
  const list = join(temp, `dormant${String(counter)}.json`);
  writeFileSync(list, JSON.stringify({ dormant: ["prova.due", "prova.tre", 42] }));
  const out = join(temp, `out-dormant${String(counter)}`);
  const built = run("build-index.mjs", ["--dir", dir, "--out", out, "--dormant-file", list]);
  assert.equal(built.ok, true, built.out);
  const read = (name) => JSON.parse(readFileSync(join(out, name), "utf8"));
  assert.deepEqual(read("index.json").plugins.map((p) => p.id), ["prova.uno"]);
  assert.deepEqual(read("index-2.json").plugins.map((p) => p.id), ["prova.uno"]);
  // Chi ha comprato il plugin dormiente continua a poter rinnovare la licenza.
  assert.deepEqual(read("licenses.json").plugins.map((p) => [p.id, p.withdrawn]), [["prova.tre", false]]);

  const broken = join(temp, `broken${String(counter)}.json`);
  writeFileSync(broken, "non e json");
  const out2 = join(temp, `out-broken${String(counter)}`);
  const again = run("build-index.mjs", ["--dir", dir, "--out", out2, "--dormant-file", broken]);
  assert.equal(again.ok, true, again.out);
  assert.equal(JSON.parse(readFileSync(join(out2, "index.json"), "utf8")).plugins.length, 2);
});
