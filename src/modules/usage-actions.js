import { dom } from "./dom.js";
import { state, workspaces, sessionStore, providerCatalog } from "./state.js";
import { closeWorkspace, launchWorkspaceFromConfig } from "./workspace.js";

const COMMAND_PLANS = {
  codex: {
    command: "/status",
    initialDelay: 4500,
    retryDelay: 5000,
    maxRetries: 1,
    successPattern: /5h limit:|Weekly limit:/i,
  },
  gemini: {
    command: "/stats",
    initialDelay: 14000,
    retryDelay: 8000,
    maxRetries: 2,
    successPattern: /Session Stats|Interaction Summary|Model usage|Tool Stats For Nerds/i,
  },
  claude: {
    command: "/usage",
    initialDelay: 5000,
    retryDelay: 6000,
    maxRetries: 1,
    successPattern: /usage|limit|reset/i,
  },
};

function getActiveWorkspaceCwd() {
  const activeWorkspace = workspaces.get(state.activeView);
  const activeClient = activeWorkspace?.clients?.find((client) => client.cwd);
  return activeClient?.cwd || dom.cwdInput.value.trim() || ".";
}

function getUsageWorkspace() {
  return Array.from(workspaces.values()).find((workspace) => workspace.meta?.kind === "usage-live");
}

function readTerminalTail(terminal, maxLines = 220) {
  const buffer = terminal?.buffer?.active;
  if (!buffer) {
    return "";
  }

  const start = Math.max(0, buffer.length - maxLines);
  const lines = [];

  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (line) {
      lines.push(line.translateToString());
    }
  }

  return lines.join("\n");
}

function sendUsageCommand(sessionId, provider, attempt = 0) {
  const plan = COMMAND_PLANS[provider];
  const session = sessionStore.get(sessionId);

  if (!plan || !session) {
    return;
  }

  window.launcherAPI.writeSession(sessionId, "\r");

  setTimeout(() => {
    if (!sessionStore.has(sessionId)) {
      return;
    }
    window.launcherAPI.writeSession(sessionId, `${plan.command}\r`);
  }, 220);

  if (attempt >= plan.maxRetries) {
    return;
  }

  setTimeout(() => {
    const currentSession = sessionStore.get(sessionId);
    if (!currentSession) {
      return;
    }

    const tail = readTerminalTail(currentSession.terminal);
    if (!plan.successPattern.test(tail)) {
      sendUsageCommand(sessionId, provider, attempt + 1);
    }
  }, plan.retryDelay);
}

function primeUsageWorkspace(workspace) {
  for (const client of workspace.clients) {
    const plan = COMMAND_PLANS[client.provider];
    if (!plan || !client.sessionId) {
      continue;
    }

    setTimeout(() => {
      sendUsageCommand(client.sessionId, client.provider);
    }, plan.initialDelay);
  }
}

export async function openLiveUsageWorkspace() {
  const providers = Object.keys(COMMAND_PLANS).filter((provider) => providerCatalog[provider]);
  if (!providers.length) {
    return null;
  }

  const existingWorkspace = getUsageWorkspace();
  if (existingWorkspace) {
    closeWorkspace(existingWorkspace.id);
  }

  const workspace = await launchWorkspaceFromConfig({
    name: "Usage",
    providers,
    cwd: getActiveWorkspaceCwd(),
  });

  if (!workspace) {
    return null;
  }

  workspace.meta = {
    ...(workspace.meta || {}),
    kind: "usage-live",
  };

  primeUsageWorkspace(workspace);
  return workspace;
}
