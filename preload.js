const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("launcherAPI", {
  // Session management
  listProviders: () => ipcRenderer.invoke("providers:list"),
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

  // Shell & dialog
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  saveLogFile: (defaultFilename, content) =>
    ipcRenderer.invoke("dialog:save-file", { defaultFilename, content }),
});
