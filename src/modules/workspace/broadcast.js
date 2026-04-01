import { state, sessionStore } from "../state.js";
import { dom } from "../dom.js";

export function toggleBroadcast() {
  state.broadcastMode = !state.broadcastMode;
  dom.broadcastBar.classList.toggle("hidden", !state.broadcastMode);

  if (state.broadcastMode) {
    dom.broadcastToggle.classList.remove("text-zinc-500");
    dom.broadcastToggle.classList.add("text-emerald-400", "bg-emerald-400/5");
  } else {
    dom.broadcastToggle.classList.add("text-zinc-500");
    dom.broadcastToggle.classList.remove("text-emerald-400", "bg-emerald-400/5");
  }

  if (state.broadcastMode) {
    dom.broadcastInput.value = "";
    dom.broadcastInput.focus();
  }
}

export function sendBroadcast(text) {
  for (const [id, s] of sessionStore) {
    if (s.workspaceId === state.activeView) {
      window.launcherAPI.writeSession(id, text);
    }
  }
}
