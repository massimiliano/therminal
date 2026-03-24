import { state, workspaces, sessionStore, GRID_LAYOUTS } from "./state.js";
import { dom } from "./dom.js";
import { handleHorizontalDrag, handleVerticalDrag } from "./grid.js";
import { createWorkspaceSession, destroySession } from "./session.js";
import { switchView, renderTabs } from "./tabs.js";
import { showStep } from "./wizard.js";
import { restoreMaximized } from "./maximize.js";
import { buildClientCommand, extractInlineArgs, normalizeInlineArgs } from "./cli-options.js";

export async function launchWorkspace() {
  const cwd = dom.cwdInput.value.trim() || ".";
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  state.workspaceCounter++;
  const wsId = `ws-${state.workspaceCounter}`;
  const wsName = `Workspace ${state.workspaceCounter}`;

  const [gridCols, gridRows] =
    GRID_LAYOUTS[state.wizardClientCount] || [
      Math.ceil(Math.sqrt(state.wizardClientCount)),
      Math.ceil(
        state.wizardClientCount / Math.ceil(Math.sqrt(state.wizardClientCount))
      ),
    ];

  const clients = state.wizardProviders.map((provider, i) => ({
    index: i,
    provider,
    inlineArgs: state.wizardInlineArgs[i] || "",
    command: buildClientCommand(provider, state.wizardInlineArgs[i] || ""),
    cwd,
    sessionId: null,
    gridCol: i % gridCols,
    gridRow: Math.floor(i / gridCols),
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

  const workspace = {
    id: wsId,
    name: wsName,
    clients,
    element: grid,
    gridCols,
    gridRows,
    rowSizes,
    colSizes,
    rows: rowElements,
  };
  workspaces.set(wsId, workspace);

  switchView(wsId);
  showStep(1);

  dom.launchBtn.disabled = true;
  try {
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const clientIndex = r * gridCols + c;
        if (clientIndex >= clients.length) break;

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

        await createWorkspaceSession(workspace, clients[clientIndex], rowElements[r]);
      }
    }
  } catch (error) {
    console.error("Launch error:", error);
  } finally {
    dom.launchBtn.disabled = false;
  }
}

export async function launchWorkspaceFromConfig({ name, providers, cwd, inlineArgs, commands }) {
  state.wizardClientCount = providers.length;
  state.wizardProviders = providers.slice();
  if (Array.isArray(inlineArgs)) {
    state.wizardInlineArgs = normalizeInlineArgs(inlineArgs, providers.length);
  } else if (Array.isArray(commands)) {
    state.wizardInlineArgs = normalizeInlineArgs(
      commands.map((command, idx) => extractInlineArgs(providers[idx], command)),
      providers.length
    );
  } else {
    state.wizardInlineArgs = new Array(providers.length).fill("");
  }
  dom.cwdInput.value = cwd || ".";
  await launchWorkspace();
  // Rename to saved name
  const ws = workspaces.get(`ws-${state.workspaceCounter}`);
  if (ws && name) ws.name = name;
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
