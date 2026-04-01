import {
  state,
  sessionStore,
  workspaces,
  providerCatalog,
  PROVIDER_STYLE,
  XTERM_THEME,
  TerminalCtor,
  FitAddonCtor,
  WebLinksAddonCtor,
  SearchAddonCtor,
} from "../state.js";
import { dom } from "../dom.js";
import { shortId, queueFit, cancelQueuedFit } from "../helpers.js";
import { showSearch } from "../search.js";
import { toggleMaximize, restoreMaximized } from "../maximize.js";
import { showNotice } from "../notices.js";
import { validateProviderSelection } from "../providers.js";
import { getNextTaskStatus, getTaskStatusMeta, normalizeTaskStatus } from "../task-status.js";
import { destroyBrowserPanel } from "../browser.js";
import { attachPaneInteractions } from "../pane-controls.js";
import { removeClientFromLayout, renderWorkspaceLayout } from "../layout.js";
import {
  getFavoriteMessagePresetButtons,
  openCliOperationsModalForSession,
  sendMessagePresetToSession
} from "../cli-operations.js";

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

function updateWorkspaceClientTaskStatus(session, taskStatus) {
  const workspace = workspaces.get(session.workspaceId);
  const client = workspace?.clients?.find((entry) => entry.id === session.clientId);
  if (client) {
    client.taskStatus = taskStatus;
  }
}

export function exportLog(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session || session.provider === "browser") {
    return;
  }

  const buffer = session.terminal.buffer.active;
  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (line) {
      lines.push(line.translateToString());
    }
  }

  const content = lines.join("\n");
  const filename = `therminal-${session.provider}-${shortId(sessionId)}.log`;
  window.launcherAPI.saveLogFile(filename, content);
}

export function updateSessionTaskStatus(sessionId, nextStatus) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return null;
  }

  const taskStatus = normalizeTaskStatus(nextStatus);
  const meta = getTaskStatusMeta(taskStatus);
  session.taskStatus = taskStatus;
  updateWorkspaceClientTaskStatus(session, taskStatus);

  if (session.statusBtn) {
    session.statusBtn.className =
      `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors ${meta.chip}`;
    session.statusBtn.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.shortLabel}`;
    session.statusBtn.title = `Task status: ${meta.label}`;
  }

  return taskStatus;
}

function createHeaderActionButton(className, title, content) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.innerHTML = content;
  return button;
}

function renderFavoritePresetButtons(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session?.favoritePresetsWrap) {
    return;
  }

  const favorites = getFavoriteMessagePresetButtons();
  session.favoritePresetsWrap.innerHTML = "";
  session.favoritePresetsWrap.classList.toggle("hidden", favorites.length === 0);

  for (const preset of favorites) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "terminal-header-preset";
    button.title = preset.label;
    button.textContent = preset.label;
    button.addEventListener("click", () => sendMessagePresetToSession(sessionId, preset.id));
    session.favoritePresetsWrap.append(button);
  }
}

export async function createWorkspaceSession(workspace, client, host) {
  const payload = {
    provider: client.provider,
    command: client.command,
    cwd: client.cwd,
  };

  const session = await window.launcherAPI.createSession(payload);
  client.sessionId = session.id;

  const cell = document.createElement("div");
  cell.className =
    "terminal-cell relative flex h-full w-full flex-col overflow-hidden border border-th-border-lt bg-th-surface shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition-shadow duration-150";
  cell.dataset.sessionId = session.id;
  cell.dataset.clientId = client.id;

  const head = document.createElement("div");
  head.className =
    "terminal-cell-head flex items-center gap-1.5 border-b border-th-border bg-th-head px-2 py-[3px] h-8 shrink-0 cursor-grab active:cursor-grabbing";

  const grip = document.createElement("span");
  grip.className =
    "cell-grip flex items-center text-sm text-zinc-600 transition-colors duration-150 cursor-grab shrink-0 hover:text-zinc-300 active:cursor-grabbing";
  grip.innerHTML = '<i class="bi bi-grip-vertical"></i>';

  const badge = document.createElement("span");
  badge.className = `text-[10px] font-semibold px-2 py-px rounded uppercase tracking-wide ${PROVIDER_STYLE[session.provider]?.badge || ""}`;
  badge.textContent = providerCatalog[session.provider]?.label || session.provider;

  const info = document.createElement("span");
  info.className = "text-[10px] text-zinc-500 font-mono flex-1";
  info.textContent = "#1";

  const favoritePresetsWrap = document.createElement("div");
  favoritePresetsWrap.className = "terminal-header-presets hidden";

  const statusBtn = document.createElement("button");
  statusBtn.type = "button";

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-0.5";

  const btnCls =
    "w-[24px] h-[24px] flex items-center justify-center bg-transparent text-zinc-600 cursor-pointer rounded text-xs transition-all duration-150 hover:text-zinc-100 hover:bg-zinc-800/80";

  const splitVerticalBtn = createHeaderActionButton(
    `${btnCls} pane-split-action`,
    "Split verticale",
    '<span class="text-[9px] font-semibold tracking-wide">V</span>'
  );
  const splitHorizontalBtn = createHeaderActionButton(
    `${btnCls} pane-split-action`,
    "Split orizzontale",
    '<span class="text-[9px] font-semibold tracking-wide">H</span>'
  );
  const operationsBtn = createHeaderActionButton(
    btnCls,
    "Operazioni CLI",
    '<i class="bi bi-lightning-charge"></i>'
  );
  const searchBtn = createHeaderActionButton(btnCls, "Cerca", '<i class="bi bi-search"></i>');
  const exportBtn = createHeaderActionButton(btnCls, "Esporta log", '<i class="bi bi-download"></i>');
  const maxBtn = createHeaderActionButton(btnCls, "Massimizza", '<i class="bi bi-arrows-fullscreen"></i>');
  const restartBtn = createHeaderActionButton(btnCls, "Riavvia", '<i class="bi bi-arrow-clockwise"></i>');
  const closeBtn = createHeaderActionButton(
    `${btnCls} hover:!text-red-400 hover:!bg-red-500/10`,
    "Chiudi",
    '<i class="bi bi-x-lg"></i>'
  );

  actions.append(
    splitVerticalBtn,
    splitHorizontalBtn,
    operationsBtn,
    searchBtn,
    exportBtn,
    maxBtn,
    restartBtn,
    closeBtn
  );
  head.append(grip, badge, info, favoritePresetsWrap, statusBtn, actions);

  const body = document.createElement("div");
  body.className = "terminal-cell-body relative flex-1 min-h-0 bg-th-body";

  cell.append(head, body);
  host.append(cell);

  const terminal = new TerminalCtor({
    fontFamily: '"JetBrains Mono", Consolas, monospace',
    fontSize: state.currentFontSize,
    lineHeight: 1.25,
    cursorBlink: true,
    convertEol: true,
    scrollback: 6000,
    theme: XTERM_THEME,
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
  fitAddon.fit();
  window.launcherAPI.resizeSession(session.id, terminal.cols, terminal.rows);
  terminal.focus();

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }

    if (isMultilineShortcut(event)) {
      event.preventDefault();
      window.launcherAPI.writeSession(session.id, "\n");
      return false;
    }

    if (isPasteShortcut(event)) {
      event.preventDefault();
      window.launcherAPI.readClipboardText().then((text) => {
        if (text) {
          window.launcherAPI.writeSession(session.id, text);
        }
      }).catch((error) => {
        console.error("Clipboard paste failed:", error);
      });
      return false;
    }

    return true;
  });

  const inputDisposable = terminal.onData((value) => {
    window.launcherAPI.writeSession(session.id, value);
  });

  body.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) {
      return;
    }
    event.preventDefault();
    window.launcherAPI.writeSession(session.id, text);
  });

  body.addEventListener("contextmenu", (event) => {
    const selectedText = terminal.getSelection();
    if (!selectedText) {
      return;
    }

    event.preventDefault();
    window.launcherAPI.writeClipboardText(selectedText).catch((error) => {
      console.error("Clipboard copy failed:", error);
    });
  });

  body.addEventListener("mousedown", () => {
    terminal.focus();
  });

  const resizeObserver = new ResizeObserver(() => queueFit(session.id));
  resizeObserver.observe(cell);
  resizeObserver.observe(body);

  const sessionState = {
    id: session.id,
    provider: session.provider,
    command: session.command,
    cwd: session.cwd,
    workspaceId: workspace.id,
    clientId: client.id,
    clientIndex: 0,
    paneId: client.paneId,
    cell,
    host,
    info,
    favoritePresetsWrap,
    statusBtn,
    terminal,
    fitAddon,
    searchAddon,
    inputDisposable,
    resizeObserver,
    taskStatus: normalizeTaskStatus(client.taskStatus),
  };

  sessionStore.set(session.id, sessionState);
  updateSessionTaskStatus(session.id, sessionState.taskStatus);
  renderFavoritePresetButtons(session.id);

  const messagePresetListener = () => renderFavoritePresetButtons(session.id);
  document.addEventListener("therminal:message-presets-updated", messagePresetListener);
  sessionState.messagePresetListener = messagePresetListener;

  cell.addEventListener("mousedown", () => {
    state.focusedSessionId = session.id;
  });

  attachPaneInteractions(cell, {
    sessionId: session.id,
    clientId: client.id,
    workspaceId: workspace.id,
    splitVerticalBtn,
    splitHorizontalBtn,
  });

  operationsBtn.addEventListener("click", () => openCliOperationsModalForSession(session.id));
  searchBtn.addEventListener("click", () => showSearch(session.id));
  exportBtn.addEventListener("click", () => exportLog(session.id));
  maxBtn.addEventListener("click", () => toggleMaximize(session.id));
  statusBtn.addEventListener("click", () => {
    const nextStatus = getNextTaskStatus(sessionState.taskStatus);
    updateSessionTaskStatus(session.id, nextStatus);
    showNotice(`Task ${sessionState.clientIndex + 1}: ${getTaskStatusMeta(nextStatus).label}.`, {
      type: "info",
      timeoutMs: 1800,
    });
  });
  closeBtn.addEventListener("click", () => {
    destroySession(session.id, { notifyBackend: true, removeClient: true });
  });
  restartBtn.addEventListener("click", async () => {
    restartBtn.disabled = true;
    try {
      await restartWorkspaceSession(session.id);
    } catch (error) {
      console.error("Restart failed:", error);
    } finally {
      restartBtn.disabled = false;
    }
  });

  queueFit(session.id, { backend: "immediate" });
  return sessionState;
}

export function destroySession(sessionId, { notifyBackend = false, removeClient = false } = {}) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  if (session.provider === "browser") {
    destroyBrowserPanel(sessionId, { removeClient });
    return;
  }

  if (notifyBackend) {
    window.launcherAPI.closeSession(sessionId);
  }

  cancelQueuedFit(sessionId);
  session.resizeObserver.disconnect();
  session.inputDisposable.dispose();
  if (typeof session.messagePresetListener === "function") {
    document.removeEventListener("therminal:message-presets-updated", session.messagePresetListener);
  }
  session.terminal.dispose();
  session.cell.remove();
  sessionStore.delete(sessionId);

  if (state.focusedSessionId === sessionId) {
    state.focusedSessionId = null;
  }

  if (state.maximizedSessionId === sessionId) {
    dom.maximizeOverlay.classList.add("hidden");
    state.maximizedSessionId = null;
  }

  const workspace = workspaces.get(session.workspaceId);
  if (!workspace) {
    return;
  }

  const client = workspace.clients.find((entry) => entry.id === session.clientId);
  if (client) {
    client.sessionId = null;
  }

  if (!removeClient) {
    return;
  }

  workspace.clients = workspace.clients.filter((entry) => entry.id !== session.clientId);
  removeClientFromLayout(workspace, session.clientId);
  renderWorkspaceLayout(workspace);
}

export async function restartWorkspaceSession(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  if (session.provider === "browser") {
    return;
  }

  const workspace = workspaces.get(session.workspaceId);
  if (!workspace) {
    return;
  }

  if (state.maximizedSessionId === sessionId) {
    restoreMaximized();
  }

  const client = workspace.clients.find((entry) => entry.id === session.clientId);
  const host = session.host;
  const validation = await validateProviderSelection([client?.provider], { force: true, notify: true });
  if (!validation.ok) {
    return;
  }

  destroySession(sessionId, { notifyBackend: true });

  if (!client || !host) {
    return;
  }

  try {
    await createWorkspaceSession(workspace, client, host);
    renderWorkspaceLayout(workspace);
  } catch (error) {
    console.error("Restart create session failed:", error);
    showNotice(error?.message || "Impossibile riavviare la sessione.", { type: "error" });
    throw error;
  }
}
