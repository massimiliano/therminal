const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const { DEFAULT_SHORTCUTS, MAX_FAVORITE_MESSAGE_PRESETS } = require("../constants");

function getPresetsPath() {
  return path.join(app.getPath("userData"), "presets.json");
}

function getSessionPath() {
  return path.join(app.getPath("userData"), "session.json");
}

function getAppConfigPath() {
  return path.join(app.getPath("userData"), "app-config.json");
}

function normalizeShortcutConfig(payload = {}) {
  const next = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SHORTCUTS)) {
    next[key] =
      typeof payload?.[key] === "string" && payload[key].trim().length > 0
        ? payload[key].trim()
        : fallback;
  }
  return next;
}

function normalizeMessagePreset(preset = {}, index = 0) {
  const label =
    typeof preset.label === "string" && preset.label.trim().length > 0
      ? preset.label.trim()
      : `Messaggio ${index + 1}`;
  const content = typeof preset.content === "string" ? preset.content.replace(/\r\n/g, "\n") : "";

  return {
    id:
      typeof preset.id === "string" && preset.id.trim().length > 0
        ? preset.id.trim()
        : crypto.randomUUID(),
    label,
    content,
    autoSubmit: false,
    isFavorite: Boolean(preset.isFavorite)
  };
}

function flattenLegacyProviderOperations(payload = {}) {
  const providers = ["codex", "claude", "copilot", "gemini", "terminal", "lazygit"];
  const flattened = [];

  for (const provider of providers) {
    const entries = Array.isArray(payload?.[provider]) ? payload[provider] : [];
    for (const entry of entries) {
      flattened.push({
        ...entry,
        label:
          typeof entry?.label === "string" && entry.label.trim().length > 0
            ? entry.label.trim()
            : `${provider} preset`
      });
    }
  }

  return flattened;
}

function normalizeMessagePresets(payload = []) {
  const favorites = [];
  const next = [];
  const entries = Array.isArray(payload) ? payload : [];

  for (const [index, preset] of entries.entries()) {
    const normalized = normalizeMessagePreset(preset, index);
    if (!normalized.content.trim()) {
      continue;
    }

    if (normalized.isFavorite) {
      if (favorites.length >= MAX_FAVORITE_MESSAGE_PRESETS) {
        normalized.isFavorite = false;
      } else {
        favorites.push(normalized.id);
      }
    }

    next.push(normalized);
  }

  return next;
}

function normalizeAppConfig(payload = {}) {
  const rawPresets = Array.isArray(payload.messagePresets)
    ? payload.messagePresets
    : flattenLegacyProviderOperations(payload.providerOperations);

  return {
    shortcuts: normalizeShortcutConfig(payload.shortcuts),
    messagePresets: normalizeMessagePresets(rawPresets)
  };
}

function loadAppConfigFile() {
  try {
    const configPath = getAppConfigPath();
    if (fs.existsSync(configPath)) {
      return normalizeAppConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
    }
  } catch {}

  return normalizeAppConfig();
}

function saveAppConfigFile(payload) {
  const normalized = normalizeAppConfig(payload);
  fs.writeFileSync(getAppConfigPath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function loadPresetsFile() {
  try {
    const presetPath = getPresetsPath();
    if (fs.existsSync(presetPath)) {
      return JSON.parse(fs.readFileSync(presetPath, "utf8"));
    }
  } catch {}

  return {};
}

function savePresetsFile(data) {
  fs.writeFileSync(getPresetsPath(), JSON.stringify(data, null, 2), "utf8");
}

function loadSessionsFile() {
  try {
    const sessionPath = getSessionPath();
    if (fs.existsSync(sessionPath)) {
      return JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    }
  } catch {}

  return {};
}

function saveSessionsFile(data) {
  fs.writeFileSync(getSessionPath(), JSON.stringify(data, null, 2), "utf8");
}

function registerConfigIpcHandlers(ipcMain, { registerWindowShortcut }) {
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

  ipcMain.handle("app-config:get", () => loadAppConfigFile());

  ipcMain.handle("app-config:save-shortcuts", (_event, payload = {}) => {
    const config = loadAppConfigFile();
    config.shortcuts = normalizeShortcutConfig({
      ...config.shortcuts,
      ...payload
    });

    const registration = app.isReady()
      ? registerWindowShortcut(config.shortcuts.toggleWindow)
      : { shortcut: config.shortcuts.toggleWindow, warning: "" };
    config.shortcuts.toggleWindow = registration.shortcut;

    const saved = saveAppConfigFile(config);
    return {
      shortcuts: saved.shortcuts,
      warning: registration.warning || ""
    };
  });

  ipcMain.handle("app-config:save-message-presets", (_event, payload = []) => {
    const config = loadAppConfigFile();
    config.messagePresets = normalizeMessagePresets(payload);
    const saved = saveAppConfigFile(config);
    return {
      messagePresets: saved.messagePresets
    };
  });
}

module.exports = {
  loadAppConfigFile,
  loadPresetsFile,
  loadSessionsFile,
  normalizeAppConfig,
  normalizeMessagePresets,
  normalizeShortcutConfig,
  registerConfigIpcHandlers,
  saveAppConfigFile,
  savePresetsFile,
  saveSessionsFile
};
