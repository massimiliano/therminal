import { state, workspaces, sessionStore } from "../state.js";
import { dom } from "../dom.js";
import {
  addClientToLayout,
  createClientId,
  getWorkspaceHost,
  normalizeWorkspaceLayout,
  renderWorkspaceLayout,
} from "../layout.js";
import { createWorkspaceSession, destroySession } from "../session.js";
import { switchView, renderTabs } from "../tabs.js";
import { showStep } from "../wizard.js";
import { buildClientCommand, extractInlineArgs, normalizeInlineArgs } from "../cli-options.js";
import { showNotice } from "../notices.js";
import { getProviderLabel, validateProviderSelection } from "../providers.js";
import { normalizeSharedContext, normalizeStructuredContext } from "../shared-context.js";
import { normalizeTaskStatus } from "../task-status.js";
import { createBrowserPanel, createBrowserCommand, destroyBrowserPanel } from "../browser.js";

function getWorkspaceNameFromCwd(cwd, fallback) {
  if (typeof cwd !== "string") {
    return fallback;
  }

  const normalized = cwd.trim().replace(/[\\/]+$/, "");
  if (!normalized || normalized === "." || normalized === "..") {
    return fallback;
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  if (!lastSegment || /^[A-Za-z]:$/.test(lastSegment)) {
    return fallback;
  }

  return lastSegment;
}

function normalizeClientConfig(client, index) {
  return {
    id: client.id || `client-${index + 1}`,
    provider: client.provider,
    inlineArgs: typeof client.inlineArgs === "string" ? client.inlineArgs : "",
    command: client.command,
    cwd: client.cwd || ".",
    sessionId: null,
    paneId: client.paneId || null,
    taskStatus: normalizeTaskStatus(client.taskStatus),
  };
}

async function ensureProvidersAvailable(clients) {
  const providerKeys = clients
    .map((client) => client.provider)
    .filter((provider) => provider !== "browser");

  if (providerKeys.length === 0) {
    return { ok: true, unavailable: [] };
  }

  return await validateProviderSelection(providerKeys, { force: true, notify: true });
}

async function mountWorkspaceClient(workspace, client) {
  const host = getWorkspaceHost(workspace, client.id);
  if (!host) {
    throw new Error("Host pannello non trovato per la nuova sessione.");
  }

  if (client.provider === "browser") {
    return createBrowserPanel(workspace, client, host);
  }

  return await createWorkspaceSession(workspace, client, host);
}

function getFocusedWorkspaceTarget(workspace) {
  const focused = sessionStore.get(state.focusedSessionId);
  if (focused?.workspaceId === workspace.id) {
    return focused.clientId;
  }

  return workspace.clients[workspace.clients.length - 1]?.id || null;
}

async function createWorkspaceFromClients({ name, clients, meta = {}, layout = null }) {
  state.workspaceCounter += 1;
  const wsId = `ws-${state.workspaceCounter}`;
  const fallbackName = `Workspace ${state.workspaceCounter}`;
  const wsName = name || getWorkspaceNameFromCwd(clients[0]?.cwd, fallbackName);

  const normalizedClients = clients.map((client, index) => normalizeClientConfig(client, index));

  const grid = document.createElement("div");
  grid.className = "workspace-grid flex h-full w-full bg-th-bg";
  grid.dataset.workspaceId = wsId;

  const workspace = {
    id: wsId,
    name: wsName,
    clients: normalizedClients,
    sharedContext: normalizeSharedContext(meta.sharedContext),
    handoff: normalizeStructuredContext(meta.handoff),
    element: grid,
    layout: normalizeWorkspaceLayout(layout, normalizedClients),
    leafHosts: new Map(),
    meta,
  };

  dom.workspaceContainer.append(grid);
  workspaces.set(wsId, workspace);
  switchView(wsId);
  renderWorkspaceLayout(workspace);

  try {
    const spawnResults = await Promise.allSettled(
      normalizedClients.map((client) => mountWorkspaceClient(workspace, client))
    );
    const failedSpawn = spawnResults.find((result) => result.status === "rejected");

    if (failedSpawn) {
      throw failedSpawn.reason;
    }

    renderWorkspaceLayout(workspace);
  } catch (error) {
    for (const client of normalizedClients) {
      if (!client.sessionId) {
        continue;
      }

      if (client.provider === "browser") {
        destroyBrowserPanel(client.sessionId);
      } else {
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

export async function launchWorkspace() {
  const cwd = dom.cwdInput.value.trim() || ".";
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  const clients = state.wizardProviders.map((provider, index) => ({
    id: createClientId(),
    provider,
    inlineArgs: state.wizardInlineArgs[index] || "",
    command: buildClientCommand(provider, state.wizardInlineArgs[index] || ""),
    cwd,
    taskStatus: "todo",
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

function buildClientsFromLegacyConfig({
  providers,
  cwd,
  inlineArgs,
  commands,
  taskStatuses,
}) {
  const normalizedInlineArgs = Array.isArray(inlineArgs)
    ? normalizeInlineArgs(inlineArgs, providers.length)
    : Array.isArray(commands)
      ? normalizeInlineArgs(
          commands.map((command, index) => extractInlineArgs(providers[index], command)),
          providers.length
        )
      : new Array(providers.length).fill("");

  return providers.map((provider, index) => ({
    id: `client-${index + 1}`,
    provider,
    inlineArgs: normalizedInlineArgs[index] || "",
    command: Array.isArray(commands) ? commands[index] : buildClientCommand(provider, normalizedInlineArgs[index] || ""),
    cwd: cwd || ".",
    taskStatus: normalizeTaskStatus(Array.isArray(taskStatuses) ? taskStatuses[index] : "todo"),
  }));
}

export async function launchWorkspaceFromConfig(config) {
  const clients = Array.isArray(config.clients) && config.clients.length > 0
    ? config.clients.map((client, index) => normalizeClientConfig({
      ...client,
      command:
        typeof client.command === "string"
          ? client.command
          : buildClientCommand(client.provider, client.inlineArgs || ""),
      cwd: client.cwd || config.cwd || ".",
    }, index))
    : buildClientsFromLegacyConfig(config);

  const validation = await ensureProvidersAvailable(clients);
  if (!validation.ok) {
    return null;
  }

  try {
    return await createWorkspaceFromClients({
      name: config.name,
      clients,
      layout: config.layout || null,
      meta: {
        sharedContext: normalizeSharedContext(config.sharedContext),
        handoff: normalizeStructuredContext(config.handoff),
      },
    });
  } catch (error) {
    console.error("Launch config error:", error);
    showNotice(error?.message || "Impossibile ripristinare il workspace.", { type: "error" });
    return null;
  }
}

export async function addTerminalToActiveWorkspace(provider, options = {}) {
  const workspace = workspaces.get(options.workspaceId || state.activeView);
  if (!workspace) {
    showNotice("Apri prima un workspace per aggiungere un terminale.", { type: "warning" });
    return null;
  }

  const cwd = workspace.clients[0]?.cwd || ".";
  const client = {
    id: createClientId(),
    provider,
    inlineArgs: "",
    command: provider === "browser" ? createBrowserCommand("") : buildClientCommand(provider, ""),
    cwd,
    sessionId: null,
    paneId: null,
    taskStatus: "todo",
  };

  const validation = await ensureProvidersAvailable([client]);
  if (!validation.ok) {
    return null;
  }

  workspace.clients.push(client);
  addClientToLayout(workspace, client.id, {
    targetClientId: options.targetClientId || getFocusedWorkspaceTarget(workspace),
    splitDirection: options.splitDirection || "vertical",
  });
  renderWorkspaceLayout(workspace);

  try {
    await mountWorkspaceClient(workspace, client);
    renderWorkspaceLayout(workspace);
    showNotice(
      `Aggiunto ${provider === "browser" ? "Browser" : getProviderLabel(provider)} nel workspace attivo.`,
      { type: "success", timeoutMs: 2500 }
    );
    return client;
  } catch (error) {
    workspace.clients = workspace.clients.filter((entry) => entry.id !== client.id);
    workspace.layout = normalizeWorkspaceLayout(workspace.layout, workspace.clients);
    renderWorkspaceLayout(workspace);
    showNotice(error?.message || "Impossibile aggiungere il terminale.", { type: "error" });
    return null;
  }
}

export function closeWorkspace(wsId) {
  const workspace = workspaces.get(wsId);
  if (!workspace) {
    return;
  }

  for (const client of workspace.clients) {
    if (!client.sessionId) {
      continue;
    }

    if (client.provider === "browser") {
      destroyBrowserPanel(client.sessionId);
    } else {
      destroySession(client.sessionId, { notifyBackend: true });
    }
  }

  workspace.element?.remove();
  workspaces.delete(wsId);

  if (state.activeView === wsId) {
    switchView("home");
  } else {
    renderTabs();
  }
}
