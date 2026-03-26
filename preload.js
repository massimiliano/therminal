const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("launcherAPI", {
  // Session management
  listProviders: (payload = {}) => ipcRenderer.invoke("providers:list", payload),
  createSession: (payload) => ipcRenderer.invoke("session:create", payload),
  writeSession: (id, data) => ipcRenderer.send("session:write", { id, data }),
  resizeSession: (id, cols, rows) => ipcRenderer.send("session:resize", { id, cols, rows }),
  closeSession: (id) => ipcRenderer.send("session:close", { id }),
  closeAllSessions: () => ipcRenderer.send("session:close-all"),
  onSessionData: (callback) => subscribe("session:data", callback),
  onSessionExit: (callback) => subscribe("session:exit", callback),

  // Saved sessions
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  saveSessionAs: (name, config) => ipcRenderer.invoke("sessions:save", { name, config }),
  deleteSession: (name) => ipcRenderer.invoke("sessions:delete", name),

  // Presets
  listPresets: () => ipcRenderer.invoke("presets:list"),
  savePreset: (name, config) => ipcRenderer.invoke("presets:save", { name, config }),
  deletePreset: (name) => ipcRenderer.invoke("presets:delete", name),

  // System
  getSystemMetrics: () => ipcRenderer.invoke("system:metrics"),
  getUsageSummary: () => ipcRenderer.invoke("usage:summary"),
  getUsagePanelSummary: (payload = {}) => ipcRenderer.invoke("usage:panel", payload),
  getUsagePanelProvider: (payload = {}) => ipcRenderer.invoke("usage:panel-provider", payload),
  getServiceStatuses: (force = false) => ipcRenderer.invoke("services:status", { force }),

  // Shell & dialog
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  openDirectoryDialog: (defaultPath) => ipcRenderer.invoke("dialog:open-directory", { defaultPath }),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  saveLogFile: (defaultFilename, content) =>
    ipcRenderer.invoke("dialog:save-file", { defaultFilename, content }),
});
