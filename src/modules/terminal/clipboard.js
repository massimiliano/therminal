function addDomListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function pasteClipboardToSession(sessionId) {
  return window.launcherAPI.readClipboardText().then((text) => {
    if (text) {
      window.launcherAPI.writeSession(sessionId, text);
    }
    return text;
  });
}

export function copyTerminalSelection(terminal) {
  const selectedText = terminal?.getSelection?.();
  if (!selectedText) {
    return Promise.resolve(false);
  }

  return window.launcherAPI.writeClipboardText(selectedText).then(() => {
    terminal.clearSelection();
    terminal.focus();
    return true;
  });
}

export function bindTerminalClipboard({ sessionId, terminal, body }) {
  const releasePaste = addDomListener(body, "paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) {
      return;
    }

    event.preventDefault();
    window.launcherAPI.writeSession(sessionId, text);
  });

  const releaseContextMenu = addDomListener(body, "contextmenu", (event) => {
    if (!terminal?.getSelection?.()) {
      return;
    }

    event.preventDefault();
    copyTerminalSelection(terminal).catch((error) => {
      console.error("Clipboard copy failed:", error);
    });
  });

  const releaseMouseDown = addDomListener(body, "mousedown", () => {
    terminal.focus();
  });

  return () => {
    releasePaste();
    releaseContextMenu();
    releaseMouseDown();
  };
}
