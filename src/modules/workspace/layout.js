import { state, workspaces, sessionStore, GUTTER_PX } from "../state.js";
import { renderTabs, switchView } from "../tabs.js";
import { restoreMaximized } from "../maximize.js";
import { refitWorkspace } from "../helpers.js";
import { attachSessionToHost } from "../terminal/attachment.js";
import {
  createClientId,
  createLeafNode,
  ensureWorkspaceLayout,
  listLeafClientIds,
  normalizeSplitSizes,
  normalizeWorkspaceLayout,
  removeClientFromNode,
  splitClientNode,
  swapLeafClients,
  walkLeaves
} from "./layout-tree.js";

const MIN_PANE_PX = 140;

function getLayoutDomCache(workspace) {
  if (!workspace.layoutDomCache) {
    workspace.layoutDomCache = {
      leaves: new Map(),
      splits: new Map(),
    };
  }

  return workspace.layoutDomCache;
}

function setClientPaneId(workspace, clientId, paneId) {
  const client = workspace.clients.find((entry) => entry.id === clientId);
  if (client) {
    client.paneId = paneId;
  }

  if (client?.sessionId) {
    const session = sessionStore.get(client.sessionId);
    if (session) {
      session.paneId = paneId;
    }
  }
}

function updateSessionIndexLabel(session, displayIndex) {
  if (!session?.info) {
    return;
  }

  const currentText = session.info.textContent || "";
  const suffix = currentText.replace(/^#\d+/, "");
  session.info.textContent = `#${displayIndex + 1}${suffix}`;
  session.clientIndex = displayIndex;
}

function setSplitChildFlex(splitEl, sizes) {
  const wrappers = splitEl.querySelectorAll(":scope > .workspace-split-child");
  wrappers.forEach((wrapper, index) => {
    wrapper.style.flex = `${sizes[index] || 1} 1 0%`;
  });
}

function startSplitResize(event, workspace, splitNode, gapIndex) {
  event.preventDefault();

  const dividerEl = event.currentTarget;
  const splitEl = dividerEl.parentElement;
  const isVertical = splitNode.orientation === "vertical";
  const sizes = splitNode.sizes;
  const startPointer = isVertical ? event.clientX : event.clientY;
  const containerSize = isVertical ? splitEl.clientWidth : splitEl.clientHeight;
  const available = containerSize - Math.max(0, sizes.length - 1) * GUTTER_PX;
  const startA = sizes[gapIndex];
  const startB = sizes[gapIndex + 1];
  const minRatio = Math.min(0.45, MIN_PANE_PX / Math.max(available, MIN_PANE_PX * 2));

  dividerEl.classList.add("active");
  document.body.classList.add("layout-resizing");
  document.body.style.cursor = isVertical ? "col-resize" : "row-resize";

  function onMove(moveEvent) {
    const currentPointer = isVertical ? moveEvent.clientX : moveEvent.clientY;
    const delta = currentPointer - startPointer;
    const deltaRatio = available > 0 ? delta / available : 0;
    const total = startA + startB;

    let nextA = startA + deltaRatio;
    let nextB = startB - deltaRatio;

    if (nextA < minRatio) {
      nextA = minRatio;
      nextB = total - minRatio;
    }

    if (nextB < minRatio) {
      nextB = minRatio;
      nextA = total - minRatio;
    }

    sizes[gapIndex] = nextA;
    sizes[gapIndex + 1] = nextB;
    splitNode.sizes = normalizeSplitSizes(sizes, splitNode.children.length);
    setSplitChildFlex(splitEl, splitNode.sizes);
    refitWorkspace(workspace, { backend: "debounced" });
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    dividerEl.classList.remove("active");
    document.body.classList.remove("layout-resizing");
    document.body.style.cursor = "";
    refitWorkspace(workspace, { backend: "immediate", force: true });
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function createDivider(workspace, splitNode, gapIndex) {
  const divider = document.createElement("div");
  const isVertical = splitNode.orientation === "vertical";
  divider.className = `workspace-divider grid-divider ${isVertical ? "vertical h-full w-1 cursor-col-resize" : "horizontal w-full h-1 cursor-row-resize"} bg-th-border relative shrink-0 transition-[background] duration-150 hover:bg-emerald-400`;
  divider.addEventListener("mousedown", (event) => startSplitResize(event, workspace, splitNode, gapIndex));
  return divider;
}

function renderLeafNode(workspace, node) {
  const cache = getLayoutDomCache(workspace);
  let leaf = cache.leaves.get(node.id);
  let slot = leaf?._slot || null;

  if (!leaf) {
    leaf = document.createElement("div");
    leaf.className = "workspace-leaf relative flex flex-1 h-full w-full min-h-0 min-w-0";

    slot = document.createElement("div");
    slot.className = "workspace-pane-slot flex flex-1 h-full w-full min-h-0 min-w-0";
    leaf.append(slot);

    leaf._slot = slot;
    cache.leaves.set(node.id, leaf);
  }

  leaf.dataset.leafId = node.id;
  leaf.dataset.clientId = node.clientId;

  if (slot && (leaf.firstChild !== slot || leaf.childNodes.length !== 1)) {
    leaf.replaceChildren(slot);
  }

  workspace.leafHosts.set(node.clientId, slot);
  setClientPaneId(workspace, node.clientId, node.id);

  const client = workspace.clients.find((entry) => entry.id === node.clientId);
  if (client?.sessionId) {
    const session = sessionStore.get(client.sessionId);
    if (session?.cell) {
      attachSessionToHost(session, slot);
    }
  }

  return leaf;
}

function renderSplitNode(workspace, node) {
  const cache = getLayoutDomCache(workspace);
  let split = cache.splits.get(node.id);

  if (!split) {
    split = document.createElement("div");
    cache.splits.set(node.id, split);
  }

  split.className = `workspace-split flex flex-1 h-full w-full min-h-0 min-w-0 ${node.orientation === "vertical" ? "flex-row" : "flex-col"}`;
  split.dataset.splitId = node.id;

  const fragment = document.createDocumentFragment();
  node.children.forEach((child, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "workspace-split-child flex flex-1 h-full w-full min-h-0 min-w-0";
    wrapper.style.flex = `${node.sizes[index] || 1} 1 0%`;
    wrapper.append(renderNode(workspace, child));
    fragment.append(wrapper);

    if (index < node.children.length - 1) {
      fragment.append(createDivider(workspace, node, index));
    }
  });

  split.replaceChildren(fragment);
  return split;
}

function renderNode(workspace, node) {
  if (node.type === "leaf") {
    return renderLeafNode(workspace, node);
  }

  return renderSplitNode(workspace, node);
}

function pruneLayoutDomCache(workspace) {
  const cache = getLayoutDomCache(workspace);
  const activeLeafIds = new Set();
  const activeSplitIds = new Set();

  (function collect(node) {
    if (!node) {
      return;
    }

    if (node.type === "leaf") {
      activeLeafIds.add(node.id);
      return;
    }

    activeSplitIds.add(node.id);
    node.children.forEach((child) => collect(child));
  })(workspace.layout);

  for (const [leafId] of cache.leaves) {
    if (!activeLeafIds.has(leafId)) {
      cache.leaves.delete(leafId);
    }
  }

  for (const [splitId] of cache.splits) {
    if (!activeSplitIds.has(splitId)) {
      cache.splits.delete(splitId);
    }
  }
}

function collectDisplayOrder(workspace) {
  const orderedClientIds = [];
  walkLeaves(workspace.layout, (leaf) => {
    orderedClientIds.push(leaf.clientId);
  });

  orderedClientIds.forEach((clientId, displayIndex) => {
    const client = workspace.clients.find((entry) => entry.id === clientId);
    if (!client?.sessionId) {
      return;
    }

    const session = sessionStore.get(client.sessionId);
    if (session) {
      updateSessionIndexLabel(session, displayIndex);
    }
  });
}

export { createClientId, normalizeWorkspaceLayout };

export function renderWorkspaceLayout(workspace) {
  if (!workspace) {
    return;
  }

  if (state.maximizedSessionId) {
    const maximized = sessionStore.get(state.maximizedSessionId);
    if (maximized?.workspaceId === workspace.id) {
      restoreMaximized();
    }
  }

  if (workspace.clients.length === 0) {
    workspace.element?.remove();
    workspaces.delete(workspace.id);

    if (state.activeView === workspace.id) {
      switchView("home");
    } else {
      renderTabs();
    }
    return;
  }

  ensureWorkspaceLayout(workspace);
  workspace.leafHosts = new Map();

  const nextRoot = renderNode(workspace, workspace.layout);
  if (workspace.element.firstChild !== nextRoot || workspace.element.childNodes.length !== 1) {
    workspace.element.replaceChildren(nextRoot);
  }
  pruneLayoutDomCache(workspace);

  if (state.activeView === workspace.id) {
    workspace.element.classList.remove("hidden");
  }

  collectDisplayOrder(workspace);
  renderTabs();
  refitWorkspace(workspace, { backend: "immediate", force: true });
}

export function getWorkspaceHost(workspace, clientId) {
  if (!workspace?.leafHosts) {
    return null;
  }
  return workspace.leafHosts.get(clientId) || null;
}

export function addClientToLayout(workspace, clientId, { targetClientId = null, splitDirection = "vertical" } = {}) {
  if (!workspace.layout) {
    workspace.layout = createLeafNode(clientId);
    return workspace.layout;
  }

  const direction = splitDirection === "horizontal" ? "horizontal" : "vertical";
  const fallbackTarget =
    targetClientId ||
    listLeafClientIds(workspace.layout).slice(-1)[0];

  workspace.layout = splitClientNode(workspace.layout, fallbackTarget, clientId, direction, "after");
  return workspace.layout;
}

export function removeClientFromLayout(workspace, clientId) {
  const result = removeClientFromNode(workspace.layout, clientId);
  workspace.layout = result.node;
  return result.removed;
}

export function moveClientToZone(workspace, sourceClientId, targetClientId, zone) {
  if (!workspace || !sourceClientId || !targetClientId || sourceClientId === targetClientId) {
    return false;
  }

  if (zone === "center") {
    workspace.layout = swapLeafClients(workspace.layout, sourceClientId, targetClientId);
    renderWorkspaceLayout(workspace);
    return true;
  }

  const dropMap = {
    left: { direction: "vertical", placement: "before" },
    right: { direction: "vertical", placement: "after" },
    top: { direction: "horizontal", placement: "before" },
    bottom: { direction: "horizontal", placement: "after" }
  };

  const config = dropMap[zone];
  if (!config) {
    return false;
  }

  const removal = removeClientFromNode(workspace.layout, sourceClientId);
  if (!removal.removed) {
    return false;
  }

  workspace.layout = removal.node;
  if (!workspace.layout) {
    workspace.layout = createLeafNode(sourceClientId);
    renderWorkspaceLayout(workspace);
    return true;
  }

  workspace.layout = splitClientNode(
    workspace.layout,
    targetClientId,
    sourceClientId,
    config.direction,
    config.placement
  );
  renderWorkspaceLayout(workspace);
  return true;
}
