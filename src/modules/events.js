import { state, sessionStore, providerCatalog } from "./state.js";
import { dom } from "./dom.js";
import { queueFit } from "./helpers.js";
import { switchView } from "./tabs.js";
import { buildStep2, showStep } from "./wizard.js";
import { launchWorkspace } from "./workspace.js";
import { saveCurrentAsPreset, confirmSavePreset, saveWorkspaceAsPreset, loadPresets } from "./presets.js";
import { toggleBroadcast, sendBroadcast } from "./broadcast.js";
import { changeFontSize } from "./fontsize.js";
import { restoreMaximized } from "./maximize.js";
import { restartWorkspaceSession } from "./session.js";
import { toggleShortcutsModal } from "./shortcuts.js";
import { saveSessionAs, collectSessionState, loadSessionsUI } from "./session-state.js";
import { hideNotice, showNotice } from "./notices.js";
import { dismissProviderAvailabilityBanner, refreshProviderCatalog } from "./providers.js";

export function bindIpcEvents() {
  window.launcherAPI.onSessionData((payload) => {
    const s = sessionStore.get(payload.id);
    if (!s) return;
    s.terminal.write(payload.data);
  });

  window.launcherAPI.onSessionExit((payload) => {
    const s = sessionStore.get(payload.id);
    if (!s) return;

    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : "?";
    s.info.textContent += ` (exit ${exitCode})`;
    s.cell.classList.add("ended");

    const overlay = document.createElement("div");
    overlay.className = "absolute inset-0 bg-th-body/90 flex items-center justify-center z-[5]";
    overlay.innerHTML = `
      <div class="flex flex-col items-center gap-1">
        <i class="bi bi-exclamation-triangle text-2xl text-zinc-500"></i>
        <p class="text-sm text-zinc-400 mt-2">Processo terminato (exit ${exitCode})</p>
        <button class="mt-2 px-4 py-1.5 rounded-md text-xs font-semibold bg-emerald-400/10 border border-emerald-400/30 text-emerald-400 cursor-pointer transition-all duration-150 flex items-center gap-1.5 hover:bg-emerald-400/20 hover:border-emerald-400">
          <i class="bi bi-arrow-clockwise"></i> Riavvia
        </button>
      </div>
    `;
    s.cell.querySelector(".terminal-cell-body").append(overlay);

    overlay.querySelector("button").addEventListener("click", async () => {
      await restartWorkspaceSession(payload.id);
    });

    if (document.hidden && exitCode !== 0) {
      try {
        if (Notification.permission === "granted") {
          new Notification("Therminal", {
            body: `${providerCatalog[s.provider]?.label || s.provider} #${s.clientIndex + 1} terminato (exit ${exitCode})`,
          });
        }
      } catch {}
    }
  });

  window.addEventListener("resize", () => {
    for (const id of sessionStore.keys()) {
      queueFit(id);
    }
  });
}

export function bindUiEvents() {
  dom.appNoticeCloseBtn?.addEventListener("click", () => hideNotice());
  dom.providerStatusCloseBtn?.addEventListener("click", () => dismissProviderAvailabilityBanner());

  dom.providerStatusRefreshBtn?.addEventListener("click", async () => {
    try {
      dom.providerStatusRefreshBtn.disabled = true;
      await refreshProviderCatalog(true);
      await Promise.all([loadPresets(), loadSessionsUI()]);
      if (!dom.step2El.classList.contains("hidden")) {
        buildStep2();
      }
    } catch (error) {
      console.error("Provider refresh failed:", error);
      showNotice("Impossibile aggiornare lo stato dei provider CLI.", { type: "error" });
    } finally {
      dom.providerStatusRefreshBtn.disabled = false;
    }
  });

  dom.cwdBrowseBtn.addEventListener("click", async () => {
    const selectedPath = await window.launcherAPI.openDirectoryDialog(dom.cwdInput.value.trim());
    if (!selectedPath) return;
    dom.cwdInput.value = selectedPath;
  });

  dom.saveSessionBtn.addEventListener("click", () => {
    const data = collectSessionState();
    if (data.workspaces.length === 0) return;
    // Reuse preset name modal for session name
    dom.presetNameModal.classList.remove("hidden");
    dom.presetNameInput.value = "";
    dom.presetNameInput.placeholder = "Nome della sessione...";
    dom.presetNameInput.focus();
    dom.presetNameModal.dataset.mode = "session";
  });

  dom.homeTab.addEventListener("click", () => switchView("home"));
  dom.backBtn.addEventListener("click", () => showStep(1));
  dom.launchBtn.addEventListener("click", () => launchWorkspace());
  dom.savePresetBtn.addEventListener("click", () => saveCurrentAsPreset());

  dom.broadcastToggle.addEventListener("click", () => toggleBroadcast());
  dom.broadcastInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = dom.broadcastInput.value;
      if (text) {
        sendBroadcast(text + "\r");
        dom.broadcastInput.value = "";
      }
    }
    if (e.key === "Escape") {
      toggleBroadcast();
    }
  });

  dom.fontMinus.addEventListener("click", () => changeFontSize(-1));
  dom.fontPlus.addEventListener("click", () => changeFontSize(1));

  dom.maximizeCloseBtn.addEventListener("click", () => restoreMaximized());

  dom.presetNameConfirm.addEventListener("click", () => handleNameModalConfirm());
  dom.presetNameCancel.addEventListener("click", () => closeNameModal());
  dom.presetNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleNameModalConfirm();
    if (e.key === "Escape") dom.presetNameModal.classList.add("hidden");
  });

  function closeNameModal() {
    dom.presetNameModal.classList.add("hidden");
    delete dom.presetNameModal.dataset.mode;
    delete dom.presetNameModal.dataset.workspaceId;
    dom.presetNameInput.placeholder = "Nome del preset...";
  }

  async function handleNameModalConfirm() {
    const name = dom.presetNameInput.value.trim();
    if (!name) return;

    if (dom.presetNameModal.dataset.mode === "session") {
      await saveSessionAs(name);
      loadSessionsUI();
    } else if (dom.presetNameModal.dataset.mode === "workspace-preset") {
      const workspaceId = dom.presetNameModal.dataset.workspaceId;
      await saveWorkspaceAsPreset(name, workspaceId);
    } else {
      await confirmSavePreset();
    }
    closeNameModal();
  }

  dom.shortcutsToggle.addEventListener("click", () => toggleShortcutsModal());
  dom.shortcutsCloseBtn.addEventListener("click", () => toggleShortcutsModal());
  dom.shortcutsModal.querySelector(".shortcuts-backdrop").addEventListener("click", () =>
    toggleShortcutsModal()
  );
}
