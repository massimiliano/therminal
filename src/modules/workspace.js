import { state, workspaces, sessionStore, GRID_LAYOUTS } from "./state.js";
import { dom } from "./dom.js";
import { handleHorizontalDrag, handleVerticalDrag } from "./grid.js";
import { createWorkspaceSession, destroySession } from "./session.js";
import { switchView, renderTabs } from "./tabs.js";
import { showStep } from "./wizard.js";
import { restoreMaximized } from "./maximize.js";
import { buildClientCommand, extractInlineArgs, normalizeInlineArgs } from "./cli-options.js";
import { showNotice } from "./notices.js";
import { validateProviderSelection } from "./providers.js";

function getGridDimensions(clientCount) {
  return (
    GRID_LAYOUTS[clientCount] || [
      Math.ceil(Math.sqrt(clientCount)),
      Math.ceil(clientCount / Math.ceil(Math.sqrt(clientCount)))
    ]
  );
}

function getRowClientCount(clientCount, gridCols, rowIndex) {
  const startIndex = rowIndex * gridCols;
  return Math.max(0, Math.min(gridCols, clientCount - startIndex));
}

function normalizeSizes(previousSizes, targetLength) {
  if (targetLength <= 0) {
    return [];
  }

  if (!Array.isArray(previousSizes) || previousSizes.length === 0) {
    return new Array(targetLength).fill(1);
  }

  if (previousSizes.length === targetLength) {
    return previousSizes.slice();
  }

  const nextSizes = previousSizes.slice(0, targetLength);
  while (nextSizes.length < targetLength) {
    nextSizes.push(1);
  }
  return nextSizes;
}

function createVerticalDivider(workspace, rowIndex, gapIndex) {
  const vDiv = document.createElement("div");
  vDiv.className =
    "grid-divider vertical bg-th-border relative z-[2] transition-[background] duration-150 hover:bg-emerald-400 cursor-col-resize w-1 shrink-0";
  vDiv.addEventListener("mousedown", (event) =>
    handleVerticalDrag(event, workspace, rowIndex, gapIndex)
  );
  return vDiv;
}

function createHorizontalDivider(workspace, rowIndex) {
  const hDiv = document.createElement("div");
  hDiv.className =
    "grid-divider horizontal bg-th-border relative z-[2] transition-[background] duration-150 hover:bg-emerald-400 cursor-row-resize h-1 shrink-0";
  hDiv.addEventListener("mousedown", (event) =>
    handleHorizontalDrag(event, workspace, rowIndex)
  );
  return hDiv;
}

function updateSessionIndexLabel(sessionId, clientIndex) {
  const session = sessionStore.get(sessionId);
  if (!session?.info) {
    return;
  }

  const currentText = session.info.textContent || "";
  const suffix = currentText.replace(/^#\d+/, "");
  session.info.textContent = `#${clientIndex + 1}${suffix}`;
  session.clientIndex = clientIndex;
}

function relayoutWorkspace(workspace) {
  if (!workspace) {
    return [];
  }

  if (state.maximizedSessionId) {
    const maximized = sessionStore.get(state.maximizedSessionId);
    if (maximized?.workspaceId === workspace.id) {
      restoreMaximized();
    }
  }

  const clientCount = workspace.clients.length;
  const [gridCols, gridRows] = getGridDimensions(clientCount);

  workspace.gridCols = gridCols;
  workspace.gridRows = gridRows;
  workspace.rowSizes = normalizeSizes(workspace.rowSizes, gridRows);
  workspace.colSizes = Array.from({ length: gridRows }, (_, rowIndex) =>
    normalizeSizes(
      workspace.colSizes?.[rowIndex],
      getRowClientCount(clientCount, gridCols, rowIndex)
    )
  );

  workspace.clients.forEach((client, index) => {
    client.index = index;
    client.gridCol = index % gridCols;
    client.gridRow = Math.floor(index / gridCols);

    if (client.sessionId) {
      updateSessionIndexLabel(client.sessionId, index);
    }
  });

  workspace.element.innerHTML = "";
  workspace.rows.length = 0;
  const anchors = [];

  for (let rowIndex = 0; rowIndex < gridRows; rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "workspace-row flex flex-row min-h-0 min-w-0";
    row.style.flex = String(workspace.rowSizes[rowIndex]);
    workspace.rows.push(row);
    workspace.element.append(row);

    const rowClients = workspace.clients.filter((client) => client.gridRow === rowIndex);
    rowClients.forEach((client, colIndex) => {
      if (colIndex > 0) {
        row.append(createVerticalDivider(workspace, rowIndex, colIndex - 1));
      }

      if (client.sessionId) {
        const session = sessionStore.get(client.sessionId);
        if (session?.cell) {
          session.row = row;
          session.cell.style.flex = String(workspace.colSizes[rowIndex][colIndex] || 1);
          row.append(session.cell);
        }
        return;
      }

      const anchor = document.createElement("div");
      anchor.className = "workspace-slot-anchor hidden";
      row.append(anchor);
      anchors.push({ client, row, anchor });
    });

    if (rowIndex < gridRows - 1) {
      workspace.element.append(createHorizontalDivider(workspace, rowIndex));
    }
  }

  if (state.activeView === workspace.id) {
    workspace.element.classList.remove("hidden");
  }

  renderTabs();
  return anchors;
}

async function createWorkspaceFromClients({ name, clients, meta = {} }) {
  state.workspaceCounter++;
  const wsId = `ws-${state.workspaceCounter}`;
  const wsName = name || `Workspace ${state.workspaceCounter}`;
  const clientCount = clients.length;

  const [gridCols, gridRows] = getGridDimensions(clientCount);

  const positionedClients = clients.map((client, index) => ({
    ...client,
    index,
    sessionId: null,
    gridCol: index % gridCols,
    gridRow: Math.floor(index / gridCols),
  }));

  const rowSizes = new Array(gridRows).fill(1);
  const colSizes = [];
  for (let r = 0; r < gridRows; r++) {
    colSizes.push(new Array(getRowClientCount(clientCount, gridCols, r)).fill(1));
  }

  const grid = document.createElement("div");
  grid.className = "workspace-grid flex flex-col h-full bg-th-bg";
  grid.dataset.workspaceId = wsId;

  const rowElements = [];

  const workspace = {
    id: wsId,
    name: wsName,
    clients: positionedClients,
    element: grid,
    gridCols,
    gridRows,
    rowSizes,
    colSizes,
    rows: rowElements,
    meta,
  };

  dom.workspaceContainer.append(grid);
  workspaces.set(wsId, workspace);
  switchView(wsId);
  relayoutWorkspace(workspace);

  try {
    for (const client of positionedClients) {
      await createWorkspaceSession(workspace, client, workspace.rows[client.gridRow]);
    }
  } catch (error) {
    for (const client of positionedClients) {
      if (client.sessionId) {
        destroySession(client.sessionId, { notifyBackend: true });
      }
    }

    grid.remove();
    workspaces.delete(wsId);
    if (state.activeView === wsId) {
      switchView("home");
    } else {
      renderTabs();
    }
    throw error;
  }

  renderTabs();
  return workspace;
}

async function ensureProvidersAvailable(clients) {
  const providerKeys = clients.map((client) => client.provider);
  return await validateProviderSelection(providerKeys, { force: true, notify: true });
}

export async function launchWorkspace() {
  const cwd = dom.cwdInput.value.trim() || ".";
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  const clients = state.wizardProviders.map((provider, i) => ({
    provider,
    inlineArgs: state.wizardInlineArgs[i] || "",
    command: buildClientCommand(provider, state.wizardInlineArgs[i] || ""),
    cwd,
  }));

  dom.launchBtn.disabled = true;
  try {
    const validation = await ensureProvidersAvailable(clients);
    if (!validation.ok) {
      return null;
    }
    const workspace = await createWorkspaceFromClients({ clients });
    showStep(1);
    return workspace;
  } catch (error) {
    console.error("Launch error:", error);
    showNotice(error?.message || "Impossibile avviare il workspace.", { type: "error" });
    return null;
  } finally {
    dom.launchBtn.disabled = false;
  }
}

export async function launchWorkspaceFromConfig({ name, providers, cwd, inlineArgs, commands }) {
  const normalizedInlineArgs = Array.isArray(inlineArgs)
    ? normalizeInlineArgs(inlineArgs, providers.length)
    : Array.isArray(commands)
      ? normalizeInlineArgs(
          commands.map((command, idx) => extractInlineArgs(providers[idx], command)),
          providers.length
        )
      : new Array(providers.length).fill("");

  const clients = providers.map((provider, index) => ({
    provider,
    inlineArgs: normalizedInlineArgs[index] || "",
    command: buildClientCommand(provider, normalizedInlineArgs[index] || ""),
    cwd: cwd || ".",
  }));

  const validation = await ensureProvidersAvailable(clients);
  if (!validation.ok) {
    return null;
  }

  try {
    return await createWorkspaceFromClients({ name, clients });
  } catch (error) {
    console.error("Launch config error:", error);
    showNotice(error?.message || "Impossibile ripristinare il workspace.", { type: "error" });
    return null;
  }
}

export async function addTerminalToActiveWorkspace(provider) {
  const workspace = workspaces.get(state.activeView);
  if (!workspace) {
    showNotice("Apri prima un workspace per aggiungere un terminale.", { type: "warning" });
    return null;
  }

  const validation = await validateProviderSelection([provider], { force: true, notify: true });
  if (!validation.ok) {
    return null;
  }

  const cwd = workspace.clients[0]?.cwd || ".";
  const client = {
    provider,
    inlineArgs: "",
    command: buildClientCommand(provider, ""),
    cwd,
    sessionId: null,
    index: workspace.clients.length,
    gridCol: 0,
    gridRow: 0
  };

  workspace.clients.push(client);
  const anchors = relayoutWorkspace(workspace);
  const slot = anchors.find((entry) => entry.client === client);

  try {
    await createWorkspaceSession(workspace, client, slot?.row || workspace.rows[client.gridRow], slot?.anchor || null);
    slot?.anchor?.remove();
    relayoutWorkspace(workspace);
    showNotice(
      `Aggiunto ${provider === "terminal" ? "Terminale" : provider.charAt(0).toUpperCase() + provider.slice(1)} nel workspace attivo.`,
      { type: "success", timeoutMs: 2500 }
    );
    return client;
  } catch (error) {
    workspace.clients = workspace.clients.filter((entry) => entry !== client);
    relayoutWorkspace(workspace);
    showNotice(error?.message || "Impossibile aggiungere il terminale.", { type: "error" });
    return null;
  }
}

export function closeWorkspace(wsId) {
  const ws = workspaces.get(wsId);
  if (!ws) return;

  if (state.maximizedSessionId) {
    const mState = sessionStore.get(state.maximizedSessionId);
    if (mState && mState.workspaceId === wsId) restoreMaximized();
  }

  for (const client of ws.clients) {
    if (client.sessionId) {
      destroySession(client.sessionId, { notifyBackend: true });
    }
  }

  ws.element?.remove();
  workspaces.delete(wsId);

  if (state.activeView === wsId) {
    switchView("home");
  } else {
    renderTabs();
  }
}
