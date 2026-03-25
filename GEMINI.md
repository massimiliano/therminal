# Therminal

## Overview del Progetto
Therminal è un launcher multi-sessione per CLI AI (Claude, Codex, Gemini e Terminale standard) ottimizzato per Windows. Permette di avviare e gestire sessioni parallele tramite un'interfaccia utente basata su tab e grid, utilizzando terminali embedded ridimensionabili.

**Stack Tecnologico:**
- **Core:** Electron, Node.js
- **Terminale:** node-pty, xterm.js (con addon: fit, web-links, search)
- **Frontend:** HTML5, Vanilla JavaScript (ES Modules), Tailwind CSS (tramite CDN e `tailwind-config.js` locale)
- **Build:** electron-builder, electron-rebuild

## Build e Avvio
I comandi principali definiti in `package.json` sono:

- **Installazione dipendenze:** `npm install`
- **Avvio in sviluppo:** `npm start` (o `npm run dev`)
- **Build eseguibile (Windows):** `npm run build`
- **Rebuild modulo nativo:** `npm run rebuild-pty` (necessario su Windows in caso di errori ABI con `node-pty`, richiede Visual Studio Build Tools)

## Convenzioni di Sviluppo e Architettura

1. **Architettura Frontend (Vanilla JS):** Il frontend non utilizza framework (come React o Vue). Tutta la logica della UI è gestita tramite Vanilla JavaScript suddiviso in moduli all'interno di `src/modules/` e orchestrata da `src/renderer.js`.
2. **Styling:** Lo stile è gestito interamente tramite Tailwind CSS. La configurazione custom di Tailwind (colori, font) si trova in `src/tailwind-config.js` e viene applicata runtime tramite script in `src/index.html`.
3. **Comunicazione IPC:** La comunicazione tra il processo principale (`main.js`) e l'interfaccia grafica avviene tramite IPC (`ipcMain` / `ipcRenderer` via `preload.js`).
4. **Gestione Processi:** La creazione dei processi dei terminali è affidata a `node-pty` in `main.js`. Assicurarsi di gestire correttamente la chiusura dei processi per evitare memory leak o processi orfani.
5. **Aggiunta Provider:** I provider CLI (es. `claude`, `codex`, `gemini`) sono definiti staticamente in `main.js` nell'oggetto `PROVIDERS`. Per aggiungere un nuovo provider di base, modificare tale configurazione.

## Regole di Contribuzione (Global Context)
Nel contribuire a questo progetto, rispetta **sempre** le seguenti direttive imposte:
1. Non fornire mai esempi di codice ma codice completo e funzionante (per quanto possibile).
2. Non commentare mai il codice.
3. Se non viene espressamente richiesto, non spiegare il codice.