const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow, clipboard, dialog, globalShortcut, shell } = require("electron");

const { DEFAULT_SHORTCUTS } = require("../constants");

let mainWindow = null;
let registeredWindowShortcut = null;
let prevCpuInfo = null;

function getProjectRoot() {
  return path.resolve(__dirname, "..", "..");
}

function configureSessionDataPath() {
  if (app.isPackaged) {
    return;
  }

  const sessionDataPath = path.join(
    app.getPath("temp"),
    "therminal-dev-session-data",
    String(process.pid)
  );

  fs.mkdirSync(sessionDataPath, { recursive: true });
  app.setPath("sessionData", sessionDataPath);
}

function createMainWindow() {
  const rootDir = getProjectRoot();

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    show: false,
    icon: path.join(rootDir, "logo.png"),
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(rootDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  if (process.platform !== "darwin") {
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const key = String(input.key || "").toLowerCase();
    const wantsDevTools =
      key === "f12" ||
      ((input.control || input.meta) && input.shift && key === "i");

    if (!wantsDevTools) {
      return;
    }

    event.preventDefault();

    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
      return;
    }

    mainWindow.webContents.openDevTools({ mode: "detach", activate: true });
  });

  mainWindow.maximize();
  mainWindow.show();
  mainWindow.loadFile(path.join(rootDir, "src", "index.html"));
  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

function toggleMainWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }

  mainWindow.show();
  mainWindow.focus();
}

function registerWindowShortcut(accelerator) {
  const normalized =
    typeof accelerator === "string" && accelerator.trim().length > 0
      ? accelerator.trim()
      : DEFAULT_SHORTCUTS.toggleWindow;

  if (registeredWindowShortcut) {
    globalShortcut.unregister(registeredWindowShortcut);
    registeredWindowShortcut = null;
  }

  try {
    if (globalShortcut.register(normalized, () => toggleMainWindowVisibility())) {
      registeredWindowShortcut = normalized;
      return {
        shortcut: normalized,
        warning: ""
      };
    }
  } catch {}

  if (normalized !== DEFAULT_SHORTCUTS.toggleWindow) {
    const fallbackRegistered = globalShortcut.register(DEFAULT_SHORTCUTS.toggleWindow, () =>
      toggleMainWindowVisibility()
    );
    if (fallbackRegistered) {
      registeredWindowShortcut = DEFAULT_SHORTCUTS.toggleWindow;
    }
    return {
      shortcut: DEFAULT_SHORTCUTS.toggleWindow,
      warning: `Shortcut globale non valida: "${normalized}". Ripristinata su ${DEFAULT_SHORTCUTS.toggleWindow}.`
    };
  }

  return {
    shortcut: DEFAULT_SHORTCUTS.toggleWindow,
    warning: `Impossibile registrare la shortcut globale ${DEFAULT_SHORTCUTS.toggleWindow}.`
  };
}

function setupSingleInstanceHandling(shouldEnforceSingleInstance) {
  const hasSingleInstanceLock = !shouldEnforceSingleInstance || app.requestSingleInstanceLock();

  if (shouldEnforceSingleInstance && !hasSingleInstanceLock) {
    return false;
  }

  if (shouldEnforceSingleInstance) {
    app.on("second-instance", () => {
      if (!app.isReady()) {
        return;
      }

      if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
        return;
      }

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }

      mainWindow.focus();
    });
  }

  return true;
}

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

function getExistingDirectory(defaultPath) {
  if (typeof defaultPath !== "string" || defaultPath.trim().length === 0) {
    return undefined;
  }

  const resolved = path.resolve(defaultPath.trim());

  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {}

  return undefined;
}

async function showOpenFileDialog(event, payload = {}) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win || undefined, {
    title: payload.title || "Seleziona file",
    defaultPath:
      typeof payload.defaultPath === "string" && payload.defaultPath.trim().length > 0
        ? payload.defaultPath.trim()
        : undefined,
    filters: Array.isArray(payload.filters) ? payload.filters : undefined,
    properties: ["openFile"]
  });

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

function registerWindowIpcHandlers(ipcMain) {
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
      memTotalGB: +(totalMem / 1073741824).toFixed(1)
    };
  });

  ipcMain.handle("dialog:open-directory", async (event, payload = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: "Seleziona working directory",
      defaultPath: getExistingDirectory(payload.defaultPath),
      properties: ["openDirectory"]
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("dialog:open-file", async (event, payload = {}) => {
    return await showOpenFileDialog(event, payload);
  });

  ipcMain.handle("dialog:save-file", async (event, { defaultFilename, content }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultFilename,
      filters: [
        { name: "Log files", extensions: ["log", "txt"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, "utf8");
      return result.filePath;
    }
    return null;
  });

  ipcMain.handle("clipboard:read-text", () => clipboard.readText());
  ipcMain.handle("clipboard:write-text", (_event, text) => {
    clipboard.writeText(typeof text === "string" ? text : "");
    return true;
  });
}

function unregisterAllWindowShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = {
  BrowserWindow,
  configureSessionDataPath,
  createMainWindow,
  getMainWindow,
  registerWindowIpcHandlers,
  registerWindowShortcut,
  setupSingleInstanceHandling,
  unregisterAllWindowShortcuts
};
