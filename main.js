const { app, BrowserWindow, ipcMain } = require("electron");

const { loadAppConfigFile, registerConfigIpcHandlers, saveAppConfigFile } = require("./main/config");
const { registerProviderIpcHandlers } = require("./main/providers");
const { closeAllSessions, registerSessionIpcHandlers } = require("./main/session");
const { invalidateUsageSummaryCache, registerUsageIpcHandlers } = require("./main/usage");
const { registerVoiceIpcHandlers, stopWhisperServerRuntime } = require("./main/voice");
const {
  configureSessionDataPath,
  createMainWindow,
  registerWindowIpcHandlers,
  registerWindowShortcut,
  setupSingleInstanceHandling,
  unregisterAllWindowShortcuts
} = require("./main/window");

configureSessionDataPath();

const shouldEnforceSingleInstance = process.env.THERMINAL_SINGLE_INSTANCE === "1";
const hasSingleInstanceLock = setupSingleInstanceHandling(shouldEnforceSingleInstance);

if (!hasSingleInstanceLock) {
  app.quit();
}

registerProviderIpcHandlers(ipcMain);
registerSessionIpcHandlers(ipcMain, {
  onSessionsChanged: invalidateUsageSummaryCache
});
registerConfigIpcHandlers(ipcMain, {
  registerWindowShortcut
});
registerWindowIpcHandlers(ipcMain);
registerUsageIpcHandlers(ipcMain);
registerVoiceIpcHandlers(ipcMain);

app.whenReady().then(() => {
  createMainWindow();

  const config = loadAppConfigFile();
  const registration = registerWindowShortcut(config.shortcuts.toggleWindow);
  if (registration.shortcut !== config.shortcuts.toggleWindow) {
    config.shortcuts.toggleWindow = registration.shortcut;
    saveAppConfigFile(config);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  stopWhisperServerRuntime();
  closeAllSessions(invalidateUsageSummaryCache);
});

app.on("will-quit", () => {
  unregisterAllWindowShortcuts();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
