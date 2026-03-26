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

async function createWorkspaceFromClients({ name, clients, meta = {} }) {
  state.workspaceCounter++;
  const wsId = `ws-${state.workspaceCounter}`;
  const wsName = name || `Workspace ${state.workspaceCounter}`;
  const clientCount = clients.length;

  const [gridCols, gridRows] =
    GRID_LAYOUTS[clientCount] || [
      Math.ceil(Math.sqrt(clientCount)),
      Math.ceil(clientCount / Math.ceil(Math.sqrt(clientCount))),
    ];

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
    colSizes.push(new Array(gridCols).fill(1));
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

  for (let r = 0; r < gridRows; r++) {
    const row = document.createElement("div");
    row.className = "workspace-row flex flex-row min-h-0 min-w-0";
    row.style.flex = String(rowSizes[r]);
    rowElements.push(row);
    grid.append(row);

    if (r < gridRows - 1) {
      const hDiv = document.createElement("div");
      hDiv.className =
        "grid-divider horizontal bg-th-border relative z-[2] transition-[background] duration-150 hover:bg-emerald-400 cursor-row-resize h-1 shrink-0";
      const capturedR = r;
      hDiv.addEventListener("mousedown", (e) =>
        handleHorizontalDrag(e, workspace, capturedR)
      );
      grid.append(hDiv);
    }
  }

  dom.workspaceContainer.append(grid);
  workspaces.set(wsId, workspace);
  switchView(wsId);

  try {
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const clientIndex = r * gridCols + c;
        if (clientIndex >= positionedClients.length) break;

        if (c > 0) {
          const vDiv = document.createElement("div");
          vDiv.className =
            "grid-divider vertical bg-th-border relative z-[2] transition-[background] duration-150 hover:bg-emerald-400 cursor-col-resize w-1 shrink-0";
          const capturedR = r;
          const capturedGap = c - 1;
          vDiv.addEventListener("mousedown", (e) =>
            handleVerticalDrag(e, workspace, capturedR, capturedGap)
          );
          rowElements[r].append(vDiv);
        }

        await createWorkspaceSession(workspace, positionedClients[clientIndex], rowElements[r]);
      }
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
