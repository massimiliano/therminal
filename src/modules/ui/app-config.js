import { normalizeShortcutString } from "../shortcut-utils.js";

export const DEFAULT_SHORTCUTS = Object.freeze({
  toggleWindow: "CommandOrControl+`",
  toggleShortcuts: "CommandOrControl+/",
  toggleBroadcast: "CommandOrControl+Shift+B",
  pushToTalk: "Shift+Alt+Z"
});

export const SHORTCUT_ACTIONS = Object.freeze([
  {
    id: "toggleWindow",
    label: "Mostra / nascondi Therminal",
    description: "Shortcut globale della finestra"
  },
  {
    id: "toggleShortcuts",
    label: "Apri scorciatoie / info",
    description: "Apre o chiude la modale scorciatoie"
  },
  {
    id: "toggleBroadcast",
    label: "Broadcast terminali",
    description: "Mostra la barra broadcast nel workspace"
  },
  {
    id: "pushToTalk",
    label: "Push-to-talk",
    description: "Dettatura voice nella sessione attiva"
  }
]);

export const MAX_FAVORITE_MESSAGE_PRESETS = 5;

const shortcutConfig = { ...DEFAULT_SHORTCUTS };
let messagePresets = [];

function normalizeMessagePreset(preset = {}, index = 0) {
  const content = typeof preset.content === "string" ? preset.content.replace(/\r\n/g, "\n") : "";
  return {
    id:
      typeof preset.id === "string" && preset.id.trim().length > 0
        ? preset.id.trim()
        : crypto.randomUUID(),
    label:
      typeof preset.label === "string" && preset.label.trim().length > 0
        ? preset.label.trim()
        : `Messaggio ${index + 1}`,
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

function applyShortcutConfig(payload = {}) {
  for (const [action, fallback] of Object.entries(DEFAULT_SHORTCUTS)) {
    shortcutConfig[action] = normalizeShortcutString(payload[action], fallback);
  }
}

function applyMessagePresets(payload = []) {
  const entries = Array.isArray(payload) ? payload : flattenLegacyProviderOperations(payload);
  const next = [];
  let favoriteCount = 0;

  for (const [index, preset] of entries.entries()) {
    const normalized = normalizeMessagePreset(preset, index);
    if (!normalized.content.trim()) {
      continue;
    }

    if (normalized.isFavorite) {
      favoriteCount += 1;
      if (favoriteCount > MAX_FAVORITE_MESSAGE_PRESETS) {
        normalized.isFavorite = false;
      }
    }

    next.push(normalized);
  }

  messagePresets = next;
}

export async function loadAppConfig() {
  if (!window.launcherAPI?.getAppConfig) {
    return {
      shortcuts: getShortcutConfig(),
      messagePresets: getMessagePresets()
    };
  }

  const config = await window.launcherAPI.getAppConfig();
  applyShortcutConfig(config?.shortcuts);
  applyMessagePresets(config?.messagePresets || config?.providerOperations);

  return {
    shortcuts: getShortcutConfig(),
    messagePresets: getMessagePresets()
  };
}

export function getShortcutConfig() {
  return { ...shortcutConfig };
}

export function getShortcutValue(action) {
  return shortcutConfig[action] || DEFAULT_SHORTCUTS[action] || "";
}

export async function saveShortcutConfig(nextShortcuts) {
  const response = await window.launcherAPI.saveShortcutConfig(nextShortcuts);
  applyShortcutConfig(response?.shortcuts);
  return {
    shortcuts: getShortcutConfig(),
    warning: response?.warning || ""
  };
}

export function getMessagePresets() {
  return messagePresets.map((preset) => ({ ...preset }));
}

export function getFavoriteMessagePresets() {
  return getMessagePresets()
    .filter((preset) => preset.isFavorite)
    .slice(0, MAX_FAVORITE_MESSAGE_PRESETS);
}

export async function saveMessagePresets(nextPresets) {
  const response = await window.launcherAPI.saveMessagePresets(nextPresets);
  applyMessagePresets(response?.messagePresets);
  return getMessagePresets();
}
