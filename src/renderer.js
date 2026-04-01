import { TerminalCtor, FitAddonCtor } from "./modules/core/state/xterm.js";
import { updateFontSizeLabel } from "./modules/workspace/fontsize.js";
import { buildCountOptions } from "./modules/sessions/wizard.js";
import { loadPresets } from "./modules/sessions/presets.js";
import { bindUiEvents, bindIpcEvents } from "./modules/ui/events.js";
import { bindKeyboardShortcuts, initShortcutsModal } from "./modules/ui/shortcuts.js";
import { loadAppConfig } from "./modules/ui/app-config.js";
import { setOnCloseWorkspace } from "./modules/workspace/tabs.js";
import { closeWorkspace } from "./modules/workspace/workspace.js";
import { loadSessionsUI } from "./modules/sessions/session-state.js";
import { initMonitor } from "./modules/ui/monitor.js";
import { initServiceStatusPanel } from "./modules/providers/service-status.js";
import { initUsagePanel } from "./modules/usage/usage-panel.js";
import { refreshProviderCatalog } from "./modules/providers/providers.js";
import { initVoiceToText } from "./modules/voice/voice.js";
import { initSharedContext } from "./modules/shared-context/shared-context.js";
import { initCliOperationsModal } from "./modules/sessions/cli-operations.js";
import { initAgentCreator } from "./modules/ui/agent-creator.js";
import { initHomePages } from "./modules/ui/home-pages.js";

function setBootOverlayState(state, message) {
  const overlay = document.getElementById("appBootOverlay");
  const status = document.getElementById("appBootOverlayStatus");
  const title = document.getElementById("appBootOverlayTitle");
  const panel = overlay?.querySelector(".app-boot-overlay__panel");
  const spinner = overlay?.querySelector(".app-boot-overlay__spinner");

  if (!overlay) {
    return;
  }

  if (status && typeof message === "string") {
    status.textContent = message;
  }

  overlay.dataset.state = state;
  overlay.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  if (title) {
    title.textContent = state === "error" ? "Avvio interrotto" : "Avvio dell'applicazione";
    title.style.color = state === "error" ? "#fecaca" : "";
  }

  if (status) {
    status.style.color = state === "error" ? "#fca5a5" : "";
  }

  if (panel) {
    panel.style.borderColor = state === "error" ? "rgba(248, 113, 113, 0.35)" : "";
  }

  if (spinner) {
    spinner.hidden = state === "error";
  }
}

function hideBootOverlay() {
  const overlay = document.getElementById("appBootOverlay");
  document.body.classList.remove("app-loading");
  document.body.classList.add("app-ready");

  if (!overlay) {
    return;
  }

  overlay.dataset.state = "ready";
  window.setTimeout(() => overlay.remove(), 260);
}

async function bootstrap() {
  if (!TerminalCtor || !FitAddonCtor || !window.launcherAPI) {
    console.error("Missing dependencies");
    setBootOverlayState("error", "Dipendenze di bootstrap mancanti. Verifica preload e librerie xterm.");
    return;
  }

  let bootFailed = false;

  try {
    setBootOverlayState("loading", "Caricamento interfaccia in corso...");
    await refreshProviderCatalog();
    await loadAppConfig();

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }

    setOnCloseWorkspace(closeWorkspace);

    updateFontSizeLabel();
    buildCountOptions();
    loadPresets();
    loadSessionsUI();
    bindUiEvents();
    bindIpcEvents();
    bindKeyboardShortcuts();
    initShortcutsModal();
    initCliOperationsModal();
    initHomePages();
    initMonitor();
    initServiceStatusPanel();
    initUsagePanel();
    initSharedContext();
    initAgentCreator();
    await initVoiceToText();
  } catch (error) {
    bootFailed = true;
    console.error("Bootstrap failed:", error);
    setBootOverlayState("error", "Bootstrap fallito. Verifica la console dell'app.");
  } finally {
    if (!bootFailed) {
      window.requestAnimationFrame(() => {
        hideBootOverlay();
      });
    }
  }
}

bootstrap();
