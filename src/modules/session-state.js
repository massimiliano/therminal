import { workspaces, PROVIDER_STYLE } from "./state.js";
import { dom } from "./dom.js";
import { launchWorkspaceFromConfig } from "./workspace.js";
import { renderTabs } from "./tabs.js";
import { updateSavedSection } from "./helpers.js";
import { extractInlineArgs } from "./cli-options.js";

export function collectSessionState() {
  const data = [];
  for (const [, ws] of workspaces) {
    data.push({
      name: ws.name,
      providers: ws.clients.map((c) => c.provider),
      commands: ws.clients.map((c) => c.command),
      inlineArgs: ws.clients.map((c) => extractInlineArgs(c.provider, c.command)),
      cwd: ws.clients[0]?.cwd || ".",
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
  for (const ws of config.workspaces) {
    await launchWorkspaceFromConfig(ws);
  }
  renderTabs();
}

export async function loadSessionsUI() {
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
    const card = document.createElement("button");
    card.className =
      "flex items-center gap-3 px-4 py-2.5 bg-th-card border border-th-border-lt rounded-[10px] cursor-pointer transition-all duration-200 text-left min-w-[180px] hover:border-emerald-400 hover:bg-emerald-400/[0.03]";

    const info = document.createElement("div");
    info.className = "flex flex-col gap-0.5 flex-1 min-w-0";

    const title = document.createElement("span");
    title.className = "text-[13px] font-semibold text-th-fg";
    title.textContent = name;

    // Workspace summary: "Workspace 1 [4] [2]  ·  Workspace 2 [3]"
    const wsDesc = document.createElement("div");
    wsDesc.className = "flex items-center gap-2 flex-wrap";

    for (const ws of config.workspaces) {
      const wsChip = document.createElement("span");
      wsChip.className = "flex items-center gap-1";

      const wsName = document.createElement("span");
      wsName.className = "text-[10px] text-zinc-500 font-mono";
      wsName.textContent = ws.name;
      wsChip.append(wsName);

      const counts = {};
      for (const p of ws.providers) {
        counts[p] = (counts[p] || 0) + 1;
      }
      for (const [provider, count] of Object.entries(counts)) {
        const dot = document.createElement("span");
        dot.className = `inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded text-[8px] font-bold leading-none ${PROVIDER_STYLE[provider]?.dot || "bg-zinc-700 text-zinc-400"}`;
        dot.textContent = count;
        wsChip.append(dot);
      }

      wsDesc.append(wsChip);
    }

    const pathEl = document.createElement("span");
    pathEl.className = "text-[9px] text-zinc-600 font-mono truncate";
    pathEl.textContent = config.workspaces[0]?.cwd || ".";

    info.append(title, wsDesc, pathEl);

    const deleteBtn = document.createElement("button");
    deleteBtn.className =
      "w-6 h-6 flex items-center justify-center bg-transparent text-zinc-700 cursor-pointer rounded text-xs transition-all duration-150 shrink-0 hover:text-red-500 hover:bg-red-500/10";
    deleteBtn.innerHTML = '<i class="bi bi-trash3"></i>';
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await window.launcherAPI.deleteSession(name);
      loadSessionsUI();
    });

    card.append(info, deleteBtn);
    card.addEventListener("click", () => restoreSession(config));
    dom.sessionList.append(card);
  }
}
