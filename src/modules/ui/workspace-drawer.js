import { dom } from "../dom.js";
import { closeAddTerminalMenu } from "../workspace/add-terminal-menu.js";

function isDrawerAvailable() {
  return Boolean(dom.workspaceDrawer && dom.workspaceDrawerBackdrop);
}

export function isWorkspaceDrawerOpen() {
  return isDrawerAvailable() && !dom.workspaceDrawer.classList.contains("translate-x-full");
}

export function openWorkspaceDrawer() {
  if (!isDrawerAvailable()) {
    return;
  }

  dom.workspaceDrawerBackdrop.classList.remove("hidden");
  dom.workspaceDrawer.classList.remove("hidden", "translate-x-full");
  dom.workspaceDrawer.classList.add("translate-x-0");
  dom.workspaceDrawerBackdrop.classList.remove("opacity-0");
  dom.workspaceDrawerBackdrop.classList.add("opacity-100");
  dom.workspaceDrawerToggle?.classList.add("text-emerald-300", "bg-emerald-400/10", "border-emerald-500/30");
}

export function closeWorkspaceDrawer() {
  if (!isDrawerAvailable()) {
    return;
  }

  closeAddTerminalMenu();
  dom.workspaceDrawer.classList.remove("translate-x-0");
  dom.workspaceDrawer.classList.add("translate-x-full");
  dom.workspaceDrawerBackdrop.classList.remove("opacity-100");
  dom.workspaceDrawerBackdrop.classList.add("opacity-0");
  dom.workspaceDrawerToggle?.classList.remove("text-emerald-300", "bg-emerald-400/10", "border-emerald-500/30");

  window.setTimeout(() => {
    if (!dom.workspaceDrawer.classList.contains("translate-x-full")) {
      return;
    }

    dom.workspaceDrawer.classList.add("hidden");
    dom.workspaceDrawerBackdrop.classList.add("hidden");
  }, 200);
}

export function toggleWorkspaceDrawer() {
  if (isWorkspaceDrawerOpen()) {
    closeWorkspaceDrawer();
    return;
  }

  openWorkspaceDrawer();
}

export function initWorkspaceDrawer() {
  if (!isDrawerAvailable()) {
    return;
  }

  dom.workspaceDrawerToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleWorkspaceDrawer();
  });

  dom.workspaceDrawerCloseBtn?.addEventListener("click", () => closeWorkspaceDrawer());
  dom.workspaceDrawerBackdrop?.addEventListener("click", () => closeWorkspaceDrawer());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isWorkspaceDrawerOpen()) {
      closeWorkspaceDrawer();
    }
  });

  [
    dom.saveSessionBtn,
    dom.sharedContextToggle,
    dom.broadcastToggle,
    dom.operationsToggle,
    dom.shortcutsToggle,
  ].forEach((button) => {
    button?.addEventListener("click", () => closeWorkspaceDrawer());
  });
}
