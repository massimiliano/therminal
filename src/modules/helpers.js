import { sessionStore, scheduledFit } from "./state.js";
import { dom } from "./dom.js";

const scheduledBackendResize = new Map();
const BACKEND_RESIZE_DEBOUNCE_MS = 120;

export function shortId(value) {
  return value.split("-")[0];
}

function clearBackendResize(sessionId) {
  const timeoutId = scheduledBackendResize.get(sessionId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    scheduledBackendResize.delete(sessionId);
  }
}

function pushBackendResize(sessionId, state) {
  const cols = state?.terminal?.cols;
  const rows = state?.terminal?.rows;

  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) {
    return;
  }

  if (state.lastPtyCols === cols && state.lastPtyRows === rows) {
    return;
  }

  state.lastPtyCols = cols;
  state.lastPtyRows = rows;
  window.launcherAPI.resizeSession(sessionId, cols, rows);
}

export function cancelQueuedFit(sessionId) {
  const existing = scheduledFit.get(sessionId);
  if (existing) cancelAnimationFrame(existing);
  scheduledFit.delete(sessionId);
  clearBackendResize(sessionId);
}

export function queueFit(sessionId, { backend = "debounced" } = {}) {
  cancelQueuedFit(sessionId);

  const raf = requestAnimationFrame(() => {
    scheduledFit.delete(sessionId);
    const state = sessionStore.get(sessionId);
    if (!state) return;

    try {
      if (typeof state.onFit === "function" && !state.fitAddon) {
        state.onFit();
        return;
      }

      state.fitAddon.fit();

      if (state.terminal.rows > 0) {
        state.terminal.refresh(0, state.terminal.rows - 1);
      }

      if (backend === "none") {
        return;
      }

      if (backend === "immediate") {
        clearBackendResize(sessionId);
        pushBackendResize(sessionId, state);
        return;
      }

      const timeoutId = setTimeout(() => {
        scheduledBackendResize.delete(sessionId);
        const nextState = sessionStore.get(sessionId);
        if (!nextState) {
          return;
        }
        pushBackendResize(sessionId, nextState);
      }, BACKEND_RESIZE_DEBOUNCE_MS);
      scheduledBackendResize.set(sessionId, timeoutId);
    } catch {
      // Ignore fit errors during removal.
    }
  });
  scheduledFit.set(sessionId, raf);
}

export function refitWorkspace(workspace, options) {
  for (const client of workspace.clients) {
    if (client.sessionId) queueFit(client.sessionId, options);
  }
}

export function updateSavedSection() {
  const hasSession = !dom.sessionSection.classList.contains("hidden");
  const hasPreset = !dom.presetSection.classList.contains("hidden");
  const hasSavedContent = hasSession || hasPreset;
  dom.savedSection.classList.toggle("hidden", !hasSavedContent);
  dom.savedSectionEmpty?.classList.toggle("hidden", hasSavedContent);
}
