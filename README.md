# Therminal Launcher

Launcher multi-sessione per CLI AI su Windows con terminali embedded ridimensionabili.

## Cosa fa

- Avvia piu sessioni in parallelo da una singola UI.
- Seleziona provider CLI: `claude`, `codex`, `gemini`.
- Sceglie quanti client aprire (1-12) e il comando da eseguire.
- Usa terminali embedded (`xterm.js`) con resize manuale del singolo pannello.
- Supporta `working directory` configurabile per batch.

## Stack

- Electron
- node-pty
- xterm.js + addon-fit

## Prerequisiti

1. Windows 10/11.
2. Node.js LTS installato.
3. Le CLI AI installate e disponibili in PATH (`claude`, `codex`, `gemini`) in base a quelle che vuoi lanciare.

## Avvio rapido

```bash
npm install
npm start
```

Nota: `node-pty` e un modulo nativo. Se su Windows hai errori ABI o caricamento modulo, esegui `npm run rebuild-pty` (richiede Visual Studio Build Tools).

## Uso

1. Seleziona il provider.
2. Imposta il numero di client.
3. (Opzionale) modifica comando e working dir.
4. Clicca `Avvia`.
5. Ridimensiona ogni terminale trascinando l'angolo in basso a destra della card.

## Personalizzazione provider

I default sono in `main.js`:

- `claude -> claude`
- `codex -> codex`
- `gemini -> gemini`

Puoi cambiare label e comando nell'oggetto `PROVIDERS`.

