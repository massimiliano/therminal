import { dom } from "./dom.js";
import { providerCatalog } from "./state.js";

let currentContext = {
  workspaceId: null,
  targetClientId: null,
  splitDirection: "vertical",
  title: "Aggiungi nel workspace",
};

let onSelectProvider = null;
let listenersBound = false;

function setDirectionButtons(direction) {
  const isVertical = direction !== "horizontal";
  dom.addTerminalDirVertical?.classList.toggle("is-active", isVertical);
  dom.addTerminalDirHorizontal?.classList.toggle("is-active", !isVertical);
}

function syncMenuAvailability() {
  dom.addTerminalMenu?.querySelectorAll("[data-provider]").forEach((button) => {
    const providerKey = button.dataset.provider;
    const isUnavailable = providerCatalog[providerKey]?.available === false;
    button.disabled = isUnavailable;
    button.classList.toggle("opacity-40", isUnavailable);
    button.classList.toggle("cursor-not-allowed", isUnavailable);
  });
}

function positionMenu(anchorEl) {
  if (!dom.addTerminalMenu || !anchorEl) {
    return;
  }

  const rect = anchorEl.getBoundingClientRect();
  dom.addTerminalMenu.style.left = `${Math.max(12, rect.right - 240)}px`;
  dom.addTerminalMenu.style.top = `${rect.bottom + 8}px`;
}

function updateMenuUi() {
  if (dom.addTerminalMenuTitle) {
    dom.addTerminalMenuTitle.textContent = currentContext.title || "Aggiungi nel workspace";
  }
  setDirectionButtons(currentContext.splitDirection);
  syncMenuAvailability();
}

export function closeAddTerminalMenu() {
  dom.addTerminalMenu?.classList.add("hidden");
}

export function openAddTerminalMenu(anchorEl, context = {}) {
  currentContext = {
    ...currentContext,
    ...context,
    splitDirection: context.splitDirection === "horizontal" ? "horizontal" : "vertical",
  };

  updateMenuUi();
  positionMenu(anchorEl || dom.addTerminalBtn);
  dom.addTerminalMenu?.classList.remove("hidden");
}

export function initAddTerminalMenu(onSelect) {
  onSelectProvider = onSelect;

  if (listenersBound) {
    return;
  }

  listenersBound = true;

  dom.addTerminalDirVertical?.addEventListener("click", (event) => {
    event.stopPropagation();
    currentContext.splitDirection = "vertical";
    setDirectionButtons("vertical");
  });

  dom.addTerminalDirHorizontal?.addEventListener("click", (event) => {
    event.stopPropagation();
    currentContext.splitDirection = "horizontal";
    setDirectionButtons("horizontal");
  });

  dom.addTerminalMenu?.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      closeAddTerminalMenu();
      const provider = button.dataset.provider;
      if (!provider || typeof onSelectProvider !== "function") {
        return;
      }

      await onSelectProvider(provider, { ...currentContext });
    });
  });

  document.addEventListener("mousedown", (event) => {
    if (
      dom.addTerminalMenu &&
      !dom.addTerminalMenu.classList.contains("hidden") &&
      !dom.addTerminalMenu.contains(event.target) &&
      !dom.addTerminalWrap?.contains(event.target)
    ) {
      closeAddTerminalMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (!dom.addTerminalMenu?.classList.contains("hidden")) {
      closeAddTerminalMenu();
    }
  });
}
