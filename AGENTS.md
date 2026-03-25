# Repository Guidelines

## Project Structure & Module Organization
`main.js` owns the Electron main process: window creation, PTY lifecycle, IPC handlers, presets, and saved sessions. `preload.js` exposes the safe `launcherAPI` bridge. The renderer lives in `src/`: `index.html`, `styles.css`, `renderer.js`, and focused modules under `src/modules/` such as `workspace.js`, `session.js`, and `events.js`. Build helpers sit at the root (`after-pack.js`, `build.bat`). Packaged output goes to `dist/`; treat it as generated and do not edit it manually.

## Build, Test, and Development Commands
Use `npm start` or `npm run dev` to launch the Electron app locally. Use `npm run rebuild-pty` after Electron or Node changes if `node-pty` fails to load. Use `npm run build` to produce a Windows installer in `dist/`. `build.bat` wraps the native rebuild and packaging flow for local Windows builds with Visual Studio tools.

## Coding Style & Naming Conventions
Follow the existing style: 2-space indentation, semicolons, double quotes, and small single-purpose modules. Keep renderer modules in lowercase kebab-case filenames such as `session-state.js` and `cli-options.js`; use `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for top-level constants like `PROVIDERS`. Preserve the current module split: CommonJS in root Electron files, ES modules in `src/`. Prefer extending existing modules instead of adding large cross-cutting files.

## Testing Guidelines
There is currently no automated test suite or lint script in `package.json`. For each change, run a manual smoke test with `npm start` on Windows and verify the impacted flow end to end: session launch, resize, provider selection, presets/saved sessions, and log export when relevant. If you add automated tests later, place them under a dedicated `tests/` directory and name files `*.test.js`.

## Commit & Pull Request Guidelines
Git history is minimal and currently only shows `Initial commit`, so no strong convention is established. Use short imperative commit subjects, for example `Add session restart overlay` or `Fix PTY resize race`. Pull requests should include a brief summary, manual test notes, and screenshots or short recordings for UI changes. Link related issues when applicable and call out packaging or native-module impacts explicitly.

## Security & Configuration Tips
This app launches local CLI tools through `node-pty`. Do not hardcode secrets or machine-specific paths. Keep provider commands configurable, validate user-supplied paths, and preserve the preload IPC boundary instead of exposing raw Electron or Node APIs to the renderer.
