import { state, workspaces, sessionStore } from "../state.js";
import { dom } from "../dom.js";
import { refitWorkspace } from "../helpers.js";
import { attachSessionToHost } from "../terminal/attachment.js";
import { fitStructuralTerminalChange } from "../terminal/resize-policy.js";

export function toggleMaximize(sessionId) {
  const s = sessionStore.get(sessionId);
  if (!s) return;

  if (state.maximizedSessionId === sessionId) {
    restoreMaximized();
    return;
  }

  if (state.maximizedSessionId) restoreMaximized();

  const ws = workspaces.get(s.workspaceId);
  if (ws) ws.element.classList.add("hidden");

  dom.maximizeBody.innerHTML = "";
  attachSessionToHost(s, dom.maximizeBody, { preserveWorkspaceHost: true });
  dom.maximizeOverlay.classList.remove("hidden");
  state.maximizedSessionId = sessionId;

  requestAnimationFrame(() => fitStructuralTerminalChange(sessionId));
}

export function restoreMaximized() {
  if (!state.maximizedSessionId) return;

  const s = sessionStore.get(state.maximizedSessionId);
  if (s) {
    attachSessionToHost(s, s.host, { preserveWorkspaceHost: true });

    const ws = workspaces.get(s.workspaceId);
    if (ws && state.activeView === s.workspaceId) {
      ws.element.classList.remove("hidden");
    }
  }

  dom.maximizeOverlay.classList.add("hidden");
  const prevId = state.maximizedSessionId;
  state.maximizedSessionId = null;

  if (s) {
    const ws = workspaces.get(s.workspaceId);
    if (ws) {
      requestAnimationFrame(() => {
        refitWorkspace(ws, { backend: "immediate", force: true });
      });
    }
  } else {
    fitStructuralTerminalChange(prevId);
  }
}
