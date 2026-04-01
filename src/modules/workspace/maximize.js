import { state, workspaces, sessionStore } from "../state.js";
import { dom } from "../dom.js";
import { queueFit, refitWorkspace } from "../helpers.js";

export function toggleMaximize(sessionId) {
  const s = sessionStore.get(sessionId);
  if (!s) return;

  if (state.maximizedSessionId === sessionId) {
    restoreMaximized();
    return;
  }

  if (state.maximizedSessionId) restoreMaximized();

  s.maxOriginalParent = s.cell.parentNode;
  s.maxOriginalNext = s.cell.nextSibling;

  const ws = workspaces.get(s.workspaceId);
  if (ws) ws.element.classList.add("hidden");

  dom.maximizeBody.innerHTML = "";
  dom.maximizeBody.append(s.cell);
  dom.maximizeOverlay.classList.remove("hidden");
  state.maximizedSessionId = sessionId;

  requestAnimationFrame(() => queueFit(sessionId));
}

export function restoreMaximized() {
  if (!state.maximizedSessionId) return;

  const s = sessionStore.get(state.maximizedSessionId);
  if (s) {
    if (s.maxOriginalNext) {
      s.maxOriginalParent.insertBefore(s.cell, s.maxOriginalNext);
    } else {
      s.maxOriginalParent.append(s.cell);
    }

    const ws = workspaces.get(s.workspaceId);
    if (ws && state.activeView === s.workspaceId) {
      ws.element.classList.remove("hidden");
    }

    delete s.maxOriginalParent;
    delete s.maxOriginalNext;
  }

  dom.maximizeOverlay.classList.add("hidden");
  const prevId = state.maximizedSessionId;
  state.maximizedSessionId = null;

  if (s) {
    const ws = workspaces.get(s.workspaceId);
    if (ws) refitWorkspace(ws);
  } else {
    queueFit(prevId);
  }
}
