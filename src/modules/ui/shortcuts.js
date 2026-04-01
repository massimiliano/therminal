import { dom } from "../dom.js";
import { toggleBroadcast } from "../broadcast.js";
import { providerCatalog } from "../state.js";
import { buildStep2 } from "../wizard.js";
import { loadPresets } from "../presets.js";
import { loadSessionsUI } from "../session-state.js";
import { showNotice } from "../notices.js";
import { refreshProviderCatalog } from "../providers.js";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  getShortcutConfig,
  getShortcutValue,
  saveShortcutConfig
} from "../app-config.js";
import {
  buildShortcutFromEvent,
  formatShortcutLabel,
  getShortcutSegments,
  shortcutMatchesEvent
} from "../shortcut-utils.js";
import { openCliOperationsModal, toggleCliOperationsModal } from "../cli-operations.js";

let shortcutDraft = getShortcutConfig();
let captureActionId = null;

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function getProviderStatusMeta(provider) {
  if (provider?.available === false) {
    return {
      badge: "text-amber-200 border-amber-500/30 bg-amber-500/10",
      dot: "bg-amber-400",
      label: "Mancante"
    };
  }

  return {
    badge: "text-emerald-200 border-emerald-500/30 bg-emerald-500/10",
    dot: "bg-emerald-400",
    label: provider?.kind === "shell" ? "Integrato" : "Disponibile"
  };
}

function syncShortcutDraft() {
  shortcutDraft = getShortcutConfig();
}

function dispatchShortcutUpdate() {
  document.dispatchEvent(
    new CustomEvent("therminal:shortcuts-updated", {
      detail: getShortcutConfig()
    })
  );
}

function updateShortcutTitles() {
  if (dom.shortcutsToggle) {
    dom.shortcutsToggle.title = `Scorciatoie e info (${formatShortcutLabel(getShortcutValue("toggleShortcuts"))})`;
  }
  if (dom.broadcastToggle) {
    dom.broadcastToggle.title = `Broadcast a tutti i terminali (${formatShortcutLabel(getShortcutValue("toggleBroadcast"))})`;
  }
}

function renderShortcutKbd(shortcut) {
  const segments = getShortcutSegments(shortcut);
  if (segments.length === 0) {
    return '<span class="text-[11px] text-zinc-600">Non impostata</span>';
  }

  return segments
    .map((segment) => `<kbd>${segment}</kbd>`)
    .join('<span class="text-zinc-700">+</span>');
}

function renderShortcutEditor() {
  if (!dom.shortcutEditorList) {
    return;
  }

  dom.shortcutEditorList.innerHTML = "";

  for (const action of SHORTCUT_ACTIONS) {
    const isCapturing = captureActionId === action.id;
    const row = document.createElement("article");
    row.className = "rounded-xl border border-th-border-lt bg-th-body px-3 py-3";

    const currentShortcut = shortcutDraft[action.id] || DEFAULT_SHORTCUTS[action.id];
    row.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-zinc-200">${action.label}</p>
          <p class="mt-1 text-[11px] text-zinc-500 leading-relaxed">${action.description}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-shortcut-action="${action.id}"
            data-role="record"
            class="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              isCapturing
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : "border-zinc-700/60 text-zinc-300 hover:border-emerald-500/50 hover:text-white hover:bg-th-hover"
            }"
          >
            ${isCapturing ? "Premi tasti..." : "Registra"}
          </button>
          <button
            type="button"
            data-shortcut-action="${action.id}"
            data-role="reset"
            class="rounded-lg border border-zinc-700/60 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-red-500/50 hover:text-red-200 hover:bg-red-500/5"
          >
            Reset
          </button>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-1 text-[11px] text-zinc-500" data-role="value">
          ${renderShortcutKbd(currentShortcut)}
        </div>
        <span class="text-[10px] text-zinc-600 uppercase tracking-wide">
          ${action.id === "toggleWindow" ? "Globale" : "Finestra"}
        </span>
      </div>
    `;

    row.querySelector('[data-role="record"]')?.addEventListener("click", () => {
      captureActionId = isCapturing ? null : action.id;
      renderShortcutEditor();
    });
    row.querySelector('[data-role="reset"]')?.addEventListener("click", () => {
      shortcutDraft[action.id] = DEFAULT_SHORTCUTS[action.id];
      if (captureActionId === action.id) {
        captureActionId = null;
      }
      renderShortcutEditor();
    });

    dom.shortcutEditorList.append(row);
  }
}

function findDuplicateShortcuts() {
  const seen = new Map();
  const duplicates = [];

  for (const action of SHORTCUT_ACTIONS) {
    const shortcut = shortcutDraft[action.id];
    if (!shortcut) {
      continue;
    }

    if (seen.has(shortcut)) {
      duplicates.push([seen.get(shortcut), action.label, shortcut]);
      continue;
    }

    seen.set(shortcut, action.label);
  }

  return duplicates;
}

export function renderShortcutsProviderStatus() {
  if (!dom.shortcutsProviderList) return;

  const entries = Object.entries(providerCatalog);
  dom.shortcutsProviderList.innerHTML = "";

  if (entries.length === 0) {
    dom.shortcutsProviderList.innerHTML = `
      <div class="rounded-xl border border-th-border-lt bg-th-body px-3 py-3 text-xs text-zinc-500">
        Rilevamento provider non ancora disponibile.
      </div>
    `;
    return;
  }

  for (const [key, provider] of entries) {
    const status = getProviderStatusMeta(provider);
    const row = document.createElement("article");
    row.className = "rounded-xl border border-th-border-lt bg-th-body px-3 py-3";

    const head = document.createElement("div");
    head.className = "flex items-start justify-between gap-3";

    const info = document.createElement("div");
    info.className = "min-w-0";

    const title = document.createElement("p");
    title.className = "text-sm font-medium text-zinc-200";
    title.textContent = provider?.label || key;

    const command = document.createElement("p");
    command.className = "text-[11px] text-zinc-500 font-mono mt-1 break-all";
    command.textContent =
      provider?.defaultCommand && provider.defaultCommand.trim()
        ? `Comando: ${provider.defaultCommand}`
        : "Provider integrato nell'app";

    info.append(title, command);

    const badge = document.createElement("span");
    badge.className =
      `inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.badge}`;
    const dot = document.createElement("span");
    dot.className = `inline-block w-1.5 h-1.5 rounded-full ${status.dot}`;
    badge.append(dot, document.createTextNode(status.label));

    head.append(info, badge);

    const detail = document.createElement("p");
    detail.className = "mt-2 text-[11px] text-zinc-500 break-all";
    if (provider?.available === false) {
      detail.textContent =
        provider.availabilityMessage ||
        `${provider?.label || key} non \u00E8 installato o non \u00E8 nel PATH.`;
    } else if (provider?.resolvedCommandPath) {
      detail.textContent = `Rilevato in: ${provider.resolvedCommandPath}`;
    } else {
      detail.textContent = "Disponibile senza binario esterno richiesto.";
    }

    row.append(head, detail);
    dom.shortcutsProviderList.append(row);
  }
}

export function toggleShortcutsModal() {
  const willOpen = dom.shortcutsModal.classList.contains("hidden");
  dom.shortcutsModal.classList.toggle("hidden");

  if (willOpen) {
    syncShortcutDraft();
    renderShortcutsProviderStatus();
    renderShortcutEditor();
  } else if (captureActionId) {
    captureActionId = null;
    renderShortcutEditor();
  }
}

async function handleShortcutSave() {
  try {
    const duplicates = findDuplicateShortcuts();
    if (duplicates.length > 0) {
      const [firstA, firstB, shortcut] = duplicates[0];
      showNotice(`Shortcut duplicata (${shortcut}) tra "${firstA}" e "${firstB}".`, {
        type: "warning",
        timeoutMs: 3500
      });
      return;
    }

    const result = await saveShortcutConfig(shortcutDraft);
    syncShortcutDraft();
    captureActionId = null;
    renderShortcutEditor();
    updateShortcutTitles();
    dispatchShortcutUpdate();

    if (result.warning) {
      showNotice(result.warning, { type: "warning", timeoutMs: 4000 });
      return;
    }

    showNotice("Shortcut salvate.", { type: "success", timeoutMs: 2200 });
  } catch (error) {
    console.error("Save shortcuts failed:", error);
    showNotice("Impossibile salvare le shortcut.", { type: "error" });
  }
}

export function initShortcutsModal() {
  if (!dom.shortcutsProviderRefreshBtn) return;

  updateShortcutTitles();

  dom.shortcutsProviderRefreshBtn.addEventListener("click", async () => {
    try {
      dom.shortcutsProviderRefreshBtn.disabled = true;
      await refreshProviderCatalog(true);
      await Promise.all([loadPresets(), loadSessionsUI()]);
      if (dom.step2El && !dom.step2El.classList.contains("hidden")) {
        buildStep2();
      }
      renderShortcutsProviderStatus();
    } catch (error) {
      console.error("Shortcuts provider refresh failed:", error);
      showNotice("Impossibile aggiornare il rilevamento dei provider CLI.", { type: "error" });
    } finally {
      dom.shortcutsProviderRefreshBtn.disabled = false;
    }
  });

  dom.shortcutsSaveBtn?.addEventListener("click", () => handleShortcutSave());
  dom.openOperationsFromShortcutsBtn?.addEventListener("click", () => openCliOperationsModal());

  renderShortcutsProviderStatus();
  renderShortcutEditor();
}

export function bindKeyboardShortcuts() {
  document.addEventListener(
    "keydown",
    (event) => {
      if (captureActionId) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          captureActionId = null;
          renderShortcutEditor();
          return;
        }

        const shortcut = buildShortcutFromEvent(event);
        if (!shortcut) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        shortcutDraft[captureActionId] = shortcut;
        captureActionId = null;
        renderShortcutEditor();
        return;
      }

      if (shortcutMatchesEvent(event, getShortcutValue("toggleBroadcast"))) {
        if (isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        toggleBroadcast();
        return;
      }

      if (shortcutMatchesEvent(event, getShortcutValue("toggleShortcuts"))) {
        event.preventDefault();
        toggleShortcutsModal();
        return;
      }

      if (event.key === "Escape") {
        if (dom.operationsModal && !dom.operationsModal.classList.contains("hidden")) {
          toggleCliOperationsModal();
          return;
        }

        if (!dom.shortcutsModal.classList.contains("hidden")) {
          toggleShortcutsModal();
        }
      }
    },
    true
  );
}
