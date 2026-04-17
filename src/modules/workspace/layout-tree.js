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
    clientId
  };
}

function createSplitNode(orientation, children, sizes, id = createNodeId("split")) {
  return {
    id,
    type: "split",
    orientation,
    children,
    sizes: normalizeSplitSizes(sizes, children.length)
  };
}

export function normalizeSplitSizes(sizes, childCount) {
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
      clientId: node.clientId
    };
  }

  return {
    id: node.id || createNodeId("split"),
    type: "split",
    orientation: node.orientation === "horizontal" ? "horizontal" : "vertical",
    sizes: Array.isArray(node.sizes) ? node.sizes.slice() : [],
    children: Array.isArray(node.children) ? node.children.map((child) => cloneNode(child)) : []
  };
}

export function walkLeaves(node, visitor) {
  if (!node) {
    return;
  }

  if (node.type === "leaf") {
    visitor(node);
    return;
  }

  node.children.forEach((child) => walkLeaves(child, visitor));
}

export function listLeafClientIds(node) {
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
      buildBalancedLayout(clientIds.slice(midpoint), depth + 1)
    ],
    [1, 1]
  );
}

export function buildUniformLayout(clientIds, orientation = "vertical") {
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    return null;
  }

  if (clientIds.length === 1) {
    return createLeafNode(clientIds[0]);
  }

  const normalizedOrientation = orientation === "horizontal" ? "horizontal" : "vertical";
  return createSplitNode(
    normalizedOrientation,
    clientIds.map((clientId) => createLeafNode(clientId)),
    new Array(clientIds.length).fill(1)
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
      clientId: node.clientId
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

export function removeClientFromNode(node, clientId) {
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
    removed: true
  };
}

export function splitClientNode(root, targetClientId, newClientId, direction, placement) {
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

export function swapLeafClients(root, firstClientId, secondClientId) {
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
