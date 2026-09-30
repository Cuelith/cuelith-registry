# cuelith-registry

Registry dei moduli di Cuelith (cap. 13 e 26 del documento di progetto in `cuelith-docs`, decisione 0004).

- Un file per modulo in `plugins/<id>.json`, validato con `RegistryPluginSchema` di `@cuelith/protocol` (SDK affiancato in `../cuelith-sdk`).
- `scripts/validate.mjs`: file, id unici, e per ogni versione pacchetto scaricabile con dimensione, SHA-256 e manifest (id, versione, famiglia, engines, permessi) coerenti. `--offline` salta i download.
- `scripts/build-index.mjs`: `dist/index.json` pubblicato su GitHub Pages dalla workflow `pages.yml`, solo da `main`.
- Lavoro su `dev`; `main` = indice pubblicato.
