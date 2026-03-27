import { workspaces, PROVIDER_STYLE } from "./state.js";
import { dom } from "./dom.js";
import { launchWorkspaceFromConfig } from "./workspace.js";
import { renderTabs } from "./tabs.js";
import { updateSavedSection } from "./helpers.js";
import { extractInlineArgs } from "./cli-options.js";
import { getUnavailableProviders, getProviderLabel, validateProviderSelection } from "./providers.js";

function getConfigClients(config) {
  if (Array.isArray(config?.clients) && config.clients.length > 0) {
    return config.clients;
  }

  const providers = Array.isArray(config?.providers) ? config.providers : [];
  return providers.map((provider, index) => ({
    id: `client-${index + 1}`,
    provider,
    command: Array.isArray(config?.commands) ? config.commands[index] : "",
    inlineArgs: Array.isArray(config?.inlineArgs) ? config.inlineArgs[index] : "",
    taskStatus: Array.isArray(config?.taskStatuses) ? config.taskStatuses[index] : "todo",
    cwd: config?.cwd || ".",
  }));
}

function getWorkspacePaths(config) {
  return (config.workspaces || []).map((ws, index) => ({
    name: ws?.name || `Workspace ${index + 1}`,
    cwd: ws?.cwd || ".",
  }));
}

function renderSessionLoadingState() {
  dom.sessionSection.classList.remove("hidden");
  updateSavedSection();
  dom.sessionList.innerHTML = Array.from({ length: 2 }, () => `
    <div class="rounded-[10px] border border-th-border-lt bg-th-card px-4 py-3" aria-hidden="true">
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0 space-y-2">
          <span class="th-skeleton th-skeleton-line h-[13px] w-32"></span>
          <div class="flex gap-2 flex-wrap">
            <span class="th-skeleton th-skeleton-line h-[10px] w-24"></span>
            <span class="th-skeleton th-skeleton-line h-[10px] w-12"></span>
            <span class="th-skeleton th-skeleton-line h-[10px] w-14"></span>
          </div>
          <span class="th-skeleton th-skeleton-line h-[9px] w-4/5"></span>
        </div>
        <span class="th-skeleton rounded-md h-6 w-6 shrink-0"></span>
      </div>
    </div>
  `).join("");
}

export function collectSessionState() {
  const data = [];
  for (const [, ws] of workspaces) {
    data.push({
      name: ws.name,
      clients: ws.clients.map((client) => ({
        id: client.id,
        provider: client.provider,
        command: client.command,
        inlineArgs: extractInlineArgs(client.provider, client.command),
        taskStatus: client.taskStatus || "todo",
        cwd: client.cwd || ".",
      })),
      layout: ws.layout,
      providers: ws.clients.map((c) => c.provider),
      commands: ws.clients.map((c) => c.command),
      inlineArgs: ws.clients.map((c) => extractInlineArgs(c.provider, c.command)),
      cwd: ws.clients[0]?.cwd || ".",
      sharedContext: ws.sharedContext || "",
      handoff: ws.handoff || {},
      taskStatuses: ws.clients.map((client) => client.taskStatus || "todo"),
    });
  }
  return { workspaces: data };
}

export async function saveSessionAs(name) {
  const data = collectSessionState();
  if (data.workspaces.length === 0) return;
  await window.launcherAPI.saveSessionAs(name, data);
}

export async function restoreSession(config) {
  const requestedProviders = config.workspaces.flatMap((ws) => getConfigClients(ws).map((client) => client.provider));
  const validation = await validateProviderSelection(requestedProviders, { force: true, notify: true });
  if (!validation.ok) {
    return;
  }

  for (const ws of config.workspaces) {
    await launchWorkspaceFromConfig(ws);
  }
  renderTabs();
}

export async function loadSessionsUI() {
  renderSessionLoadingState();
  const sessions = await window.launcherAPI.listSessions();
  const entries = Object.entries(sessions || {});
  const validEntries = entries.filter(([, config]) => {
    return Array.isArray(config?.workspaces) && config.workspaces.length > 0;
  });

  dom.sessionList.innerHTML = "";

  if (validEntries.length === 0) {
    dom.sessionSection.classList.add("hidden");
    updateSavedSection();
    return;
  }

  dom.sessionSection.classList.remove("hidden");
  updateSavedSection();

  for (const [name, config] of validEntries) {
    const workspacePaths = getWorkspacePaths(config);

    const card = document.createElement("div");
    card.className =
      "flex flex-col gap-3 px-4 py-3 bg-th-card border border-th-border-lt rounded-[10px] transition-all duration-200 text-left min-w-[180px] hover:border-emerald-400 hover:bg-emerald-400/[0.03]";

    const header = document.createElement("div");
    header.className = "flex items-start gap-3";

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "flex-1 min-w-0 bg-transparent text-left cursor-pointer";
    restoreBtn.addEventListener("click", () => restoreSession(config));

    const info = document.createElement("div");
    info.className = "flex flex-col gap-0.5 flex-1 min-w-0";

    const title = document.createElement("span");
    title.className = "text-[13px] font-semibold text-th-fg";
    title.textContent = name;

    // Workspace summary: "Workspace 1 [4] [2]  ·  Workspace 2 [3]"
    const wsDesc = document.createElement("div");
    wsDesc.className = "flex items-center gap-2 flex-wrap";

    for (const ws of config.workspaces) {
      const clients = getConfigClients(ws);
      const wsChip = document.createElement("span");
      wsChip.className = "flex items-center gap-1";

      const wsName = document.createElement("span");
      wsName.className = "text-[10px] text-zinc-500 font-mono";
      wsName.textContent = ws.name;
      wsChip.append(wsName);

      const counts = {};
      for (const client of clients) {
        counts[client.provider] = (counts[client.provider] || 0) + 1;
      }
      for (const [provider, count] of Object.entries(counts)) {
        const dot = document.createElement("span");
        dot.className = `inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded text-[8px] font-bold leading-none ${PROVIDER_STYLE[provider]?.dot || "bg-zinc-700 text-zinc-400"}`;
        dot.textContent = count;
        wsChip.append(dot);
      }

      wsDesc.append(wsChip);
    }

    const pathHint = document.createElement("span");
    pathHint.className = "text-[9px] text-zinc-500";
    pathHint.textContent = `${workspacePaths.length} ${workspacePaths.length === 1 ? "percorso workspace" : "percorsi workspace"}`;

    info.append(title, wsDesc, pathHint);

    const hasSharedContext = config.workspaces.some((ws) => {
      const hasNotes = typeof ws?.sharedContext === "string" && ws.sharedContext.trim().length > 0;
      const handoff = ws?.handoff || {};
      const hasHandoff =
        typeof handoff.goal === "string" && handoff.goal.trim().length > 0 ||
        typeof handoff.constraints === "string" && handoff.constraints.trim().length > 0 ||
        typeof handoff.decisions === "string" && handoff.decisions.trim().length > 0 ||
        typeof handoff.nextStep === "string" && handoff.nextStep.trim().length > 0 ||
        typeof handoff.summary === "string" && handoff.summary.trim().length > 0;
      return hasNotes || hasHandoff;
    });
    if (hasSharedContext) {
      const contextHint = document.createElement("span");
      contextHint.className = "text-[9px] text-emerald-300 font-medium";
      contextHint.textContent = "Handoff strutturato incluso";
      info.append(contextHint);
    }

    const unavailable = getUnavailableProviders(
      config.workspaces.flatMap((ws) => getConfigClients(ws).map((client) => client.provider))
    );
    if (unavailable.length > 0) {
      const warn = document.createElement("span");
      warn.className = "text-[9px] text-red-300 font-medium";
      warn.textContent = `CLI mancante: ${unavailable.map((key) => getProviderLabel(key)).join(", ")}`;
      info.append(warn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className =
      "w-6 h-6 flex items-center justify-center bg-transparent text-zinc-700 cursor-pointer rounded text-xs transition-all duration-150 shrink-0 hover:text-red-500 hover:bg-red-500/10";
    deleteBtn.innerHTML = '<i class="bi bi-trash3"></i>';
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await window.launcherAPI.deleteSession(name);
      loadSessionsUI();
    });

    restoreBtn.append(info);
    header.append(restoreBtn, deleteBtn);
    card.append(header);

    const accordion = document.createElement("details");
    accordion.className = "th-accordion rounded-lg border border-th-border-lt bg-th-bg/40";

    const summary = document.createElement("summary");
    summary.className = "flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-zinc-400";

    const summaryLabel = document.createElement("span");
    summaryLabel.className = "font-medium text-zinc-300";
    summaryLabel.textContent = "Percorsi file system";

    const summaryMeta = document.createElement("div");
    summaryMeta.className = "flex items-center gap-2 shrink-0";

    const summaryCount = document.createElement("span");
    summaryCount.className = "rounded-full border border-zinc-700/70 bg-th-card px-2 py-0.5 text-[10px] font-semibold text-zinc-400";
    summaryCount.textContent = String(workspacePaths.length);

    const summaryIcon = document.createElement("i");
    summaryIcon.className = "th-accordion-chevron bi bi-chevron-down text-[10px] text-zinc-500";

    summaryMeta.append(summaryCount, summaryIcon);
    summary.append(summaryLabel, summaryMeta);

    const pathList = document.createElement("div");
    pathList.className = "flex flex-col gap-2 px-3 pb-3";

    for (const workspacePath of workspacePaths) {
      const item = document.createElement("div");
      item.className = "rounded-md border border-th-border-lt bg-th-card/60 px-3 py-2";

      const nameEl = document.createElement("div");
      nameEl.className = "text-[10px] font-semibold uppercase tracking-wide text-zinc-500";
      nameEl.textContent = workspacePath.name;

      const cwdEl = document.createElement("div");
      cwdEl.className = "mt-1 text-[11px] font-mono text-zinc-300 break-all";
      cwdEl.textContent = workspacePath.cwd;

      item.append(nameEl, cwdEl);
      pathList.append(item);
    }

    accordion.append(summary, pathList);
    card.append(accordion);
    dom.sessionList.append(card);
  }
}
