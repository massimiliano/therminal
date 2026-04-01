import { state, sessionStore, workspaces, providerCatalog } from "../state.js";
import { moveClientToZone } from "../layout.js";
import { openAddTerminalMenu } from "../add-terminal-menu.js";
import { dom } from "../dom.js";

function clearDropIndicators() {
  document.querySelectorAll(".terminal-cell.drag-source").forEach((element) => {
    element.classList.remove("drag-source");
  });
  document.querySelectorAll(".terminal-cell.drag-target").forEach((element) => {
    element.classList.remove("drag-target");
    delete element.dataset.dropZone;
  });
  document.querySelectorAll(".pane-drop-zone.active").forEach((element) => {
    element.classList.remove("active");
  });
  document.querySelectorAll(".terminal-cell.drop-target-active").forEach((element) => {
    element.classList.remove("drop-target-active");
  });
}

function clearDragState() {
  clearDropIndicators();
  document.body.classList.remove("session-dragging");
  if (dom.workspaceDragBadge) {
    dom.workspaceDragBadge.classList.add("hidden");
    dom.workspaceDragBadge.textContent = "";
  }
  state.dragSessionId = null;
}

function updateDragBadge(session) {
  if (!dom.workspaceDragBadge || !session) {
    return;
  }

  const providerLabel = providerCatalog[session.provider]?.label || session.provider;
  dom.workspaceDragBadge.textContent = `Trascini ${providerLabel} #${session.clientIndex + 1}. Bordi = split, centro = scambia.`;
  dom.workspaceDragBadge.classList.remove("hidden");
}

function ensureDropOverlay(cell) {
  let overlay = cell.querySelector(".pane-drop-zones");
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.className = "pane-drop-zones";
  overlay.innerHTML = `
    <div class="pane-drop-zone zone-center" data-zone="center">
      <i class="bi bi-arrow-left-right"></i>
      <span>Scambia</span>
    </div>
    <div class="pane-drop-zone zone-top" data-zone="top">
      <i class="bi bi-arrow-bar-up"></i>
      <span>Split sopra</span>
    </div>
    <div class="pane-drop-zone zone-right" data-zone="right">
      <i class="bi bi-arrow-bar-right"></i>
      <span>Split destra</span>
    </div>
    <div class="pane-drop-zone zone-bottom" data-zone="bottom">
      <i class="bi bi-arrow-bar-down"></i>
      <span>Split sotto</span>
    </div>
    <div class="pane-drop-zone zone-left" data-zone="left">
      <i class="bi bi-arrow-bar-left"></i>
      <span>Split sinistra</span>
    </div>
  `;
  cell.append(overlay);
  return overlay;
}

function isValidDragTarget(sourceSession, targetSession) {
  return (
    sourceSession &&
    targetSession &&
    sourceSession.id !== targetSession.id &&
    sourceSession.workspaceId === targetSession.workspaceId
  );
}

function getDropZoneForPoint(cell, clientX, clientY) {
  const rect = cell.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;
  const edgeX = Math.min(rect.width * 0.24, 110);
  const edgeY = Math.min(rect.height * 0.24, 76);

  if (offsetY <= edgeY) {
    return "top";
  }

  if (offsetY >= rect.height - edgeY) {
    return "bottom";
  }

  if (offsetX <= edgeX) {
    return "left";
  }

  if (offsetX >= rect.width - edgeX) {
    return "right";
  }

  return "center";
}

function markActiveZone(cell, zone) {
  cell.dataset.dropZone = zone;
  cell.classList.add("drag-target", "drop-target-active");
  cell.querySelectorAll(".pane-drop-zone").forEach((element) => {
    element.classList.toggle("active", element.dataset.zone === zone);
  });
}

function handleDropZone(event, targetSessionId, zone) {
  event.preventDefault();
  event.stopPropagation();

  const sourceId = state.dragSessionId || event.dataTransfer?.getData("text/plain");
  if (!sourceId || sourceId === targetSessionId) {
    clearDragState();
    return;
  }

  const sourceSession = sessionStore.get(sourceId);
  const targetSession = sessionStore.get(targetSessionId);
  if (!isValidDragTarget(sourceSession, targetSession)) {
    clearDragState();
    return;
  }

  const workspace = workspaces.get(targetSession.workspaceId);
  if (!workspace) {
    clearDragState();
    return;
  }

  moveClientToZone(workspace, sourceSession.clientId, targetSession.clientId, zone);
  clearDragState();
}

export function attachPaneInteractions(
  cell,
  { sessionId, clientId, workspaceId, splitVerticalBtn, splitHorizontalBtn }
) {
  const head = cell.querySelector(".terminal-cell-head");
  const dragSource = head;
  ensureDropOverlay(cell);

  if (dragSource) {
    dragSource.setAttribute("draggable", "true");
    dragSource.addEventListener("mousedown", (event) => {
      if (event.target.closest("button, input, textarea, select, a")) {
        dragSource.setAttribute("draggable", "false");
        return;
      }

      dragSource.setAttribute("draggable", "true");
    });

    dragSource.addEventListener("dragstart", (event) => {
      if (state.maximizedSessionId === sessionId) {
        event.preventDefault();
        return;
      }

      if (event.target.closest("button, input, textarea, select, a")) {
        event.preventDefault();
        return;
      }

      const session = sessionStore.get(sessionId);
      if (!session) {
        event.preventDefault();
        return;
      }

      state.dragSessionId = sessionId;
      event.dataTransfer?.setData("text/plain", sessionId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }

      requestAnimationFrame(() => {
        cell.classList.add("drag-source");
      });
      document.body.classList.add("session-dragging");
      updateDragBadge(session);
    });

    dragSource.addEventListener("dragend", () => {
      dragSource.setAttribute("draggable", "true");
      clearDragState();
    });

    dragSource.addEventListener("mouseup", () => {
      dragSource.setAttribute("draggable", "true");
    });
  }

  cell.addEventListener("dragover", (event) => {
    const sourceId = state.dragSessionId || event.dataTransfer?.getData("text/plain");
    if (!sourceId || sourceId === sessionId) {
      return;
    }

    const sourceSession = sessionStore.get(sourceId);
    const targetSession = sessionStore.get(sessionId);
    if (!isValidDragTarget(sourceSession, targetSession)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const zone = getDropZoneForPoint(cell, event.clientX, event.clientY);
    markActiveZone(cell, zone);
  });

  cell.addEventListener("dragleave", (event) => {
    if (!cell.contains(event.relatedTarget)) {
      cell.classList.remove("drag-target", "drop-target-active");
      delete cell.dataset.dropZone;
      cell.querySelectorAll(".pane-drop-zone.active").forEach((element) => {
        element.classList.remove("active");
      });
    }
  });

  cell.addEventListener("drop", (event) => {
    const zone = cell.dataset.dropZone || getDropZoneForPoint(cell, event.clientX, event.clientY);
    handleDropZone(event, sessionId, zone);
  });

  const openSplitMenu = (button, direction) => {
    openAddTerminalMenu(button, {
      workspaceId,
      targetClientId: clientId,
      splitDirection: direction,
      title: `${direction === "horizontal" ? "Split orizzontale" : "Split verticale"} sul pannello attivo`,
    });
  };

  splitVerticalBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    openSplitMenu(splitVerticalBtn, "vertical");
  });

  splitHorizontalBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    openSplitMenu(splitHorizontalBtn, "horizontal");
  });
}
