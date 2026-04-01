const MODIFIER_ORDER = ["CommandOrControl", "Control", "Meta", "Alt", "Shift"];

const MODIFIER_ALIASES = new Map([
  ["cmdorctrl", "CommandOrControl"],
  ["commandorcontrol", "CommandOrControl"],
  ["command+control", "CommandOrControl"],
  ["ctrl", "CommandOrControl"],
  ["control", "CommandOrControl"],
  ["cmd", "Meta"],
  ["command", "Meta"],
  ["meta", "Meta"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"]
]);

const KEY_ALIASES = new Map([
  ["slash", "/"],
  ["/", "/"],
  ["backquote", "`"],
  ["grave", "`"],
  ["`", "`"],
  ["space", "Space"],
  ["spacebar", "Space"],
  ["enter", "Enter"],
  ["return", "Enter"],
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["tab", "Tab"],
  ["minus", "-"],
  ["dash", "-"]
]);

const DISPLAY_LABELS = new Map([
  ["CommandOrControl", "Ctrl"],
  ["Control", "Ctrl"],
  ["Meta", "Cmd"],
  ["Alt", "Alt"],
  ["Shift", "Shift"],
  ["/", "/"],
  ["`", "`"],
  ["Space", "Spazio"],
  ["Enter", "Invio"],
  ["Escape", "Esc"],
  ["Tab", "Tab"],
  ["-", "-"]
]);

function normalizeKeyToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return "";
  }

  const alias = KEY_ALIASES.get(trimmed.toLowerCase());
  if (alias) {
    return alias;
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

export function normalizeShortcutString(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  const parts = raw
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return fallback;
  }

  const modifiers = new Set();
  let key = "";

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    key = normalizeKeyToken(part);
  }

  if (!key) {
    return fallback;
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, key].join("+");
}

export function parseShortcut(shortcut) {
  const normalized = normalizeShortcutString(shortcut);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));

  return {
    normalized,
    key,
    modifiers
  };
}

function matchesShortcutKey(event, key) {
  const eventKey = String(event.key || "");
  const lowerKey = eventKey.toLowerCase();

  if (key === "/") {
    return eventKey === "/" || event.code === "Slash";
  }

  if (key === "`") {
    return eventKey === "`" || event.code === "Backquote";
  }

  if (key === "Space") {
    return eventKey === " " || event.code === "Space";
  }

  if (key.length === 1) {
    return lowerKey === key.toLowerCase();
  }

  return lowerKey === key.toLowerCase();
}

export function shortcutMatchesEvent(event, shortcut) {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }

  const wantsCtrlLike = parsed.modifiers.has("CommandOrControl");
  const expectsMeta = parsed.modifiers.has("Meta");
  const expectsAlt = parsed.modifiers.has("Alt");
  const expectsShift = parsed.modifiers.has("Shift");

  if (wantsCtrlLike && !Boolean(event.ctrlKey || event.metaKey)) {
    return false;
  }
  if (!wantsCtrlLike && expectsMeta !== Boolean(event.metaKey)) {
    return false;
  }
  if (expectsAlt !== Boolean(event.altKey)) {
    return false;
  }
  if (expectsShift && !event.shiftKey) {
    return false;
  }

  if (!wantsCtrlLike && event.ctrlKey) {
    return false;
  }
  if (!expectsMeta && !wantsCtrlLike && event.metaKey) {
    return false;
  }

  return matchesShortcutKey(event, parsed.key);
}

export function buildShortcutFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");

  const key = normalizeKeyToken(event.key);
  if (!key || ["Shift", "Alt", "Control", "Meta"].includes(key)) {
    return "";
  }

  if (modifiers.length === 0) {
    return "";
  }

  return [...modifiers, key].join("+");
}

export function getShortcutSegments(shortcut) {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return [];
  }

  return [...parsed.modifiers, parsed.key].map((part) => DISPLAY_LABELS.get(part) || part);
}

export function formatShortcutLabel(shortcut) {
  const segments = getShortcutSegments(shortcut);
  return segments.join("+");
}
