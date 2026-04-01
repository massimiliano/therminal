import { parseShortcut, shortcutMatchesEvent } from "../ui/shortcut-utils.js";

export function matchesPushToTalkShortcut(event, getShortcutValue) {
  return shortcutMatchesEvent(event, getShortcutValue("pushToTalk"));
}

export function isPushToTalkKey(event, getShortcutValue) {
  const parsed = parseShortcut(getShortcutValue("pushToTalk"));
  if (!parsed) {
    return false;
  }

  const groups = getPushToTalkGroups(parsed);
  return groups.some((group) => group.includes(event.code));
}

export function isPushToTalkActive(pressedKeys, getShortcutValue) {
  const parsed = parseShortcut(getShortcutValue("pushToTalk"));
  if (!parsed) {
    return false;
  }

  const groups = getPushToTalkGroups(parsed);
  return groups.length > 0 && groups.every((group) => group.some((code) => pressedKeys.has(code)));
}

function shortcutKeyToCode(key) {
  if (!key) {
    return "";
  }

  if (/^[A-Z]$/.test(key)) {
    return `Key${key}`;
  }

  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }

  if (key === "/") return "Slash";
  if (key === "`") return "Backquote";
  if (key === "Space") return "Space";
  if (key === "Enter") return "Enter";
  if (key === "Tab") return "Tab";
  if (key === "Escape") return "Escape";
  if (key === "-") return "Minus";
  return "";
}

function getPushToTalkGroups(parsed) {
  const groups = [];

  if (parsed.modifiers.has("CommandOrControl")) {
    groups.push(["ControlLeft", "ControlRight", "MetaLeft", "MetaRight"]);
  }
  if (parsed.modifiers.has("Meta")) {
    groups.push(["MetaLeft", "MetaRight"]);
  }
  if (parsed.modifiers.has("Alt")) {
    groups.push(["AltLeft", "AltRight"]);
  }
  if (parsed.modifiers.has("Shift")) {
    groups.push(["ShiftLeft", "ShiftRight"]);
  }

  const keyCode = shortcutKeyToCode(parsed.key);
  if (keyCode) {
    groups.push([keyCode]);
  }

  return groups;
}
