const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require("electron");
const pty = require("node-pty");

const PROVIDERS = Object.freeze({
  claude: {
    label: "Claude CLI",
    defaultCommand: "claude"
  },
  codex: {
    label: "Codex CLI",
    defaultCommand: "codex"
  },
  gemini: {
    label: "Gemini CLI",
    defaultCommand: "gemini"
  },
  terminal: {
    label: "Terminale",
    defaultCommand: ""
  }
});

const sessionMap = new Map();
let mainWindow = null;

// ─── CPU Metrics ────────────────────────────────────────
let prevCpuInfo = null;

function getCpuTimes() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

function getCpuPercent() {
  const cur = getCpuTimes();
  if (!prevCpuInfo) {
    prevCpuInfo = cur;
    return 0;
  }
  const idleDiff = cur.idle - prevCpuInfo.idle;
  const totalDiff = cur.total - prevCpuInfo.total;
  prevCpuInfo = cur;
  if (totalDiff === 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 100);
}

function getPresetsPath() {
  return path.join(app.getPath("userData"), "presets.json");
}

function getSessionPath() {
  return path.join(app.getPath("userData"), "session.json");
}

function loadPresetsFile() {
  try {
    const p = getPresetsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch {}
  return {};
}

function savePresetsFile(data) {
  fs.writeFileSync(getPresetsPath(), JSON.stringify(data, null, 2), "utf8");
}

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

function closeAllSessions() {
  for (const [id, session] of Array.from(sessionMap.entries())) {
    try {
      session.pty.kill();
    } catch {
      // Ignore process teardown failures at shutdown.
    }
    sessionMap.delete(id);
  }
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

  return { provider, command, cwd };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    show: false,
    icon: path.join(__dirname, "logo.png"),
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.platform !== "darwin") {
    // Remove the native menu so Alt doesn't toggle it on Windows/Linux.
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.maximize();
  mainWindow.show();

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  return mainWindow;
}

app.whenReady().then(() => {
  createMainWindow();

  // Quake-style global toggle: Ctrl+`
  globalShortcut.register("CommandOrControl+`", () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  closeAllSessions();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("providers:list", () => {
  return PROVIDERS;
});

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
});

ipcMain.on("session:close-all", () => {
  closeAllSessions();
});

// ─── Presets ──────────────────────────────────────────────

// ─── Saved Sessions ──────────────────────────────────────

function loadSessionsFile() {
  try {
    const p = getSessionPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch {}
  return {};
}

function saveSessionsFile(data) {
  fs.writeFileSync(getSessionPath(), JSON.stringify(data, null, 2), "utf8");
}

ipcMain.handle("sessions:list", () => loadSessionsFile());

ipcMain.handle("sessions:save", (_event, { name, config }) => {
  const sessions = loadSessionsFile();
  sessions[name] = config;
  saveSessionsFile(sessions);
  return true;
});

ipcMain.handle("sessions:delete", (_event, name) => {
  const sessions = loadSessionsFile();
  delete sessions[name];
  saveSessionsFile(sessions);
  return true;
});

// ─── Presets ──────────────────────────────────────────────

ipcMain.handle("presets:list", () => loadPresetsFile());

ipcMain.handle("presets:save", (_event, { name, config }) => {
  const presets = loadPresetsFile();
  presets[name] = config;
  savePresetsFile(presets);
  return true;
});

ipcMain.handle("presets:delete", (_event, name) => {
  const presets = loadPresetsFile();
  delete presets[name];
  savePresetsFile(presets);
  return true;
});

// ─── Shell & Dialog ───────────────────────────────────────

ipcMain.handle("shell:open-external", (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return shell.openExternal(url);
    }
  } catch {}
  return false;
});

ipcMain.handle("system:metrics", () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    cpuPercent: getCpuPercent(),
    memUsedPercent: Math.round((usedMem / totalMem) * 100),
    memUsedGB: +(usedMem / 1073741824).toFixed(1),
    memTotalGB: +(totalMem / 1073741824).toFixed(1),
  };
});

ipcMain.handle("dialog:save-file", async (event, { defaultFilename, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultFilename,
    filters: [
      { name: "Log files", extensions: ["log", "txt"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, "utf8");
    return result.filePath;
  }
  return null;
});
