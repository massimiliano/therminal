import {
  state,
  sessionStore,
  scheduledFit,
  workspaces,
  providerCatalog,
  PROVIDER_STYLE,
  XTERM_THEME,
  TerminalCtor,
  FitAddonCtor,
  WebLinksAddonCtor,
  SearchAddonCtor,
} from "./state.js";
import { dom } from "./dom.js";
import { shortId, queueFit } from "./helpers.js";
import { showSearch } from "./search.js";
import { toggleMaximize, restoreMaximized } from "./maximize.js";
import { showNotice } from "./notices.js";
import { validateProviderSelection } from "./providers.js";

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

// ─── Export Log ─────────────────────────────────────────

export function exportLog(sessionId) {
  const s = sessionStore.get(sessionId);
  if (!s) return;

  const buffer = s.terminal.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString());
  }
  const content = lines.join("\n");
  const filename = `therminal-${s.provider}-${shortId(sessionId)}.log`;
  window.launcherAPI.saveLogFile(filename, content);
}

// ─── Drag & Drop (panel swap) ───────────────────────────

function setupDragDrop(cell, sessionId) {
  const head = cell.querySelector(".terminal-cell-head");
  const grip = cell.querySelector(".cell-grip");
  if (grip) grip.setAttribute("draggable", "true");

  const dragSource = grip || head;

  dragSource.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", sessionId);
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => cell.classList.add("drag-source"));
  });

  dragSource.addEventListener("dragend", () => {
    cell.classList.remove("drag-source");
    document.querySelectorAll(".terminal-cell.drag-over").forEach((el) =>
      el.classList.remove("drag-over")
    );
  });

  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    cell.classList.add("drag-over");
  });

  cell.addEventListener("dragleave", (e) => {
    if (!cell.contains(e.relatedTarget)) {
      cell.classList.remove("drag-over");
    }
  });

  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("drag-over");
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId && sourceId !== sessionId) {
      swapCells(sourceId, sessionId);
    }
  });
}

function swapCells(idA, idB) {
  const stateA = sessionStore.get(idA);
  const stateB = sessionStore.get(idB);
  if (!stateA || !stateB) return;

  const cellA = stateA.cell;
  const cellB = stateB.cell;
  const rowA = cellA.parentNode;
  const rowB = cellB.parentNode;

  const ws = workspaces.get(stateA.workspaceId);
  if (ws) {
    const rowIndexA = ws.rows.indexOf(rowA);
    const rowIndexB = ws.rows.indexOf(rowB);
    const colIndexA = Array.from(rowA.querySelectorAll(":scope > .terminal-cell")).indexOf(cellA);
    const colIndexB = Array.from(rowB.querySelectorAll(":scope > .terminal-cell")).indexOf(cellB);

    if (rowIndexA >= 0 && rowIndexB >= 0 && colIndexA >= 0 && colIndexB >= 0) {
      const tempSize = ws.colSizes[rowIndexA][colIndexA];
      ws.colSizes[rowIndexA][colIndexA] = ws.colSizes[rowIndexB][colIndexB];
      ws.colSizes[rowIndexB][colIndexB] = tempSize;
    }
  }

  const flexA = cellA.style.flex;
  cellA.style.flex = cellB.style.flex;
  cellB.style.flex = flexA;

  const nextA = cellA.nextSibling;
  const nextB = cellB.nextSibling;
  const parentA = cellA.parentNode;
  const parentB = cellB.parentNode;

  if (nextB === cellA) {
    parentB.insertBefore(cellA, cellB);
  } else if (nextA === cellB) {
    parentA.insertBefore(cellB, cellA);
  } else {
    if (nextA) parentA.insertBefore(cellB, nextA);
    else parentA.append(cellB);
    if (nextB) parentB.insertBefore(cellA, nextB);
    else parentB.append(cellA);
  }

  stateA.row = cellA.parentNode;
  stateB.row = cellB.parentNode;

  queueFit(idA);
  queueFit(idB);
}

// ─── Session Lifecycle ──────────────────────────────────

export async function createWorkspaceSession(workspace, client, row, insertBefore = null) {
  const payload = {
    provider: client.provider,
    command: client.command,
    cwd: client.cwd,
  };

  const session = await window.launcherAPI.createSession(payload);
  client.sessionId = session.id;

  const cell = document.createElement("div");
  cell.className =
    "terminal-cell flex flex-col bg-th-surface overflow-hidden min-w-0 min-h-0 transition-shadow duration-150";
  cell.dataset.sessionId = session.id;
  cell.style.flex = String(workspace.colSizes[client.gridRow][client.gridCol]);

  const head = document.createElement("div");
  head.className =
    "terminal-cell-head flex items-center gap-1.5 px-2 py-[3px] bg-th-head border-b border-th-border h-7 shrink-0";

  const grip = document.createElement("span");
  grip.className =
    "cell-grip text-zinc-700 cursor-grab text-sm flex items-center transition-colors duration-150 shrink-0 hover:text-zinc-500 active:cursor-grabbing";
  grip.innerHTML = '<i class="bi bi-grip-vertical"></i>';

  const badge = document.createElement("span");
  badge.className = `text-[10px] font-semibold px-2 py-px rounded uppercase tracking-wide ${PROVIDER_STYLE[session.provider]?.badge || ""}`;
  badge.textContent = providerCatalog[session.provider]?.label || session.provider;

  const info = document.createElement("span");
  info.className = "text-[10px] text-zinc-600 font-mono flex-1";
  info.textContent = `#${client.index + 1}`;

  const actions = document.createElement("div");
  actions.className = "flex gap-0.5";

  const btnCls =
    "w-[22px] h-[22px] flex items-center justify-center bg-transparent text-zinc-600 cursor-pointer rounded text-xs transition-all duration-150 hover:text-zinc-300 hover:bg-zinc-800";

  const searchBtn = document.createElement("button");
  searchBtn.className = btnCls;
  searchBtn.innerHTML = '<i class="bi bi-search"></i>';
  searchBtn.title = "Cerca";

  const exportBtn = document.createElement("button");
  exportBtn.className = btnCls;
  exportBtn.innerHTML = '<i class="bi bi-download"></i>';
  exportBtn.title = "Esporta log";

  const maxBtn = document.createElement("button");
  maxBtn.className = btnCls;
  maxBtn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
  maxBtn.title = "Massimizza";

  const restartBtn = document.createElement("button");
  restartBtn.className = btnCls;
  restartBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
  restartBtn.title = "Riavvia";

  const closeBtn = document.createElement("button");
  closeBtn.className = `${btnCls} hover:!text-red-500 hover:!bg-red-500/10`;
  closeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
  closeBtn.title = "Chiudi";

  actions.append(searchBtn, exportBtn, maxBtn, restartBtn, closeBtn);
  head.append(grip, badge, info, actions);

  const body = document.createElement("div");
  body.className = "terminal-cell-body flex-1 min-h-0 bg-th-body relative";

  cell.append(head, body);

  if (insertBefore) {
    row.insertBefore(cell, insertBefore);
  } else {
    row.append(cell);
  }

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
    if (!text) return;
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

  const s = {
    id: session.id,
    provider: session.provider,
    command: session.command,
    cwd: session.cwd,
    workspaceId: workspace.id,
    clientIndex: client.index,
    cell,
    row,
    info,
    terminal,
    fitAddon,
    searchAddon,
    inputDisposable,
    resizeObserver,
  };

  sessionStore.set(session.id, s);

  cell.addEventListener("mousedown", () => {
    state.focusedSessionId = session.id;
  });

  setupDragDrop(cell, session.id);

  searchBtn.addEventListener("click", () => showSearch(session.id));
  exportBtn.addEventListener("click", () => exportLog(session.id));
  maxBtn.addEventListener("click", () => toggleMaximize(session.id));

  closeBtn.addEventListener("click", () => {
    destroySession(session.id, { notifyBackend: true });
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

  queueFit(session.id);
}

export function destroySession(sessionId, { notifyBackend }) {
  const s = sessionStore.get(sessionId);
  if (!s) return;

  if (notifyBackend) {
    window.launcherAPI.closeSession(sessionId);
  }

  const frame = scheduledFit.get(sessionId);
  if (frame) {
    cancelAnimationFrame(frame);
    scheduledFit.delete(sessionId);
  }

  s.resizeObserver.disconnect();
  s.inputDisposable.dispose();
  s.terminal.dispose();
  s.cell.remove();
  sessionStore.delete(sessionId);

  if (state.focusedSessionId === sessionId) state.focusedSessionId = null;
  if (state.maximizedSessionId === sessionId) {
    dom.maximizeOverlay.classList.add("hidden");
    state.maximizedSessionId = null;
  }

  const ws = workspaces.get(s.workspaceId);
  if (ws) {
    const client = ws.clients[s.clientIndex];
    if (client) client.sessionId = null;
  }
}

export async function restartWorkspaceSession(sessionId) {
  const s = sessionStore.get(sessionId);
  if (!s) return;

  const ws = workspaces.get(s.workspaceId);
  if (!ws) return;

  if (state.maximizedSessionId === sessionId) restoreMaximized();

  const client = ws.clients[s.clientIndex];
  const row = s.row;
  const nextSibling = s.cell.nextSibling;

  const validation = await validateProviderSelection([client?.provider], { force: true, notify: true });
  if (!validation.ok) {
    return;
  }

  destroySession(sessionId, { notifyBackend: true });

  if (client && row) {
    try {
      await createWorkspaceSession(ws, client, row, nextSibling);
    } catch (error) {
      console.error("Restart create session failed:", error);
      showNotice(error?.message || "Impossibile riavviare la sessione.", { type: "error" });
      throw error;
    }
  }
}
