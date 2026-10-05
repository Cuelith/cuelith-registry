# cuelith-registry

Registry dei moduli di Cuelith (cap. 13 e 26 del documento di progetto in `cuelith-docs`, decisione 0004).

- Un file per modulo in `plugins/<id>.json`, validato con `RegistryPluginSchema` di `@cuelith/protocol` (SDK affiancato in `../cuelith-sdk`).
- `scripts/validate.mjs`: file, id unici, e per ogni versione pacchetto scaricabile con dimensione, SHA-256 e manifest (id, versione, famiglia, engines, permessi) coerenti. `--offline` salta i download.
- `scripts/build-index.mjs`: `dist/index.json` (schema 1, solo gratuiti, **mai campi nuovi**: i programmi installati lo rifiutano) e `dist/index-2.json` (schema 2, tutti) pubblicati su GitHub Pages dalla workflow `pages.yml`, solo da `main`. `parse()` dello schema aggiunge `access` predefinito: si scrive l'oggetto originale, non quello parsato.
- Plugin a pagamento e chiave dell'autore (decisione 0013): `validate.mjs` verifica le firme Ed25519 anche offline; `pnpm test` prova controlli e indici con voci di prova (`--dir`, `--out`).
- Lavoro su `dev`; `main` = indice pubblicato.
- Il campo `license` di una voce è quello del pacchetto indicato: Canti 0.5.0 è Apache-2.0; la voce passa a GPL-3.0-or-later quando esce il plugin con licenza GPL (decisione 0012).
