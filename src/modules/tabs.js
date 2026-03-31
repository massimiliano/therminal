import { state, workspaces, PROVIDER_STYLE } from "./state.js";
import { dom } from "./dom.js";
import { refitWorkspace } from "./helpers.js";
import { syncSharedContextUi } from "./shared-context.js";
import { openNameModal } from "./name-modal.js";
import { showHomePage } from "./home-pages.js";

const TAB_CLS =
  "flex items-center gap-1.5 px-3 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap transition-all duration-150 h-[30px]";
const TAB_IDLE = "text-zinc-500 hover:text-zinc-300 hover:bg-th-hover";
const TAB_ACTIVE = "text-emerald-400 bg-emerald-400/5";

let _onCloseWorkspace = null;

export function setOnCloseWorkspace(fn) {
  _onCloseWorkspace = fn;
}

function buildProviderDots(ws) {
  const counts = {};
  for (const client of ws.clients) {
    const p = client.provider;
    counts[p] = (counts[p] || 0) + 1;
  }

  const container = document.createElement("span");
  container.className = "flex items-center gap-0.5 ml-0.5";

  for (const [provider, count] of Object.entries(counts)) {
    const dot = document.createElement("span");
    dot.className = `inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-bold leading-none ${PROVIDER_STYLE[provider]?.dot || "bg-zinc-700 text-zinc-400"}`;
    dot.textContent = count;
    container.append(dot);
  }

  return container;
}

function showTabContextMenu(e, ws, label) {
  // Remove any existing context menu
  document.querySelector(".tab-ctx-menu")?.remove();

  const menu = document.createElement("div");
  menu.className =
    "tab-ctx-menu fixed z-[200] bg-th-card border border-th-border-lt rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[140px]";
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const renameItem = document.createElement("button");
  renameItem.className =
    "flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-th-hover transition-colors cursor-pointer text-left";
  renameItem.innerHTML = '<i class="bi bi-pencil text-zinc-500"></i> Rinomina';
  renameItem.addEventListener("click", () => {
    menu.remove();
    startRename(ws, label);
  });

  const savePresetItem = document.createElement("button");
  savePresetItem.className =
    "flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-th-hover transition-colors cursor-pointer text-left";
  savePresetItem.innerHTML = '<i class="bi bi-bookmark-plus text-zinc-500"></i> Salva preset';
  savePresetItem.addEventListener("click", () => {
    menu.remove();
    openWorkspacePresetModal(ws);
  });

  menu.append(renameItem, savePresetItem);
  document.body.append(menu);

  // Close on any click outside
  function close(ev) {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("mousedown", close, true);
    }
  }
  requestAnimationFrame(() => {
    document.addEventListener("mousedown", close, true);
  });
}

function openWorkspacePresetModal(ws) {
  if (!ws) return;

  openNameModal({
    mode: "workspace-preset",
    title: "Salva preset",
    placeholder: "Nome del preset...",
    value: ws.name || "",
    workspaceId: ws.id,
  });
}

function startRename(ws, label) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = ws.name;
  input.className =
    "bg-transparent border border-emerald-400/40 rounded px-1 py-0 text-xs font-medium text-emerald-400 outline-none w-24";

  label.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim();
    if (newName) ws.name = newName;
    renderTabs();
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();

    if (e.key === " " || e.code === "Space" || e.key === "Spacebar") {
      // Input is inside a <button> tab: prevent the button "space activates click" behavior.
      e.preventDefault();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const value = input.value;
      input.value = `${value.slice(0, start)} ${value.slice(end)}`;
      const nextPos = start + 1;
      input.setSelectionRange(nextPos, nextPos);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      input.removeEventListener("blur", commit);
      renderTabs();
    }
  });
  input.addEventListener("keyup", (e) => e.stopPropagation());
  input.addEventListener("keypress", (e) => e.stopPropagation());

  // Prevent tab click from firing while editing
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
}

export function renderTabs() {
  dom.tabBar.querySelectorAll(".workspace-tab").forEach((el) => el.remove());

  const toolsEl = document.getElementById("tabBarTools");
  dom.workspaceTabsDivider?.classList.toggle("hidden", workspaces.size === 0);

  for (const [id, ws] of workspaces) {
    const isActive = state.activeView === id;
    const btn = document.createElement("button");
    btn.className = `${TAB_CLS} workspace-tab ${isActive ? TAB_ACTIVE : TAB_IDLE}`;
    btn.dataset.view = id;

    const icon = document.createElement("i");
    icon.className = "bi bi-terminal";

    const label = document.createElement("span");
    label.textContent = ws.name;

    const dots = buildProviderDots(ws);

    const close = document.createElement("i");
    close.className = "bi bi-x text-sm opacity-40 ml-1 hover:opacity-100 hover:text-red-500";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_onCloseWorkspace) _onCloseWorkspace(id);
    });

    btn.append(icon, label, dots, close);
    btn.addEventListener("click", () => switchView(id));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabContextMenu(e, ws, label);
    });

    dom.tabBar.insertBefore(btn, toolsEl.previousElementSibling);
  }

  const isHome = state.activeView === "home";
  dom.homeTab.className = `${TAB_CLS} ${isHome ? TAB_ACTIVE : TAB_IDLE}`;
  syncSharedContextUi();
}

export function switchView(viewId) {
  state.activeView = viewId;

  const isHome = viewId === "home";

  dom.homeView.classList.toggle("hidden", !isHome);
  dom.homeView.classList.toggle("flex", isHome);
  dom.workspaceContainer.classList.toggle("hidden", isHome);
  document.querySelectorAll(".workspace-only").forEach((el) => {
    el.classList.toggle("hidden", isHome);
  });

  if (isHome) {
    showHomePage(state.homePage || "home", { scroll: false });
    dom.workspaceContainer
      .querySelectorAll(".workspace-grid")
      .forEach((el) => el.classList.add("hidden"));
  } else {
    dom.workspaceContainer.querySelectorAll(".workspace-grid").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.workspaceId !== viewId);
    });

    const ws = workspaces.get(viewId);
    if (ws) refitWorkspace(ws);
  }

  renderTabs();
  syncSharedContextUi();
}
