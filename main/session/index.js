const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BrowserWindow } = require("electron");
const pty = require("node-pty");

const { PROVIDERS } = require("../constants");
const { assertProviderAvailable } = require("../providers");

const sessionMap = new Map();

function getPreferredShell() {
  if (process.platform === "win32") {
    const pwshPath = path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "PowerShell",
      "7",
      "pwsh.exe"
    );

    if (fs.existsSync(pwshPath)) {
      return pwshPath;
    }

    return "powershell.exe";
  }

  return process.env.SHELL || (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
}

function getShellArgs(command) {
  const hasCommand = typeof command === "string" && command.trim().length > 0;

  if (process.platform === "win32") {
    if (!hasCommand) return ["-NoLogo", "-NoExit"];
    return ["-NoLogo", "-NoExit", "-Command", command];
  }

  if (!hasCommand) return [];
  return ["-lc", command];
}

function closeAllSessions(onSessionsChanged = () => {}) {
  for (const [id, session] of Array.from(sessionMap.entries())) {
    try {
      session.pty.kill();
    } catch {
      // Ignore process teardown failures at shutdown.
    }
    sessionMap.delete(id);
  }
  onSessionsChanged();
}

function sanitizeSessionPayload(payload = {}) {
  const provider = PROVIDERS[payload.provider] ? payload.provider : "codex";
  const defaultCommand = PROVIDERS[provider].defaultCommand;
  const command =
    typeof payload.command === "string" && payload.command.trim().length > 0
      ? payload.command.trim()
      : defaultCommand;

  const requestedCwd =
    typeof payload.cwd === "string" && payload.cwd.trim().length > 0 ? payload.cwd.trim() : ".";
  const cwd = path.resolve(requestedCwd);

  if (!fs.existsSync(cwd)) {
    throw new Error(`La directory non esiste: ${cwd}`);
  }

  assertProviderAvailable(provider);

  return { provider, command, cwd };
}

function getLatestActiveSession(provider) {
  const sessions = Array.from(sessionMap.values());
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    if (sessions[i].provider === provider) {
      return sessions[i];
    }
  }
  return null;
}

function registerSessionIpcHandlers(ipcMain, { onSessionsChanged = () => {} } = {}) {
  ipcMain.handle("session:create", (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      throw new Error("Finestra non disponibile.");
    }

    const { provider, command, cwd } = sanitizeSessionPayload(payload);
    const sessionId = crypto.randomUUID();
    const ptyProcess = pty.spawn(getPreferredShell(), getShellArgs(command), {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd,
      env: process.env
    });

    sessionMap.set(sessionId, {
      pty: ptyProcess,
      provider,
      command,
      cwd,
      webContents: event.sender
    });
    onSessionsChanged();

    ptyProcess.onData((data) => {
      const session = sessionMap.get(sessionId);
      if (!session || session.webContents.isDestroyed()) {
        return;
      }
      session.webContents.send("session:data", {
        id: sessionId,
        data
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const session = sessionMap.get(sessionId);
      if (!session) {
        return;
      }

      if (!session.webContents.isDestroyed()) {
        session.webContents.send("session:exit", {
          id: sessionId,
          exitCode,
          signal
        });
      }

      sessionMap.delete(sessionId);
      onSessionsChanged();
    });

    return {
      id: sessionId,
      provider,
      command,
      cwd
    };
  });

  ipcMain.on("session:write", (_event, payload) => {
    const session = sessionMap.get(payload?.id);
    if (!session || typeof payload?.data !== "string") {
      return;
    }

    session.pty.write(payload.data);
  });

  ipcMain.on("session:resize", (_event, payload) => {
    const session = sessionMap.get(payload?.id);
    if (!session) {
      return;
    }

    const cols = Number(payload?.cols);
    const rows = Number(payload?.rows);

    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) {
      return;
    }

    try {
      session.pty.resize(cols, rows);
    } catch {
      // Ignore transient resize errors (usually during fast DOM reflow).
    }
  });

  ipcMain.on("session:close", (_event, payload) => {
    const session = sessionMap.get(payload?.id);
    if (!session) {
      return;
    }

    try {
      session.pty.kill();
    } catch {
      // Ignore forced shutdown failures.
    }

    sessionMap.delete(payload.id);
    onSessionsChanged();
  });

  ipcMain.on("session:close-all", () => {
    closeAllSessions(onSessionsChanged);
  });
}

module.exports = {
  closeAllSessions,
  getLatestActiveSession,
  getPreferredShell,
  getSessionMap: () => sessionMap,
  getShellArgs,
  registerSessionIpcHandlers
};
