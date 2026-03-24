import { sessionStore, scheduledFit } from "./state.js";
import { dom } from "./dom.js";

export function shortId(value) {
  return value.split("-")[0];
}

export function queueFit(sessionId) {
  const existing = scheduledFit.get(sessionId);
  if (existing) cancelAnimationFrame(existing);

  const raf = requestAnimationFrame(() => {
    scheduledFit.delete(sessionId);
    const state = sessionStore.get(sessionId);
    if (!state) return;
    try {
      state.fitAddon.fit();
      window.launcherAPI.resizeSession(sessionId, state.terminal.cols, state.terminal.rows);
    } catch {
      // Ignore fit errors during removal.
    }
  });
  scheduledFit.set(sessionId, raf);
}

export function refitWorkspace(workspace) {
  for (const client of workspace.clients) {
    if (client.sessionId) queueFit(client.sessionId);
  }
}

export function updateSavedSection() {
  const hasSession = !dom.sessionSection.classList.contains("hidden");
  const hasPreset = !dom.presetSection.classList.contains("hidden");
  dom.savedSection.classList.toggle("hidden", !hasSession && !hasPreset);
}
