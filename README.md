# cuelith-registry

L'elenco dei moduli che Cuelith mostra nel **Marketplace**.

Cuelith legge `https://cuelith.github.io/cuelith-registry/index.json`, mostra i moduli compatibili con la versione installata e scarica i pacchetti dalle GitHub Releases dei repository dei moduli. Prima di installarli ne verifica l'impronta SHA-256.

## Come si pubblica un modulo

1. Nel repository del modulo si crea una release con il pacchetto `<id>-<versione>.cpkg`: uno zip con `cuelith-plugin.json` nella radice.
2. Qui si apre una pull request che aggiunge o aggiorna `plugins/<id>.json` e l'icona `plugins/<id>.svg` (schema: [`registry-plugin-1.json`](https://github.com/Cuelith/cuelith-sdk/blob/main/schema/registry-plugin-1.json)). Le versioni vanno dalla più recente alla più vecchia.
3. La CI controlla tutto e rifiuta la proposta se:
   - il file non è valido o l'id è già usato;
   - il pacchetto non si scarica, oppure dimensione o impronta SHA-256 non corrispondono;
   - il manifest del pacchetto dichiara id, versione, famiglia, compatibilità o **permessi** diversi da quelli scritti qui;
   - manca l'**icona**, non è un SVG semplice (niente script o risorse esterne), è diversa da quella del pacchetto o è **identica a quella di un altro modulo**: ogni modulo ha la sua.
4. Quando la pull request entra in `main`, l'indice viene pubblicato su GitHub Pages.

I moduli dell'organizzazione Cuelith sono segnati `"verified": true`. Gli altri compaiono come "non verificati", con un avviso prima di installarli.

## Comandi

```bash
pnpm install
pnpm validate          # controllo completo (scarica i pacchetti)
pnpm validate:offline  # solo i file, senza scaricare
pnpm build             # dist/index.json
```

Serve `cuelith-sdk` affiancato e compilato (`../cuelith-sdk`).
