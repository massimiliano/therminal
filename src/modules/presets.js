import { state, workspaces } from "./state.js";
import { dom } from "./dom.js";
import { launchWorkspace, launchWorkspaceFromConfig } from "./workspace.js";
import { updateSavedSection } from "./helpers.js";
import { extractInlineArgs, normalizeInlineArgs } from "./cli-options.js";
import { getUnavailableProviders, getProviderLabel } from "./providers.js";
import { openNameModal } from "./name-modal.js";

function getConfigClients(config) {
  if (Array.isArray(config?.clients) && config.clients.length > 0) {
    return config.clients;
  }

  const providers = Array.isArray(config?.providers) ? config.providers : [];
  return providers.map((provider, index) => ({
    provider,
    command: Array.isArray(config?.commands) ? config.commands[index] : "",
    inlineArgs: Array.isArray(config?.inlineArgs) ? config.inlineArgs[index] : "",
    taskStatus: Array.isArray(config?.taskStatuses) ? config.taskStatuses[index] : "todo",
  }));
}

function renderPresetLoadingState() {
  dom.presetSection.classList.remove("hidden");
  updateSavedSection();
  dom.presetList.innerHTML = Array.from({ length: 2 }, () => `
    <div class="rounded-[10px] border border-th-border-lt bg-th-card px-4 py-3" aria-hidden="true">
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0 space-y-2">
          <span class="th-skeleton th-skeleton-line h-[13px] w-28"></span>
          <span class="th-skeleton th-skeleton-line h-[10px] w-24"></span>
          <span class="th-skeleton th-skeleton-line h-[9px] w-4/5"></span>
        </div>
        <span class="th-skeleton rounded-md h-6 w-6 shrink-0"></span>
      </div>
    </div>
  `).join("");
}

export async function loadPresets() {
  renderPresetLoadingState();
  const presets = await window.launcherAPI.listPresets();
  const entries = Object.entries(presets);
  if (entries.length === 0) {
    dom.presetSection.classList.add("hidden");
    updateSavedSection();
    return;
  }

  dom.presetSection.classList.remove("hidden");
  updateSavedSection();
  dom.presetList.innerHTML = "";

  for (const [name, config] of entries) {
    const card = document.createElement("button");
    card.className =
      "flex items-center gap-3 px-4 py-2.5 bg-th-card border border-th-border-lt rounded-[10px] cursor-pointer transition-all duration-200 text-left min-w-[160px] hover:border-emerald-400 hover:bg-emerald-400/[0.03]";

    const info = document.createElement("div");
    info.className = "flex flex-col gap-0.5 flex-1";

    const title = document.createElement("span");
    title.className = "text-[13px] font-semibold text-th-fg";
    title.textContent = name;

    const desc = document.createElement("span");
    desc.className = "text-[10px] text-zinc-600 font-mono";
    const counts = {};
    for (const client of getConfigClients(config)) {
      counts[client.provider] = (counts[client.provider] || 0) + 1;
    }
    desc.textContent = Object.entries(counts)
      .map(([k, v]) => `${v}\u00D7 ${k}`)
      .join(", ");

    const pathEl = document.createElement("span");
    pathEl.className = "text-[9px] text-zinc-600 font-mono truncate";
    pathEl.textContent = config.cwd || ".";

    info.append(title, desc, pathEl);

    const hasHandoff =
      (typeof config.sharedContext === "string" && config.sharedContext.trim().length > 0) ||
      (typeof config.handoff?.goal === "string" && config.handoff.goal.trim().length > 0) ||
      (typeof config.handoff?.summary === "string" && config.handoff.summary.trim().length > 0);
    if (hasHandoff) {
      const handoffHint = document.createElement("span");
      handoffHint.className = "text-[9px] text-emerald-300 font-medium";
      handoffHint.textContent = "Workflow e handoff inclusi";
      info.append(handoffHint);
    }

    const unavailable = getUnavailableProviders(getConfigClients(config).map((client) => client.provider));
    if (unavailable.length > 0) {
      const warn = document.createElement("span");
      warn.className = "text-[9px] text-red-300 font-medium";
      warn.textContent = `CLI mancante: ${unavailable.map((key) => getProviderLabel(key)).join(", ")}`;
      info.append(warn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className =
      "w-6 h-6 flex items-center justify-center bg-transparent text-zinc-700 cursor-pointer rounded text-xs transition-all duration-150 hover:text-red-500 hover:bg-red-500/10";
    deleteBtn.innerHTML = '<i class="bi bi-trash3"></i>';
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await window.launcherAPI.deletePreset(name);
      loadPresets();
    });

    card.append(info, deleteBtn);
    card.addEventListener("click", () => launchPreset(config));
    dom.presetList.append(card);
  }
}

export function saveCurrentAsPreset() {
  openNameModal({
    mode: "preset",
    title: "Salva preset",
    placeholder: "Nome del preset...",
  });
}

export async function confirmSavePreset() {
  const name = dom.presetNameInput.value.trim();
  if (!name) return;

  const config = {
    clientCount: state.wizardClientCount,
    providers: state.wizardProviders.slice(),
    inlineArgs: normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount),
    cwd: dom.cwdInput.value.trim() || ".",
  };
  await window.launcherAPI.savePreset(name, config);
  loadPresets();
}

export async function saveWorkspaceAsPreset(name, workspaceId) {
  const ws = workspaces.get(workspaceId);
  if (!ws) return false;

  const providers = ws.clients.map((client) => client.provider);
  const inlineArgs = ws.clients.map((client) => extractInlineArgs(client.provider, client.command));
  const config = {
    clients: ws.clients.map((client) => ({
      id: client.id,
      provider: client.provider,
      command: client.command,
      inlineArgs: extractInlineArgs(client.provider, client.command),
      taskStatus: client.taskStatus || "todo",
      cwd: client.cwd || ".",
    })),
    layout: ws.layout,
    clientCount: providers.length,
    providers,
    inlineArgs,
    cwd: ws.clients[0]?.cwd || ".",
    sharedContext: ws.sharedContext || "",
    handoff: ws.handoff || {},
    taskStatuses: ws.clients.map((client) => client.taskStatus || "todo"),
  };

  await window.launcherAPI.savePreset(name, config);
  loadPresets();
  return true;
}

async function launchPreset(config) {
  if (
    Array.isArray(config.clients) ||
    config.layout ||
    typeof config.sharedContext === "string" ||
    config.handoff ||
    Array.isArray(config.taskStatuses)
  ) {
    await launchWorkspaceFromConfig({
      name: config.name,
      clients: Array.isArray(config.clients) ? config.clients : null,
      layout: config.layout || null,
      providers: config.providers,
      cwd: config.cwd,
      inlineArgs: Array.isArray(config.inlineArgs) ? config.inlineArgs : null,
      commands: Array.isArray(config.commands) ? config.commands : null,
      sharedContext: config.sharedContext || "",
      handoff: config.handoff || {},
      taskStatuses: config.taskStatuses || []
    });
    return;
  }

  state.wizardClientCount = config.clientCount;
  state.wizardProviders = config.providers.slice();
  if (Array.isArray(config.inlineArgs)) {
    state.wizardInlineArgs = normalizeInlineArgs(config.inlineArgs, config.clientCount);
  } else if (Array.isArray(config.commands)) {
    state.wizardInlineArgs = normalizeInlineArgs(
      config.commands.map((command, idx) => extractInlineArgs(config.providers[idx], command)),
      config.clientCount
    );
  } else {
    state.wizardInlineArgs = new Array(config.clientCount).fill("");
  }
  dom.cwdInput.value = config.cwd || ".";
  await launchWorkspace();
}
