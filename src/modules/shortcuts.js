import { dom } from "./dom.js";
import { toggleBroadcast } from "./broadcast.js";
import { providerCatalog } from "./state.js";
import { buildStep2 } from "./wizard.js";
import { loadPresets } from "./presets.js";
import { loadSessionsUI } from "./session-state.js";
import { showNotice } from "./notices.js";
import { refreshProviderCatalog } from "./providers.js";

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
    renderShortcutsProviderStatus();
  }
}

export function initShortcutsModal() {
  if (!dom.shortcutsProviderRefreshBtn) return;

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

  renderShortcutsProviderStatus();
}

export function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+Shift+B: toggle broadcast
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
      e.preventDefault();
      toggleBroadcast();
      return;
    }

    // Ctrl+/: toggle shortcuts modal
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      toggleShortcutsModal();
      return;
    }

    // Escape: close shortcuts modal
    if (e.key === "Escape") {
      if (!dom.shortcutsModal.classList.contains("hidden")) {
        toggleShortcutsModal();
        return;
      }
    }
  });
}
