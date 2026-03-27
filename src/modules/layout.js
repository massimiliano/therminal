import { state, workspaces, sessionStore, GUTTER_PX } from "./state.js";
import { renderTabs, switchView } from "./tabs.js";
import { restoreMaximized } from "./maximize.js";
import { refitWorkspace } from "./helpers.js";

const MIN_PANE_PX = 140;

function createNodeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createClientId() {
  return `client-${crypto.randomUUID()}`;
}

export function createLeafNode(clientId, id = createNodeId("leaf")) {
  return {
    id,
    type: "leaf",
    clientId,
  };
}

function createSplitNode(orientation, children, sizes, id = createNodeId("split")) {
  return {
    id,
    type: "split",
    orientation,
    children,
    sizes: normalizeSplitSizes(sizes, children.length),
  };
}

function normalizeSplitSizes(sizes, childCount) {
  if (childCount <= 0) {
    return [];
  }

  const source = Array.isArray(sizes) ? sizes.slice(0, childCount) : [];
  while (source.length < childCount) {
    source.push(1);
  }

  const sanitized = source.map((size) => {
    const value = Number(size);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = sanitized.reduce((sum, value) => sum + value, 0) || childCount;
  return sanitized.map((value) => value / total);
}

function cloneNode(node) {
  if (!node) {
    return null;
  }

  if (node.type === "leaf") {
    return {
      id: node.id || createNodeId("leaf"),
      type: "leaf",
      clientId: node.clientId,
    };
  }

  return {
    id: node.id || createNodeId("split"),
    type: "split",
    orientation: node.orientation === "horizontal" ? "horizontal" : "vertical",
    sizes: Array.isArray(node.sizes) ? node.sizes.slice() : [],
    children: Array.isArray(node.children) ? node.children.map((child) => cloneNode(child)) : [],
  };
}

function walkLeaves(node, visitor) {
  if (!node) {
    return;
  }

  if (node.type === "leaf") {
    visitor(node);
    return;
  }

  node.children.forEach((child) => walkLeaves(child, visitor));
}

function listLeafClientIds(node) {
  const ids = [];
  walkLeaves(node, (leaf) => ids.push(leaf.clientId));
  return ids;
}

function buildBalancedLayout(clientIds, depth = 0) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    return null;
  }

  if (clientIds.length === 1) {
    return createLeafNode(clientIds[0]);
  }

  const midpoint = Math.ceil(clientIds.length / 2);
  const orientation = depth % 2 === 0 ? "vertical" : "horizontal";
  return createSplitNode(
    orientation,
    [
      buildBalancedLayout(clientIds.slice(0, midpoint), depth + 1),
      buildBalancedLayout(clientIds.slice(midpoint), depth + 1),
    ],
    [1, 1]
  );
}

function sanitizeLayoutNode(node, validClientIds, usedClientIds) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.type === "leaf") {
    if (!validClientIds.has(node.clientId) || usedClientIds.has(node.clientId)) {
      return null;
    }

    usedClientIds.add(node.clientId);
    return {
      id: node.id || createNodeId("leaf"),
      type: "leaf",
      clientId: node.clientId,
    };
  }

  if (node.type !== "split" || !Array.isArray(node.children)) {
    return null;
  }

  const children = node.children
    .map((child) => sanitizeLayoutNode(child, validClientIds, usedClientIds))
    .filter(Boolean);

  if (children.length === 0) {
    return null;
  }

  if (children.length === 1) {
    return children[0];
  }

  return createSplitNode(
    node.orientation === "horizontal" ? "horizontal" : "vertical",
    children,
    node.sizes
  );
}

function findLeafMeta(node, clientId, parent = null, index = -1) {
  if (!node) {
    return null;
  }

  if (node.type === "leaf") {
    return node.clientId === clientId ? { node, parent, index } : null;
  }

  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    const found = findLeafMeta(node.children[childIndex], clientId, node, childIndex);
    if (found) {
      return found;
    }
  }

  return null;
}

function replaceNode(root, targetId, replacement) {
  if (!root) {
    return replacement;
  }

  if (root.id === targetId) {
    return replacement;
  }

  if (root.type === "leaf") {
    return root;
  }

  root.children = root.children.map((child) => replaceNode(child, targetId, replacement));
  return root;
}

function removeClientFromNode(node, clientId) {
  if (!node) {
    return { node: null, removed: false };
  }

  if (node.type === "leaf") {
    if (node.clientId !== clientId) {
      return { node, removed: false };
    }
    return { node: null, removed: true };
  }

  let removed = false;
  const nextChildren = [];
  const nextSizes = [];

  node.children.forEach((child, childIndex) => {
    const result = removeClientFromNode(child, clientId);
    if (result.removed) {
      removed = true;
    }
    if (result.node) {
      nextChildren.push(result.node);
      nextSizes.push(node.sizes?.[childIndex] || 1);
    }
  });

  if (!removed) {
    return { node, removed: false };
  }

  if (nextChildren.length === 0) {
    return { node: null, removed: true };
  }

  if (nextChildren.length === 1) {
    return { node: nextChildren[0], removed: true };
  }

  return {
    node: createSplitNode(node.orientation, nextChildren, nextSizes, node.id),
    removed: true,
  };
}

function splitClientNode(root, targetClientId, newClientId, direction, placement) {
  const source = cloneNode(root);
  const target = findLeafMeta(source, targetClientId);
  if (!target) {
    return source;
  }

  const newLeaf = createLeafNode(newClientId);
  const currentLeaf = target.node;

  if (target.parent && target.parent.type === "split" && target.parent.orientation === direction) {
    const currentSize = target.parent.sizes?.[target.index] || 1;
    const insertIndex = placement === "before" ? target.index : target.index + 1;
    target.parent.children.splice(insertIndex, 0, newLeaf);
    target.parent.sizes.splice(target.index, 1, currentSize / 2, currentSize / 2);
    if (placement === "before") {
      const swapped = target.parent.sizes[target.index];
      target.parent.sizes[target.index] = target.parent.sizes[target.index + 1];
      target.parent.sizes[target.index + 1] = swapped;
    }
    target.parent.sizes = normalizeSplitSizes(target.parent.sizes, target.parent.children.length);
    return source;
  }

  const children =
    placement === "before" ? [newLeaf, currentLeaf] : [currentLeaf, newLeaf];
  const replacement = createSplitNode(direction, children, [1, 1]);
  return replaceNode(source, currentLeaf.id, replacement);
}

function swapLeafClients(root, firstClientId, secondClientId) {
  const source = cloneNode(root);
  const first = findLeafMeta(source, firstClientId);
  const second = findLeafMeta(source, secondClientId);

  if (!first || !second) {
    return source;
  }

  const temp = first.node.clientId;
  first.node.clientId = second.node.clientId;
  second.node.clientId = temp;
  return source;
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
    refitWorkspace(workspace, { backend: "immediate" });
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

function renderNode(workspace, node) {
  if (node.type === "leaf") {
    const leaf = document.createElement("div");
    leaf.className = "workspace-leaf relative flex flex-1 h-full w-full min-h-0 min-w-0";
    leaf.dataset.leafId = node.id;
    leaf.dataset.clientId = node.clientId;

    const slot = document.createElement("div");
    slot.className = "workspace-pane-slot flex flex-1 h-full w-full min-h-0 min-w-0";
    leaf.append(slot);
    workspace.leafHosts.set(node.clientId, slot);
    setClientPaneId(workspace, node.clientId, node.id);

    const client = workspace.clients.find((entry) => entry.id === node.clientId);
    if (client?.sessionId) {
      const session = sessionStore.get(client.sessionId);
      if (session?.cell) {
        session.host = slot;
        slot.append(session.cell);
      }
    }

    return leaf;
  }

  const split = document.createElement("div");
  split.className = `workspace-split flex flex-1 h-full w-full min-h-0 min-w-0 ${node.orientation === "vertical" ? "flex-row" : "flex-col"}`;
  split.dataset.splitId = node.id;

  node.children.forEach((child, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "workspace-split-child flex flex-1 h-full w-full min-h-0 min-w-0";
    wrapper.style.flex = `${node.sizes[index] || 1} 1 0%`;
    wrapper.append(renderNode(workspace, child));
    split.append(wrapper);

    if (index < node.children.length - 1) {
      split.append(createDivider(workspace, node, index));
    }
  });

  return split;
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

export function normalizeWorkspaceLayout(layout, clients) {
  const clientIds = clients.map((client) => client.id);
  const validClientIds = new Set(clientIds);
  const usedClientIds = new Set();
  const sanitized = sanitizeLayoutNode(cloneNode(layout), validClientIds, usedClientIds);
  const missing = clientIds.filter((clientId) => !usedClientIds.has(clientId));

  if (!sanitized) {
    return buildBalancedLayout(clientIds);
  }

  let nextLayout = sanitized;
  missing.forEach((clientId) => {
    const targetIds = listLeafClientIds(nextLayout);
    const targetClientId = targetIds[targetIds.length - 1];
    nextLayout = splitClientNode(nextLayout, targetClientId, clientId, "vertical", "after");
  });
  return nextLayout;
}

export function ensureWorkspaceLayout(workspace) {
  workspace.layout = normalizeWorkspaceLayout(workspace.layout, workspace.clients);
  return workspace.layout;
}

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
  workspace.element.innerHTML = "";
  workspace.element.append(renderNode(workspace, workspace.layout));

  if (state.activeView === workspace.id) {
    workspace.element.classList.remove("hidden");
  }

  collectDisplayOrder(workspace);
  renderTabs();
  refitWorkspace(workspace, { backend: "debounced" });
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
    bottom: { direction: "horizontal", placement: "after" },
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
