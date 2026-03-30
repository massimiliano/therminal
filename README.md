# Therminal

Launcher desktop Windows per orchestrare piu sessioni CLI e pannelli di lavoro da un'unica interfaccia Electron.

Therminal unisce terminali embedded con `xterm.js`, layout workspace ridimensionabili, preset, sessioni salvate, stato servizi, usage panel, voice-to-text e strumenti di handoff per lavorare in parallelo con `Claude`, `Codex`, `Gemini`, terminali classici, `LazyGit` e browser embedded.

## Screenshot

![Home](./screenshot/home.png)

| Home | Workspace |
| --- | --- |
| ![Home overview](./screenshot/home.png) | ![Workspace terminals](./screenshot/terminal.png) |

| Sessioni live | Focus terminale |
| --- | --- |
| ![Terminal grid](./screenshot/terminal.png) | ![Terminal detail](./screenshot/terminal-show.png) |

## Feature principali

### Workspace multi-sessione

- Avvia `1`, `2`, `4`, `8`, `16` o `32` client in parallelo.
- Mescola provider diversi nello stesso workspace.
- Usa workspace multipli con tab separate.
- Imposta una `working directory` comune con input manuale o selettore cartella.
- Aggiungi nuovi pannelli anche dopo l'avvio del workspace.
- Salva e ripristina interi workspace con layout, provider, comandi, task status, handoff e note.

### Provider e pannelli supportati

- `Claude CLI`
- `Codex CLI`
- `Gemini CLI`
- `Terminale` generico
- `LazyGit`
- `Browser` embedded con navigazione interna

Non serve avere tutti i CLI installati. Therminal rileva i binari disponibili nel `PATH`, blocca i provider mancanti e lascia sempre utilizzabili `Terminale` e `Browser`.

### Layout e gestione pannelli

- Split verticali e orizzontali.
- Drag & drop dei pannelli per scambiare posizione o fare nuovi split.
- Resize di righe e colonne con divider trascinabili.
- Focus e massimizzazione del pannello attivo.
- Chiusura e riavvio della singola sessione.
- Aggiunta rapida di pannelli dal toolbar del workspace.
- Supporto a terminali embedded e pannelli browser nello stesso layout.

### Tooling dentro ogni terminale

- Ricerca nel buffer con `@xterm/addon-search`.
- Export del log in file `.log` o `.txt`.
- Link cliccabili nell'output del terminale.
- Paste da clipboard e copia della selezione via menu contestuale.
- Shortcut multilinea `Shift+Enter` per inserire newline senza invio classico.
- Font size regolabile dal toolbar.
- Notifiche di sistema quando una sessione termina in background con errore.

### Stato task e coordinamento

- Ogni pannello ha un task status ciclico: `Todo`, `Running`, `Blocked`, `Done`.
- Il task status viene salvato anche nelle sessioni persistite.
- Toolbar Git con branch e dirty state del workspace attivo.
- Contesto condiviso del workspace con note e handoff strutturato.

### Handoff e shared context

Il pannello `Contesto` permette di mantenere stato condiviso del workspace e inviarlo alle CLI AI aperte.

- Workflow template: `General handoff`, `Spec to implementation`, `Review and fix`, `Debug and recover`.
- Campi strutturati per `Goal`, `Constraints`, `Decisions`, `Next step`, `Summary`.
- Note libere del workspace.
- Acquisizione della selezione dal terminale attivo.
- Acquisizione delle ultime righe dell'output.
- Generazione rapida di un summary dalla sessione attiva.
- Snapshot Git con branch, ahead/behind e lista file modificati.
- Invio del contesto alla sessione AI attiva o a tutte le sessioni AI del workspace.
- Esclusione automatica di `Terminale`, `LazyGit` e `Browser` dall'invio dell'handoff, per non trattare il testo come comandi shell.

### Preset e persistenza

- Preset singoli per configurazioni frequenti.
- Sessioni salvate che possono contenere uno o piu workspace.
- Ripristino completo di provider, layout, working directory, task status e handoff.
- Libreria di preset messaggi riutilizzabili.
- Fino a `5` preset messaggio preferiti mostrati direttamente nell'header del terminale.
- Inserimento rapido dei preset messaggio nel terminale attivo o selezionato.

### Broadcast e operazioni rapide

- Broadcast bar per inviare lo stesso input a tutti i terminali del workspace.
- Modale `Operazioni` per creare e riusare messaggi/prompt standard.
- Iniezione rapida dei messaggi nel terminale focalizzato.

### Voice to text

Therminal puo trascrivere voce nella sessione attiva con push-to-talk.

- Modalita `Whisper locale` tramite `whisper-cli.exe`.
- Warmup automatico con `whisper-server.exe` se presente accanto al binario `whisper-cli`.
- Modalita `Groq cloud` con modelli `whisper-large-v3` e `whisper-large-v3-turbo`.
- Selezione lingua (`it`, `auto`, ecc.).
- Opzione `auto submit` per inviare automaticamente `Enter` dopo la trascrizione.
- Badge di stato voice nel toolbar del workspace.

### Osservabilita e pannelli di stato

- Monitor CPU/RAM live nella top bar.
- Service status panel per:
  - `status.openai.com`
  - `status.claude.com`
  - `aistudio.google.com`
- Usage panel per provider CLI:
  - `Codex`
  - `Gemini`
  - `Claude`
- Refresh manuale e polling periodico dei pannelli di stato.

### Setup provider e sicurezza operativa

- Rilevamento automatico dei CLI installati.
- Banner home per i provider mancanti.
- Refresh del catalogo provider dalla home e dalla modale scorciatoie.
- Selettore parametri inline per i provider supportati.
- Argomenti globali per provider da applicare a tutti i client nel wizard.
- Bridge sicuro `preload.js` invece di esporre Node/Electron direttamente al renderer.

## Provider supportati

| Provider | Tipo | Note |
| --- | --- | --- |
| `Claude CLI` | AI CLI | Argomenti inline e rilevamento disponibilita |
| `Codex CLI` | AI CLI | Argomenti inline e rilevamento disponibilita |
| `Gemini CLI` | AI CLI | Argomenti inline e rilevamento disponibilita |
| `Terminale` | Shell | Sempre disponibile |
| `LazyGit` | Git TUI | Richiede `lazygit` nel `PATH` |
| `Browser` | Embedded webview | URL iniziale configurabile, navigazione interna, apertura esterna |

## Requisiti

### Per usare l'app da installer `.exe`

- Windows 10 o Windows 11
- i CLI che vuoi usare realmente installati nel `PATH`

### Per sviluppo locale

- Windows 10 o Windows 11
- Node.js LTS
- npm
- Visual Studio Build Tools se devi ricompilare `node-pty`

## Avvio rapido

```bash
npm install
npm start
```

Comandi utili:

```bash
npm run dev
npm run rebuild-pty
npm run build
```

## Flusso d'uso

1. Apri Therminal.
2. Seleziona quanti client vuoi avviare.
3. Assegna un provider a ogni client oppure usa le scorciatoie bulk del wizard.
4. Imposta argomenti inline o un comando custom per i provider shell.
5. Scegli la `working directory`.
6. Avvia il workspace.
7. Durante il lavoro puoi aggiungere pannelli, fare split, riordinare il layout, usare broadcast, salvare preset o salvare l'intera sessione.

## Browser embedded

Il provider `Browser` apre un pannello `webview` dentro il workspace.

- URL iniziale configurabile dal wizard o dall'aggiunta rapida al workspace.
- Navigazione `indietro`, `avanti`, `ricarica`.
- Campo URL con apertura diretta.
- Apertura del link nel browser esterno di sistema.
- Supporto a massimizzazione, drag & drop e chiusura come gli altri pannelli.

## Voice to text

### Whisper locale

1. Apri la modale scorciatoie con `Ctrl + /`.
2. Scegli `Local` come provider voice.
3. Imposta il path di `whisper-cli.exe`.
4. Imposta il path del modello `.bin`.
5. Salva la configurazione.
6. In un workspace attivo tieni premuto `Shift + Alt + Z`, parla e rilascia per trascrivere.

Se nello stesso folder di `whisper-cli.exe` e presente anche `whisper-server.exe`, Therminal prova a usarlo per mantenere il modello caricato in memoria e ridurre la latenza delle richieste successive.

### Groq cloud

1. Apri la modale scorciatoie.
2. Scegli `Groq` come provider voice.
3. Inserisci la tua API key.
4. Scegli il modello `whisper-large-v3` oppure `whisper-large-v3-turbo`.
5. Salva la configurazione.
6. Usa la stessa shortcut push-to-talk nella finestra di Therminal.

## Scorciatoie

Shortcut di default:

- `Ctrl + \``: mostra / nasconde la finestra di Therminal
- `Ctrl + /`: apre la modale scorciatoie e info
- `Ctrl + Shift + B`: apre o chiude il broadcast
- `Shift + Alt + Z`: push-to-talk voice to text
- `Ctrl + -`: riduce il font del terminale
- `Ctrl + =`: aumenta il font del terminale
- `Esc`: chiude modali, search bar, broadcast bar e overlay aperti
- `Shift + Enter`: inserisce newline nel terminale senza invio standard

Le shortcut principali sono configurabili dall'interfaccia.

## Dati salvati

Therminal salva nel profilo utente dell'app:

- preset workspace
- sessioni salvate
- configurazione shortcut
- libreria preset messaggi
- configurazione voice

Le sessioni possono includere:

- piu workspace
- layout dei pannelli
- provider e comandi
- working directory
- task status
- shared context / handoff

## Build dell'installer

Per generare il pacchetto Windows NSIS:

```bash
npm run build
```

L'output viene scritto in `dist/`.

## Struttura del progetto

```text
main.js                Electron main process
preload.js             bridge sicuro renderer <-> main
src/index.html         shell UI principale
src/renderer.js        bootstrap del renderer
src/modules/           moduli UI e logica applicativa
after-pack.js          hook di packaging
```

## Risoluzione problemi

### `node-pty` non si carica

Dopo upgrade di Electron o su ambienti Windows nuovi:

```bash
npm run rebuild-pty
```

### Un provider risulta mancante ma e installato

Controlla che il comando sia disponibile nel `PATH` del sistema che lancia l'app:

```powershell
where.exe claude
where.exe codex
where.exe gemini
where.exe lazygit
```

Poi usa `Rileva di nuovo` nell'app.

### La cartella di lavoro non viene trovata

Usa il selettore `Sfoglia` oppure verifica che il path inserito esista davvero sul filesystem locale.

### Il voice locale non parte

Verifica che:

- `whisper-cli.exe` esista davvero nel path configurato
- il modello `.bin` esista ed sia leggibile
- il microfono sia disponibile nella sessione Electron

### Il browser embedded non apre l'URL corretto

Se inserisci un host senza schema, Therminal prova a normalizzarlo:

- `example.com` -> `https://example.com`
- `localhost:3000` -> `http://localhost:3000`

## Stack

- Electron
- node-pty
- xterm.js
- @xterm/addon-fit
- @xterm/addon-search
- @xterm/addon-web-links
- Bootstrap Icons
- Tailwind CSS (via CDN)

## Licenza

MIT
