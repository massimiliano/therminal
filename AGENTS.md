# Repository Guidelines

## Project Structure & Module Organization
`main.js` owns the Electron main process: window creation, PTY lifecycle, IPC handlers, presets, and saved sessions. `preload.js` exposes the safe `launcherAPI` bridge. The renderer lives in `src/` with `index.html`, `renderer.js`, `styles.css`, and focused ES modules in `src/modules/` such as `session.js`, `workspace.js`, `wizard.js`, and `service-status.js`. Build helpers live at the root in `after-pack.js` and `build.bat`. Treat `dist/` as generated output.

## Build, Test, and Development Commands
Use `npm start` or `npm run dev` to launch the app locally. Run `npm run rebuild-pty` after Electron upgrades or when `node-pty` stops loading. Use `npm run build` to create the Windows NSIS installer in `dist/`. On Windows machines with Visual Studio Build Tools, `build.bat` runs the rebuild and package flow end to end.

## Coding Style & Naming Conventions
Use 2-space indentation, semicolons, and double quotes. Keep root Electron files in CommonJS and renderer files in ES module style. Prefer small single-purpose modules over large cross-cutting files. Use lowercase kebab-case for renderer module filenames such as `session-state.js` and `usage-panel.js`, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for top-level constants.

## Testing Guidelines
There is no automated test or lint script yet. For each change, run a manual Windows smoke test with `npm start` and verify the affected flow: session launch, resizing, provider selection, presets, saved sessions, and export or log features if touched. If you add tests later, place them under `tests/` and use `*.test.js` naming.

## Commit & Pull Request Guidelines
Recent commits use short imperative subjects such as `Fix release workflow publish step` and `Align project metadata with repo rename`. Follow that style. Pull requests should include a concise summary, manual test notes, related issues, and screenshots or recordings for UI changes. Call out packaging, release, or native-module impacts explicitly.

## Security & Release Notes
Do not hardcode secrets, tokens, or machine-specific paths. Keep provider commands configurable and validate user-supplied paths before spawning shells. Preserve the preload boundary instead of exposing raw Node or Electron APIs to the renderer. GitHub releases are built from `.github/workflows/release.yml`; tag versions as `v*` after updating `package.json`.
