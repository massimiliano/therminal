# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Therminal is a multi-session launcher for AI CLI tools (Claude, Codex, Gemini) on Windows, built with Electron. It spawns multiple terminal sessions in parallel from a single UI, using xterm.js for embedded terminals and node-pty for shell process management. Sessions are organized into workspaces with resizable grid layouts, drag-and-drop panel reordering, and a tab bar for switching between workspaces.

## Commands

```bash
npm install          # Install dependencies
npm start            # Launch the Electron app (same as npm run dev)
npm run rebuild-pty  # Rebuild node-pty native module for Electron (requires VS Build Tools)
```

No test framework is configured.

## Architecture

Three-process Electron architecture:

- **main.js** — Main process. Manages app lifecycle, BrowserWindow, PTY spawning (node-pty), and all IPC handlers. Contains `PROVIDERS` (provider definitions), `sessionMap` (active PTY sessions), and IPC endpoints for sessions (`session:create/write/resize/close/close-all`), presets (`presets:list/save/delete`), saved sessions (`sessions:list/save/delete`), dialogs, and shell operations. Presets and saved sessions are persisted as JSON in `app.getPath("userData")`. Registers a global `Ctrl+\`` shortcut for quake-style window toggle.

- **preload.js** — Exposes `launcherAPI` via `contextBridge`. All renderer-to-main communication goes through this API. Uses `ipcRenderer.invoke` for request/response and `ipcRenderer.send` for fire-and-forget (`write`, `resize`, `close`).

- **src/renderer.js** — Bootstrap entry point. Loads providers, initializes modules, and binds events. Thin orchestrator — all logic lives in `src/modules/`.

### Frontend Modules (`src/modules/`)

The renderer is split into focused ES modules. Key dependency: most modules import shared state from `state.js` and DOM references from `dom.js`.

- **state.js** — Single source of truth: xterm constructors, shared maps (`workspaces`, `sessionStore`, `scheduledFit`), mutable `state` object (active view, wizard state, font size, maximize/focus/broadcast state), constants (`GRID_LAYOUTS`, `XTERM_THEME`, `PROVIDER_STYLE`).
- **dom.js** — Cached `getElementById` references for all UI elements. Other modules import `dom` rather than querying the DOM.
- **workspace.js** — `launchWorkspace()` builds a grid of rows/columns with resizable dividers, spawns sessions for each client. `closeWorkspace()` tears down all sessions and removes the grid. `launchWorkspaceFromConfig()` restores a saved workspace.
- **session.js** — `createWorkspaceSession()` creates a PTY session, builds the terminal cell DOM (header with badges/buttons, xterm body), sets up ResizeObserver, drag-and-drop, and per-cell actions (search, export log, maximize, restart, close). `destroySession()` and `restartWorkspaceSession()` handle lifecycle.
- **tabs.js** — Tab bar rendering, view switching between home and workspaces, tab context menu (rename).
- **grid.js** — Mouse-drag handlers for resizable row and column dividers. Tracks flex-ratio sizes in `workspace.rowSizes` / `workspace.colSizes`.
- **events.js** — `bindIpcEvents()` wires up session data/exit IPC listeners. `bindUiEvents()` wires up all home-view UI button handlers.
- **wizard.js** — Step-based UI for choosing session count and provider assignment before launch.
- **presets.js** — Save/load/delete preset configurations (provider + count + cwd combos).
- **session-state.js** — Save/restore full workspace session state (all workspaces with their providers, layout, and cwd).
- **helpers.js** — `queueFit()` (RAF-debounced terminal resize), `refitWorkspace()`, `shortId()`.
- **broadcast.js** — Broadcast mode: type once, send to all sessions simultaneously.
- **maximize.js** — Fullscreen overlay for a single terminal panel.
- **fontsize.js** — Global font size adjustment across all terminals.
- **search.js** — In-terminal text search using xterm SearchAddon.
- **shortcuts.js** — Keyboard shortcuts and shortcuts help modal.

## Key Patterns

- Input sanitization via `sanitizeSessionPayload()` in main.js before any PTY spawn.
- Shell detection is platform-aware: `getPreferredShell()` picks PowerShell 7 on Windows, bash/zsh on Unix.
- Terminal resize uses ResizeObserver + `queueFit()` (requestAnimationFrame debouncing) to avoid layout thrashing.
- Scrollback capped at 6000 lines per terminal.
- All DOM references are centralized in `dom.js` — don't use `document.getElementById` elsewhere.
- All shared mutable state lives in `state.js` — don't create module-local state that should be global.
- UI strings are in Italian (button labels, error messages, tooltips).
- Styling uses Tailwind CSS utility classes (via CDN/build) with CSS custom properties (`--th-*`) for theming in `styles.css`.

## Platform Notes

- Primary target is Windows 10/11. macOS/Linux have fallback shell detection but are not primary.
- node-pty is a native module — ABI mismatches after Electron upgrades require `npm run rebuild-pty`.
