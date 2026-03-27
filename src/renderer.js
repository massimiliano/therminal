import { TerminalCtor, FitAddonCtor } from "./modules/state.js";
import { updateFontSizeLabel } from "./modules/fontsize.js";
import { buildCountOptions } from "./modules/wizard.js";
import { loadPresets } from "./modules/presets.js";
import { bindUiEvents, bindIpcEvents } from "./modules/events.js";
import { bindKeyboardShortcuts, initShortcutsModal } from "./modules/shortcuts.js";
import { setOnCloseWorkspace } from "./modules/tabs.js";
import { closeWorkspace } from "./modules/workspace.js";
import { loadSessionsUI } from "./modules/session-state.js";
import { initMonitor } from "./modules/monitor.js";
import { initServiceStatusPanel } from "./modules/service-status.js";
import { initUsagePanel } from "./modules/usage-panel.js";
import { refreshProviderCatalog } from "./modules/providers.js";
import { initVoiceToText } from "./modules/voice.js";
import { initSharedContext } from "./modules/shared-context.js";

async function bootstrap() {
  if (!TerminalCtor || !FitAddonCtor || !window.launcherAPI) {
    console.error("Missing dependencies");
    return;
  }

  try {
    await refreshProviderCatalog();

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
    initMonitor();
    initServiceStatusPanel();
    initUsagePanel();
    initSharedContext();
    await initVoiceToText();
  } catch (error) {
    console.error("Bootstrap failed:", error);
  }
}

bootstrap();
