import {
  TerminalCtor,
  FitAddonCtor,
  WebLinksAddonCtor,
  SearchAddonCtor,
} from "../state.js";
import { bindTerminalClipboard, pasteClipboardToSession } from "./clipboard.js";
import {
  createTerminalOutputBuffer,
  disposeTerminalOutputBuffer,
  enqueueTerminalOutput,
  flushTerminalOutput,
} from "./output-buffer.js";
import { createTerminalResizeObserver } from "./resize-policy.js";

const DEFAULT_FONT_FAMILY = "\"JetBrains Mono\", Consolas, monospace";
const DEFAULT_LINE_HEIGHT = 1.25;
const DEFAULT_SCROLLBACK = 6000;

function isPasteShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  return (
    ((event.ctrlKey || event.metaKey) && key === "v") ||
    ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "v") ||
    (event.shiftKey && key === "insert")
  );
}

function isMultilineShortcut(event) {
  return event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

function bindTerminalInput(sessionId, terminal) {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }

    if (isMultilineShortcut(event)) {
      event.preventDefault();
      window.launcherAPI.writeSession(sessionId, "\n");
      return false;
    }

    if (isPasteShortcut(event)) {
      event.preventDefault();
      pasteClipboardToSession(sessionId).catch((error) => {
        console.error("Clipboard paste failed:", error);
      });
      return false;
    }

    return true;
  });

  return terminal.onData((value) => {
    window.launcherAPI.writeSession(sessionId, value);
  });
}

export function createTerminalController({
  sessionId,
  cell,
  body,
  fontSize,
  theme,
}) {
  const terminal = new TerminalCtor({
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize,
    lineHeight: DEFAULT_LINE_HEIGHT,
    cursorBlink: true,
    convertEol: true,
    scrollback: DEFAULT_SCROLLBACK,
    theme,
  });

  const fitAddon = new FitAddonCtor();
  terminal.loadAddon(fitAddon);

  if (WebLinksAddonCtor) {
    const webLinksAddon = new WebLinksAddonCtor((_event, uri) => {
      window.launcherAPI.openExternal(uri);
    });
    terminal.loadAddon(webLinksAddon);
  }

  let searchAddon = null;
  if (SearchAddonCtor) {
    searchAddon = new SearchAddonCtor();
    terminal.loadAddon(searchAddon);
  }

  terminal.open(body);
  terminal.focus();

  const inputDisposable = bindTerminalInput(sessionId, terminal);
  const releaseClipboard = bindTerminalClipboard({ sessionId, terminal, body });
  const resizeObserver = createTerminalResizeObserver(sessionId, cell, body);
  const outputBuffer = createTerminalOutputBuffer(terminal);

  return {
    body,
    terminal,
    fitAddon,
    searchAddon,
    resizeObserver,
    outputBuffer,
    dispose() {
      releaseClipboard();
      resizeObserver.disconnect();
      inputDisposable.dispose();
      disposeTerminalOutputBuffer(outputBuffer);
      terminal.dispose();
    },
  };
}

export function enqueueTerminalControllerOutput(controller, data) {
  if (!controller) {
    return;
  }

  enqueueTerminalOutput(controller.outputBuffer, data);
}

export function flushTerminalControllerOutput(controller) {
  if (!controller) {
    return;
  }

  flushTerminalOutput(controller.outputBuffer);
}

export function disposeTerminalController(controller) {
  controller?.dispose?.();
}

export function focusTerminalController(controller) {
  controller?.terminal?.focus?.();
}

export function setTerminalControllerFontSize(controller, fontSize) {
  if (!controller?.terminal) {
    return;
  }

  controller.terminal.options.fontSize = fontSize;
}

export function getTerminalControllerSelection(controller) {
  return controller?.terminal?.getSelection?.() || "";
}

export function getTerminalControllerText(controller) {
  const buffer = controller?.terminal?.buffer?.active;
  if (!buffer) {
    return "";
  }

  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (line) {
      lines.push(line.translateToString());
    }
  }

  return lines.join("\n");
}

export function getTerminalControllerTail(controller, maxLines) {
  const buffer = controller?.terminal?.buffer?.active;
  if (!buffer) {
    return "";
  }

  const start = Math.max(0, buffer.length - maxLines);
  const lines = [];

  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (!line) {
      continue;
    }

    const text = line.translateToString().replace(/\s+$/, "");
    if (text.trim().length > 0) {
      lines.push(text);
    }
  }

  return lines.join("\n").trim();
}

export function findNextInTerminalController(controller, term) {
  return controller?.searchAddon?.findNext?.(term);
}

export function findPreviousInTerminalController(controller, term) {
  return controller?.searchAddon?.findPrevious?.(term);
}

export function clearTerminalControllerSearch(controller) {
  controller?.searchAddon?.clearDecorations?.();
}
