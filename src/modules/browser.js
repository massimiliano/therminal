import { state, sessionStore, workspaces, PROVIDER_STYLE } from "./state.js";
import { dom } from "./dom.js";
import { toggleMaximize } from "./maximize.js";
import { updateSessionTaskStatus } from "./session.js";
import { attachPaneInteractions } from "./pane-controls.js";
import { removeClientFromLayout, renderWorkspaceLayout } from "./layout.js";

const DEFAULT_BROWSER_URL = "https://example.com";

function normalizeBrowserUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return DEFAULT_BROWSER_URL;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    return raw;
  }

  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(raw)) {
    return `http://${raw}`;
  }

  return `https://${raw}`;
}

function updateNavButtons(webview, backBtn, forwardBtn) {
  backBtn.disabled = !webview.canGoBack();
  forwardBtn.disabled = !webview.canGoForward();
}

function createHeaderActionButton(className, title, content) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.innerHTML = content;
  return button;
}

export function createBrowserCommand(url) {
  return normalizeBrowserUrl(url);
}

export function destroyBrowserPanel(sessionId, { removeClient = false } = {}) {
  const panel = sessionStore.get(sessionId);
  if (!panel || panel.provider !== "browser") {
    return;
  }

  if (state.focusedSessionId === sessionId) {
    state.focusedSessionId = null;
  }

  if (state.maximizedSessionId === sessionId) {
    dom.maximizeOverlay.classList.add("hidden");
    state.maximizedSessionId = null;
  }

  const workspace = workspaces.get(panel.workspaceId);
  const client = workspace?.clients?.find((entry) => entry.id === panel.clientId);
  if (client) {
    client.sessionId = null;
  }

  try {
    panel.webview.src = "about:blank";
  } catch {}

  panel.cell.remove();
  sessionStore.delete(sessionId);

  if (!workspace || !removeClient) {
    return;
  }

  workspace.clients = workspace.clients.filter((entry) => entry.id !== panel.clientId);
  removeClientFromLayout(workspace, panel.clientId);
  renderWorkspaceLayout(workspace);
}

export function createBrowserPanel(workspace, client, host) {
  const sessionId = client.sessionId || `browser-${crypto.randomUUID()}`;
  const initialUrl = normalizeBrowserUrl(client.command || client.url || DEFAULT_BROWSER_URL);

  client.sessionId = sessionId;
  client.command = initialUrl;
  client.url = initialUrl;

  const cell = document.createElement("div");
  cell.className =
    "browser-cell terminal-cell relative flex h-full w-full flex-col overflow-hidden border border-th-border-lt bg-th-surface shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition-shadow duration-150";
  cell.dataset.sessionId = sessionId;
  cell.dataset.clientId = client.id;

  const head = document.createElement("div");
  head.className =
    "terminal-cell-head flex items-center gap-1.5 border-b border-th-border bg-th-head px-2 py-[3px] h-8 shrink-0 cursor-grab active:cursor-grabbing";

  const grip = document.createElement("span");
  grip.className =
    "cell-grip flex items-center text-sm text-zinc-600 transition-colors duration-150 cursor-grab shrink-0 hover:text-zinc-300 active:cursor-grabbing";
  grip.innerHTML = '<i class="bi bi-grip-vertical"></i>';

  const badge = document.createElement("span");
  badge.className = `text-[10px] font-semibold px-2 py-px rounded uppercase tracking-wide ${PROVIDER_STYLE.browser?.badge || "bg-cyan-500/15 text-cyan-300"}`;
  badge.textContent = "Browser";

  const info = document.createElement("span");
  info.className = "text-[10px] text-zinc-500 font-mono flex-1";
  info.textContent = "#1";

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
  const maxBtn = createHeaderActionButton(btnCls, "Massimizza", '<i class="bi bi-arrows-fullscreen"></i>');
  const closeBtn = createHeaderActionButton(
    `${btnCls} hover:!text-red-400 hover:!bg-red-500/10`,
    "Chiudi",
    '<i class="bi bi-x-lg"></i>'
  );

  actions.append(splitVerticalBtn, splitHorizontalBtn, maxBtn, closeBtn);
  head.append(grip, badge, info, statusBtn, actions);

  const body = document.createElement("div");
  body.className = "browser-panel flex-1 min-h-0 flex flex-col bg-th-body";

  const toolbar = document.createElement("div");
  toolbar.className = "browser-toolbar flex items-center gap-1.5 px-2 py-1.5 border-b border-th-border-lt bg-th-surface/95 shrink-0";

  const navBtnCls =
    "w-7 h-7 flex items-center justify-center rounded-md border border-th-border-lt bg-th-body text-zinc-500 transition-colors hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = navBtnCls;
  backBtn.innerHTML = '<i class="bi bi-arrow-left"></i>';
  backBtn.title = "Indietro";

  const forwardBtn = document.createElement("button");
  forwardBtn.type = "button";
  forwardBtn.className = navBtnCls;
  forwardBtn.innerHTML = '<i class="bi bi-arrow-right"></i>';
  forwardBtn.title = "Avanti";

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = navBtnCls;
  reloadBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
  reloadBtn.title = "Ricarica";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className =
    "flex-1 min-w-0 h-8 rounded-md border border-th-border-lt bg-th-body px-3 text-xs font-mono text-zinc-200 outline-none focus:border-cyan-400/40";
  urlInput.value = initialUrl;

  const goBtn = document.createElement("button");
  goBtn.type = "button";
  goBtn.className =
    "px-3 h-8 rounded-md text-[11px] font-semibold border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 transition-colors hover:bg-cyan-500/20";
  goBtn.textContent = "Apri";

  const externalBtn = document.createElement("button");
  externalBtn.type = "button";
  externalBtn.className = navBtnCls;
  externalBtn.innerHTML = '<i class="bi bi-box-arrow-up-right"></i>';
  externalBtn.title = "Apri esternamente";

  toolbar.append(backBtn, forwardBtn, reloadBtn, urlInput, goBtn, externalBtn);

  const webviewWrap = document.createElement("div");
  webviewWrap.className = "browser-webview-wrap flex-1 min-h-0 bg-[#0f1114]";

  const webview = document.createElement("webview");
  webview.className = "browser-webview";
  webview.src = initialUrl;
  webview.partition = "persist:therminal-browser";
  webview.setAttribute("allowpopups", "true");

  webviewWrap.append(webview);
  body.append(toolbar, webviewWrap);
  cell.append(head, body);
  host.append(cell);

  const panelState = {
    id: sessionId,
    provider: "browser",
    command: initialUrl,
    cwd: client.cwd,
    workspaceId: workspace.id,
    clientId: client.id,
    clientIndex: 0,
    paneId: client.paneId,
    cell,
    host,
    info,
    statusBtn,
    taskStatus: client.taskStatus || "todo",
    webview,
    urlInput,
    webviewReady: false,
    onFit: () => {},
  };

  sessionStore.set(sessionId, panelState);
  updateSessionTaskStatus(sessionId, panelState.taskStatus);

  function navigateToInput() {
    const nextUrl = normalizeBrowserUrl(urlInput.value);
    client.command = nextUrl;
    client.url = nextUrl;
    panelState.command = nextUrl;
    urlInput.value = nextUrl;
    if (panelState.webviewReady) {
      webview.loadURL(nextUrl);
    } else {
      webview.src = nextUrl;
    }
  }

  function syncNavState() {
    if (!panelState.webviewReady) {
      backBtn.disabled = true;
      forwardBtn.disabled = true;
      return;
    }

    updateNavButtons(webview, backBtn, forwardBtn);
  }

  webview.addEventListener("dom-ready", () => {
    panelState.webviewReady = true;
    syncNavState();
  });

  webview.addEventListener("did-start-loading", () => {
    reloadBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i>';
  });

  webview.addEventListener("did-stop-loading", () => {
    const currentUrl = panelState.webviewReady ? webview.getURL() || initialUrl : initialUrl;
    client.command = currentUrl;
    client.url = currentUrl;
    panelState.command = currentUrl;
    urlInput.value = currentUrl;
    reloadBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
    syncNavState();
  });

  webview.addEventListener("did-navigate", () => {
    syncNavState();
  });

  webview.addEventListener("did-navigate-in-page", () => {
    syncNavState();
  });

  backBtn.addEventListener("click", () => {
    if (panelState.webviewReady && webview.canGoBack()) {
      webview.goBack();
    }
  });

  forwardBtn.addEventListener("click", () => {
    if (panelState.webviewReady && webview.canGoForward()) {
      webview.goForward();
    }
  });

  reloadBtn.addEventListener("click", () => {
    if (panelState.webviewReady) {
      webview.reload();
    }
  });

  goBtn.addEventListener("click", navigateToInput);
  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateToInput();
    }
  });

  externalBtn.addEventListener("click", () => {
    void window.launcherAPI.openExternal(normalizeBrowserUrl(urlInput.value));
  });

  cell.addEventListener("mousedown", () => {
    state.focusedSessionId = sessionId;
  });

  attachPaneInteractions(cell, {
    sessionId,
    clientId: client.id,
    workspaceId: workspace.id,
    splitVerticalBtn,
    splitHorizontalBtn,
  });

  maxBtn.addEventListener("click", () => toggleMaximize(sessionId));
  closeBtn.addEventListener("click", () => destroyBrowserPanel(sessionId, { removeClient: true }));
  syncNavState();

  return panelState;
}
