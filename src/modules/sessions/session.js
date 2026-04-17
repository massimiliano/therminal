import {
  state,
  sessionStore,
  workspaces,
  providerCatalog,
  PROVIDER_STYLE,
  XTERM_THEME,
} from "../state.js";
import { dom } from "../dom.js";
import { shortId, cancelQueuedFit } from "../helpers.js";
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
import {
  createTerminalController,
  disposeTerminalController,
  getTerminalControllerText,
} from "../terminal/controller.js";
import { fitNewTerminal } from "../terminal/resize-policy.js";

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

  const content = getTerminalControllerText(session.controller);
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
      `terminal-status-btn inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors ${meta.chip}`;
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
  const cell = document.createElement("div");
  cell.className =
    "terminal-cell relative flex h-full w-full flex-col overflow-hidden border border-th-border-lt bg-th-surface shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition-shadow duration-150";
  cell.dataset.clientId = client.id;

  const head = document.createElement("div");
  head.className =
    "terminal-cell-head flex items-center gap-1.5 border-b border-th-border bg-th-head px-2 py-[3px] h-8 shrink-0 cursor-grab active:cursor-grabbing";

  const grip = document.createElement("span");
  grip.className =
    "terminal-cell-grip cell-grip flex items-center text-sm text-zinc-600 transition-colors duration-150 cursor-grab shrink-0 hover:text-zinc-300 active:cursor-grabbing";
  grip.innerHTML = '<i class="bi bi-grip-vertical"></i>';

  const badge = document.createElement("span");
  badge.className = `terminal-cell-badge text-[10px] font-semibold px-2 py-px rounded uppercase tracking-wide ${PROVIDER_STYLE[client.provider]?.badge || ""}`;
  badge.textContent = providerCatalog[client.provider]?.label || client.provider;

  const info = document.createElement("span");
  info.className = "terminal-cell-info text-[10px] text-zinc-500 font-mono flex-1";
  info.textContent = "#1 (loading...)";

  const favoritePresetsWrap = document.createElement("div");
  favoritePresetsWrap.className = "terminal-header-presets hidden";

  const statusBtn = document.createElement("button");
  statusBtn.type = "button";
  statusBtn.className = "terminal-status-btn";

  const actions = document.createElement("div");
  actions.className = "terminal-cell-actions flex items-center gap-0.5";

  const btnCls =
    "terminal-header-action w-[24px] h-[24px] flex items-center justify-center bg-transparent text-zinc-600 cursor-pointer rounded text-xs transition-all duration-150 hover:text-zinc-100 hover:bg-zinc-800/80";

  const splitVerticalBtn = createHeaderActionButton(
    `${btnCls} pane-split-action terminal-action-primary`,
    "Split verticale",
    '<span class="text-[9px] font-semibold tracking-wide">V</span>'
  );
  const splitHorizontalBtn = createHeaderActionButton(
    `${btnCls} pane-split-action terminal-action-primary`,
    "Split orizzontale",
    '<span class="text-[9px] font-semibold tracking-wide">H</span>'
  );
  const operationsBtn = createHeaderActionButton(
    `${btnCls} terminal-action-secondary`,
    "Operazioni CLI",
    '<i class="bi bi-lightning-charge"></i>'
  );
  const searchBtn = createHeaderActionButton(`${btnCls} terminal-action-secondary`, "Cerca", '<i class="bi bi-search"></i>');
  const exportBtn = createHeaderActionButton(`${btnCls} terminal-action-secondary`, "Esporta log", '<i class="bi bi-download"></i>');
  const maxBtn = createHeaderActionButton(`${btnCls} terminal-action-primary`, "Massimizza", '<i class="bi bi-arrows-fullscreen"></i>');
  const restartBtn = createHeaderActionButton(`${btnCls} terminal-action-secondary`, "Riavvia", '<i class="bi bi-arrow-clockwise"></i>');
  const closeBtn = createHeaderActionButton(
    `${btnCls} terminal-action-primary hover:!text-red-400 hover:!bg-red-500/10`,
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

  const loadingOverlay = document.createElement("div");
  loadingOverlay.className = "absolute inset-0 z-[2] flex items-center justify-center bg-th-body";
  loadingOverlay.innerHTML = `
    <div class="flex flex-col items-center gap-2 text-zinc-500">
      <div class="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400"></div>
      <p class="text-xs font-medium tracking-[0.08em] uppercase">Avvio sessione...</p>
    </div>
  `;

  body.append(loadingOverlay);
  cell.append(head, body);
  host.append(cell);

  const payload = {
    provider: client.provider,
    command: client.command,
    cwd: client.cwd,
  };

  let session;
  try {
    session = await window.launcherAPI.createSession(payload);
  } catch (error) {
    cell.remove();
    throw error;
  }

  client.sessionId = session.id;
  cell.dataset.sessionId = session.id;
  info.textContent = "#1";

  try {
    const controller = createTerminalController({
      sessionId: session.id,
      cell,
      body,
      fontSize: state.currentFontSize,
      theme: XTERM_THEME,
    });

    loadingOverlay.remove();

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
      attachedHost: host,
      body,
      controller,
      info,
      favoritePresetsWrap,
      statusBtn,
      terminal: controller.terminal,
      fitAddon: controller.fitAddon,
      searchAddon: controller.searchAddon,
      resizeObserver: controller.resizeObserver,
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

    fitNewTerminal(session.id);
    return sessionState;
  } catch (error) {
    client.sessionId = null;
    cell.remove();
    try {
      window.launcherAPI.closeSession(session.id);
    } catch {}
    throw error;
  }
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
  if (typeof session.messagePresetListener === "function") {
    document.removeEventListener("therminal:message-presets-updated", session.messagePresetListener);
  }
  disposeTerminalController(session.controller);
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
