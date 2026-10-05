# cuelith-registry

L'elenco dei moduli che Cuelith mostra nel **Marketplace**.

Cuelith legge l'indice pubblicato su GitHub Pages (vedi sotto), mostra i moduli compatibili con la versione installata e scarica i pacchetti dalle GitHub Releases dei repository dei moduli. Prima di installarli ne verifica l'impronta SHA-256.

## Come si pubblica un modulo

1. Nel repository del modulo si crea una release con il pacchetto `<id>-<versione>.cpkg`: uno zip con `cuelith-plugin.json` nella radice.
2. Qui si apre una pull request che aggiunge o aggiorna `plugins/<id>.json` e l'icona `plugins/<id>.svg` (schema: [`registry-plugin-1.json`](https://github.com/Cuelith/cuelith-sdk/blob/main/schema/registry-plugin-1.json)). Le versioni vanno dalla più recente alla più vecchia.
3. La CI controlla tutto e rifiuta la proposta se:
   - il file non è valido o l'id è già usato;
   - il pacchetto non si scarica, oppure dimensione o impronta SHA-256 non corrispondono;
   - il manifest del pacchetto dichiara id, versione, famiglia, compatibilità o **permessi** diversi da quelli scritti qui;
   - manca l'**icona**, non è un SVG semplice (niente script o risorse esterne), è diversa da quella del pacchetto o è **identica a quella di un altro modulo**: ogni modulo ha la sua.
4. Quando la pull request entra in `main`, l'indice viene pubblicato su GitHub Pages.

## Plugin a pagamento (decisione 0013)

Il registry elenca anche plugin a pagamento di terzi. Il progetto **non incassa e non tocca denaro**: la voce rimanda al negozio dell'autore presso un rivenditore registrato (oggi Lemon Squeezy), che incassa, versa l'IVA e gestisce i rimborsi. Campi in più nella voce:

| Campo | Significato |
| --- | --- |
| `access` | `free` (predefinito) o `paid` |
| `price` | prezzo come lo mostra il catalogo, testo libero (il prezzo vero lo dice il negozio) |
| `checkoutUrl` | pagina di acquisto, solo `https` e solo dominio `lemonsqueezy.com` o suoi sottodomini; può contenere un link di affiliazione del progetto (volontario per l'autore) |
| `licensing` | `provider`, `storeId`, `productId`: la chiave si verifica presso il fornitore (i posti per licenza sono 3) |
| `authorKey` | chiave pubblica Ed25519 dell'autore (base64url, 43 caratteri). Con la chiave **ogni versione ha la firma** del pacchetto |

Un plugin `paid` deve avere prezzo, acquisto e licenza; uno `free` non può averli. La firma è Ed25519 su quattro righe (`cuelith-package-v1`, id, versione, impronta SHA-256), costruite da `packageSignatureMessage` in `@cuelith/protocol`; la CI la verifica.

## Due indici

- `index.json` (schema 1): solo i plugin **gratuiti**, solo coi campi di sempre. I programmi già installati (fino alla 0.2.5) rifiutano un indice con campi che non conoscono: questo file non cambia forma.
- `index-2.json` (schema 2): **tutti** i plugin, coi campi nuovi. Lo leggeranno i programmi dalla versione che introduce il marketplace a pagamento.

I moduli dell'organizzazione Cuelith sono segnati `"verified": true`. Gli altri compaiono come "non verificati", con un avviso prima di installarli.

## Comandi

```bash
pnpm install
pnpm validate          # controllo completo (scarica i pacchetti)
pnpm validate:offline  # solo i file, senza scaricare
pnpm build             # dist/index.json e dist/index-2.json
pnpm test              # prove dei controlli e degli indici (voci di prova, senza rete)
```

Serve `cuelith-sdk` affiancato e compilato (`../cuelith-sdk`).
