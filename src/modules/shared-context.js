import { dom } from "./dom.js";
import { showNotice } from "./notices.js";
import { state, sessionStore, workspaces } from "./state.js";
import { getTaskStatusMeta, normalizeTaskStatus } from "./task-status.js";

const CAPTURE_TAIL_LINES = 80;
const CONTEXT_BUTTON_IDLE = "text-zinc-500";
const CONTEXT_BUTTON_ACTIVE = "text-emerald-400 bg-emerald-400/5";
const WORKFLOW_TEMPLATES = {
  general: {
    label: "General handoff",
    constraints: "Preserva coerenza con repository, file reali e stato del terminale.",
    nextStep: "Conferma il contesto e procedi con il task richiesto."
  },
  "spec-impl": {
    label: "Spec to implementation",
    constraints: "Implementa senza rompere flussi esistenti; verifica l'impatto sui file toccati.",
    nextStep: "Traduci la specifica in patch concrete e verifica il risultato."
  },
  "review-fix": {
    label: "Review and fix",
    constraints: "Cerca regressioni, edge case e mismatch con il comportamento atteso.",
    nextStep: "Rivedi il lavoro esistente, segnala i problemi e applica i fix prioritari."
  },
  debug: {
    label: "Debug and recover",
    constraints: "Riproduci il problema, isola il guasto e evita workaround non verificati.",
    nextStep: "Trova la causa radice, correggila e verifica il comportamento finale."
  }
};

let modalWorkspaceId = null;

export function normalizeSharedContext(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStructuredContext(payload = {}) {
  const template = WORKFLOW_TEMPLATES[payload?.template] ? payload.template : "general";
  return {
    template,
    goal: typeof payload?.goal === "string" ? payload.goal.trim() : "",
    constraints: typeof payload?.constraints === "string" ? payload.constraints.trim() : "",
    decisions: typeof payload?.decisions === "string" ? payload.decisions.trim() : "",
    nextStep: typeof payload?.nextStep === "string" ? payload.nextStep.trim() : "",
    summary: typeof payload?.summary === "string" ? payload.summary.trim() : ""
  };
}

function ensureWorkspaceContextModel(workspace) {
  if (!workspace) {
    return null;
  }

  workspace.sharedContext = normalizeSharedContext(workspace.sharedContext);
  workspace.handoff = normalizeStructuredContext(workspace.handoff || workspace.meta?.handoff || {});
  workspace.gitStatus = workspace.gitStatus || null;
  workspace.gitStatusPending = Boolean(workspace.gitStatusPending);
  return workspace;
}

function getActiveWorkspace() {
  return ensureWorkspaceContextModel(workspaces.get(state.activeView) || null);
}

function getWorkspaceCwd(workspace) {
  const candidate = workspace?.clients?.find((client) => typeof client.cwd === "string" && client.cwd.trim());
  return candidate?.cwd || ".";
}

function isAnyContextPresent(workspace) {
  if (!workspace) {
    return false;
  }

  const handoff = ensureWorkspaceContextModel(workspace).handoff;
  return Boolean(
    workspace.sharedContext ||
      handoff.goal ||
      handoff.constraints ||
      handoff.decisions ||
      handoff.nextStep ||
      handoff.summary
  );
}

function getWorkspaceContextStats(workspace) {
  const handoff = ensureWorkspaceContextModel(workspace)?.handoff;
  const noteLength = normalizeSharedContext(workspace?.sharedContext).length;
  const structuredCount = [handoff?.goal, handoff?.constraints, handoff?.decisions, handoff?.nextStep, handoff?.summary]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .length;

  if (!noteLength && structuredCount === 0) {
    return "Contesto vuoto per questo workspace.";
  }

  return `${structuredCount} campi strutturati / ${noteLength} caratteri note`;
}

function syncContextButton(workspace) {
  if (!dom.sharedContextToggle) {
    return;
  }

  const hasContext = isAnyContextPresent(workspace);
  dom.sharedContextToggle.classList.remove("text-zinc-500", "text-emerald-400", "bg-emerald-400/5");
  dom.sharedContextToggle.classList.add(...(hasContext ? CONTEXT_BUTTON_ACTIVE : CONTEXT_BUTTON_IDLE).split(" "));
  dom.sharedContextToggle.title = hasContext
    ? "Handoff e contesto condiviso disponibili per questo workspace"
    : "Contesto condiviso del workspace";
}

function renderGitToolbar(gitStatus) {
  if (!dom.gitToolbarBadge || !dom.gitToolbarText || !dom.gitToolbarDot) {
    return;
  }

  dom.gitToolbarBadge.classList.remove("text-zinc-500", "text-emerald-300", "text-amber-300", "text-red-300");
  dom.gitToolbarDot.className = "inline-block w-1.5 h-1.5 rounded-full";

  if (!gitStatus?.ok) {
    dom.gitToolbarBadge.classList.add("text-zinc-500");
    dom.gitToolbarText.textContent = "Git n/d";
    dom.gitToolbarDot.classList.add("bg-zinc-500");
    return;
  }

  if (gitStatus.dirty) {
    dom.gitToolbarBadge.classList.add("text-amber-300");
    dom.gitToolbarText.textContent = `${gitStatus.branch} +${gitStatus.changedCount}`;
    dom.gitToolbarDot.classList.add("bg-amber-400");
    return;
  }

  dom.gitToolbarBadge.classList.add("text-emerald-300");
  dom.gitToolbarText.textContent = gitStatus.branch;
  dom.gitToolbarDot.classList.add("bg-emerald-400");
}

function renderGitSnapshot(gitStatus) {
  renderGitToolbar(gitStatus);

  if (!dom.sharedContextGitMeta || !dom.sharedContextGitFiles) {
    return;
  }

  if (!gitStatus?.ok) {
    dom.sharedContextGitMeta.textContent = gitStatus?.message || "Nessun repository Git rilevato.";
    dom.sharedContextGitFiles.innerHTML = "";
    if (dom.sharedContextAppendGitBtn) {
      dom.sharedContextAppendGitBtn.disabled = true;
    }
    return;
  }

  const parts = [
    `Branch ${gitStatus.branch}`,
    gitStatus.dirty ? `${gitStatus.changedCount} file modificati` : "working tree pulito",
    gitStatus.ahead ? `ahead ${gitStatus.ahead}` : null,
    gitStatus.behind ? `behind ${gitStatus.behind}` : null,
    gitStatus.repoRoot
  ].filter(Boolean);

  dom.sharedContextGitMeta.textContent = parts.join(" / ");
  dom.sharedContextGitFiles.innerHTML = "";

  for (const file of gitStatus.files || []) {
    const chip = document.createElement("span");
    chip.className =
      "inline-flex items-center gap-1 rounded-full border border-zinc-700/70 bg-th-body px-2 py-1 text-[10px] font-mono text-zinc-300";
    const status = document.createElement("span");
    status.className = file.untracked ? "text-amber-300" : file.staged ? "text-emerald-300" : "text-blue-300";
    status.textContent = `${file.indexStatus}${file.worktreeStatus}`;
    const pathEl = document.createElement("span");
    pathEl.textContent = file.path;
    chip.append(status, pathEl);
    dom.sharedContextGitFiles.append(chip);
  }

  if (dom.sharedContextAppendGitBtn) {
    dom.sharedContextAppendGitBtn.disabled = false;
  }
}

function loadFormFromWorkspace(workspace) {
  ensureWorkspaceContextModel(workspace);

  if (dom.sharedContextTemplateSelect) {
    dom.sharedContextTemplateSelect.value = workspace?.handoff?.template || "general";
  }
  if (dom.sharedContextGoalInput) {
    dom.sharedContextGoalInput.value = workspace?.handoff?.goal || "";
  }
  if (dom.sharedContextConstraintsInput) {
    dom.sharedContextConstraintsInput.value = workspace?.handoff?.constraints || "";
  }
  if (dom.sharedContextDecisionsInput) {
    dom.sharedContextDecisionsInput.value = workspace?.handoff?.decisions || "";
  }
  if (dom.sharedContextNextStepInput) {
    dom.sharedContextNextStepInput.value = workspace?.handoff?.nextStep || "";
  }
  if (dom.sharedContextSummaryInput) {
    dom.sharedContextSummaryInput.value = workspace?.handoff?.summary || "";
  }
  if (dom.sharedContextInput) {
    dom.sharedContextInput.value = workspace?.sharedContext || "";
  }

  renderGitSnapshot(workspace?.gitStatus);
}

function getSessionTail(session, maxLines = CAPTURE_TAIL_LINES) {
  const buffer = session?.terminal?.buffer?.active;
  if (!buffer) {
    return "";
  }

  const start = Math.max(0, buffer.length - maxLines);
  const lines = [];

  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (!line) {
      continue;
    }

    const text = line.translateToString().replace(/\s+$/, "");
    if (text.trim().length > 0) {
      lines.push(text);
    }
  }

  return lines.join("\n").trim();
}

function getWorkspaceAiSessions() {
  const workspace = getActiveWorkspace();
  if (!workspace) {
    return [];
  }

  return workspace.clients
    .map((client) => sessionStore.get(client.sessionId))
    .filter((session) => session && session.provider !== "terminal");
}

function getPreferredTargetSession() {
  const focused = state.focusedSessionId ? sessionStore.get(state.focusedSessionId) : null;
  if (focused && focused.workspaceId === state.activeView && focused.provider !== "terminal") {
    return focused;
  }

  return getWorkspaceAiSessions()[0] || null;
}

function getFocusedWorkspaceSession() {
  const focused = state.focusedSessionId ? sessionStore.get(state.focusedSessionId) : null;
  if (focused && focused.workspaceId === state.activeView) {
    return focused;
  }

  const workspace = getActiveWorkspace();
  const sessionId = workspace?.clients?.find((client) => client.sessionId)?.sessionId;
  return sessionId ? sessionStore.get(sessionId) : null;
}

function buildTaskBoardSummary(workspace) {
  if (!workspace?.clients?.length) {
    return "";
  }

  return workspace.clients
    .map((client, index) => {
      const session = client.sessionId ? sessionStore.get(client.sessionId) : null;
      const taskStatus = getTaskStatusMeta(session?.taskStatus || client.taskStatus);
      const provider = session?.provider || client.provider || "terminal";
      return `- #${index + 1} ${provider}: ${taskStatus.label}`;
    })
    .join("\n");
}

function buildGitSnapshotText(gitStatus) {
  if (!gitStatus?.ok) {
    return "";
  }

  const lines = [
    "Git snapshot:",
    `- Branch: ${gitStatus.branch}`,
    `- Repo: ${gitStatus.repoRoot}`,
    `- Changed files: ${gitStatus.changedCount}`,
    `- Staged files: ${gitStatus.stagedCount}`,
    `- Untracked files: ${gitStatus.untrackedCount}`
  ];

  if (gitStatus.ahead) {
    lines.push(`- Ahead: ${gitStatus.ahead}`);
  }
  if (gitStatus.behind) {
    lines.push(`- Behind: ${gitStatus.behind}`);
  }

  if (Array.isArray(gitStatus.files) && gitStatus.files.length > 0) {
    lines.push("- Files:");
    for (const file of gitStatus.files) {
      lines.push(`  - ${file.indexStatus}${file.worktreeStatus} ${file.path}`);
    }
  }

  return lines.join("\n");
}

function formatCaptureBlock(label, content) {
  const timestamp = new Date().toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `### ${label} - ${timestamp}\n${content}`;
}

function buildActiveSessionSummary(session) {
  if (!session) {
    return "";
  }

  const status = getTaskStatusMeta(session.taskStatus);
  const recentOutput = getSessionTail(session, 40);
  const lines = [
    `Sessione #${session.clientIndex + 1} (${session.provider})`,
    `Task status: ${status.label}`,
    `Working directory: ${session.cwd}`
  ];

  if (recentOutput) {
    lines.push("Output recente:", recentOutput);
  }

  return lines.join("\n");
}

function updateWorkspaceFields(workspace, patch) {
  if (!workspace) {
    return;
  }

  ensureWorkspaceContextModel(workspace);
  workspace.handoff = normalizeStructuredContext({
    ...workspace.handoff,
    ...patch
  });
}

export function setWorkspaceSharedContext(workspace, value, { skipEditorSync = false } = {}) {
  if (!workspace) {
    return "";
  }

  workspace.sharedContext = normalizeSharedContext(value);

  if (!skipEditorSync && workspace.id === state.activeView && dom.sharedContextInput) {
    dom.sharedContextInput.value = workspace.sharedContext;
  }

  if (workspace.id === state.activeView) {
    syncSharedContextUi();
  }

  return workspace.sharedContext;
}

function appendWorkspaceSharedContext(block) {
  const workspace = getActiveWorkspace();
  if (!workspace) {
    return;
  }

  const current = normalizeSharedContext(workspace.sharedContext);
  const normalizedBlock = normalizeSharedContext(block);
  const nextValue = current ? `${current}\n\n${normalizedBlock}` : normalizedBlock;
  setWorkspaceSharedContext(workspace, nextValue);
}

async function refreshWorkspaceGitStatus({ notifyErrors = false } = {}) {
  const workspace = getActiveWorkspace();
  if (!workspace || !window.launcherAPI?.getGitStatus) {
    return null;
  }
  if (workspace.gitStatusPending) {
    return workspace.gitStatus;
  }

  try {
    workspace.gitStatusPending = true;
    const gitStatus = await window.launcherAPI.getGitStatus({ cwd: getWorkspaceCwd(workspace) });
    workspace.gitStatus = gitStatus;
    renderGitSnapshot(gitStatus);
    return gitStatus;
  } catch (error) {
    const fallback = {
      ok: false,
      message: "Impossibile leggere lo stato Git del workspace."
    };
    workspace.gitStatus = fallback;
    renderGitSnapshot(fallback);
    if (notifyErrors) {
      showNotice(error?.message || fallback.message, { type: "warning", timeoutMs: 2600 });
    }
    return fallback;
  } finally {
    workspace.gitStatusPending = false;
  }
}

function buildStructuredPrompt(workspace) {
  const handoff = normalizeStructuredContext(workspace?.handoff);
  const taskBoard = buildTaskBoardSummary(workspace);
  const gitSnapshot = buildGitSnapshotText(workspace?.gitStatus);
  const notes = normalizeSharedContext(workspace?.sharedContext);
  const templateLabel = WORKFLOW_TEMPLATES[handoff.template]?.label || WORKFLOW_TEMPLATES.general.label;
  const sections = [
    "Contesto condiviso del workspace.",
    `Workflow: ${templateLabel}`
  ];

  if (handoff.goal) {
    sections.push("", "Goal:", handoff.goal);
  }
  if (handoff.constraints) {
    sections.push("", "Constraints:", handoff.constraints);
  }
  if (handoff.decisions) {
    sections.push("", "Decisions:", handoff.decisions);
  }
  if (handoff.nextStep) {
    sections.push("", "Next step:", handoff.nextStep);
  }
  if (handoff.summary) {
    sections.push("", "Summary:", handoff.summary);
  }
  if (taskBoard) {
    sections.push("", "Task board:", taskBoard);
  }
  if (gitSnapshot) {
    sections.push("", gitSnapshot);
  }
  if (notes) {
    sections.push("", "Workspace notes:", notes);
  }

  sections.push("", "Conferma brevemente che hai recepito il contesto e attendi il task successivo.");
  return sections.join("\n");
}

function sendContextToSessions(sessions) {
  const workspace = getActiveWorkspace();
  if (!workspace || !isAnyContextPresent(workspace)) {
    showNotice("Il contesto condiviso e vuoto.", { type: "warning" });
    return;
  }

  const targetSessions = sessions.filter((session) => session && session.provider !== "terminal");
  if (targetSessions.length === 0) {
    showNotice("Nessuna sessione AI disponibile per l'invio del contesto.", { type: "warning" });
    return;
  }

  const prompt = `${buildStructuredPrompt(workspace)}\r`;
  for (const session of targetSessions) {
    window.launcherAPI.writeSession(session.id, prompt);
  }

  showNotice(
    targetSessions.length === 1
      ? "Handoff inviato alla sessione AI attiva."
      : `Handoff inviato a ${targetSessions.length} sessioni AI del workspace.`,
    { type: "success", timeoutMs: 3200 }
  );
}

function handleCaptureSelection() {
  const session = getFocusedWorkspaceSession();
  if (!session) {
    showNotice("Seleziona prima del testo in una sessione del workspace attivo.", { type: "warning" });
    return;
  }

  const selection = session.terminal?.getSelection?.().trim();
  if (!selection) {
    showNotice("Nessuna selezione trovata nel terminale attivo.", { type: "warning" });
    return;
  }

  appendWorkspaceSharedContext(
    formatCaptureBlock(`Selezione ${session.provider.toUpperCase()} #${session.clientIndex + 1}`, selection)
  );
  showNotice("Selezione acquisita nelle note del workspace.", { type: "success", timeoutMs: 2600 });
}

function handleCaptureTail() {
  const session = getFocusedWorkspaceSession();
  if (!session) {
    showNotice("Metti a fuoco prima una sessione del workspace attivo.", { type: "warning" });
    return;
  }

  const tail = getSessionTail(session);
  if (!tail) {
    showNotice("Nessun output recente disponibile nel terminale attivo.", { type: "warning" });
    return;
  }

  appendWorkspaceSharedContext(
    formatCaptureBlock(`Tail ${session.provider.toUpperCase()} #${session.clientIndex + 1}`, tail)
  );
  showNotice("Ultime righe acquisite nelle note del workspace.", { type: "success", timeoutMs: 2600 });
}

function handleGenerateSummary() {
  const workspace = getActiveWorkspace();
  const session = getFocusedWorkspaceSession();
  if (!workspace || !session) {
    showNotice("Nessuna sessione attiva disponibile per generare il summary.", { type: "warning" });
    return;
  }

  const summary = buildActiveSessionSummary(session);
  updateWorkspaceFields(workspace, { summary });
  if (dom.sharedContextSummaryInput) {
    dom.sharedContextSummaryInput.value = workspace.handoff.summary;
  }
  syncSharedContextUi();
  showNotice("Summary aggiornato dalla sessione attiva.", { type: "success", timeoutMs: 2200 });
}

function handleAppendGitSnapshot() {
  const workspace = getActiveWorkspace();
  if (!workspace?.gitStatus?.ok) {
    showNotice("Nessuno snapshot Git disponibile da aggiungere.", { type: "warning" });
    return;
  }

  appendWorkspaceSharedContext(buildGitSnapshotText(workspace.gitStatus));
  showNotice("Snapshot Git aggiunto alle note del workspace.", { type: "success", timeoutMs: 2200 });
}

function applyTemplateDefaults(templateKey) {
  const workspace = getActiveWorkspace();
  if (!workspace) {
    return;
  }

  const template = WORKFLOW_TEMPLATES[templateKey] || WORKFLOW_TEMPLATES.general;
  updateWorkspaceFields(workspace, {
    template: templateKey,
    constraints: workspace.handoff.constraints || template.constraints,
    nextStep: workspace.handoff.nextStep || template.nextStep
  });
  loadFormFromWorkspace(workspace);
  syncSharedContextUi();
}

function updateModalState() {
  const workspace = getActiveWorkspace();
  const hasWorkspace = Boolean(workspace);
  const activeAiSession = getPreferredTargetSession();
  const aiSessionCount = getWorkspaceAiSessions().length;
  const hasContext = hasWorkspace && isAnyContextPresent(workspace);

  if (dom.sharedContextMeta) {
    dom.sharedContextMeta.textContent = hasWorkspace
      ? `${workspace.name || "Workspace"} - ${getWorkspaceContextStats(workspace)}`
      : "Nessun workspace attivo";
  }
  if (dom.sharedContextStatus) {
    dom.sharedContextStatus.textContent = hasWorkspace
      ? "L'handoff viene salvato insieme alla sessione del workspace."
      : "Apri un workspace per usare l'handoff strutturato.";
  }

  const controls = [
    dom.sharedContextTemplateSelect,
    dom.sharedContextGoalInput,
    dom.sharedContextConstraintsInput,
    dom.sharedContextDecisionsInput,
    dom.sharedContextNextStepInput,
    dom.sharedContextSummaryInput,
    dom.sharedContextInput,
    dom.sharedContextCaptureSelectionBtn,
    dom.sharedContextCaptureTailBtn,
    dom.sharedContextGenerateSummaryBtn,
    dom.sharedContextClearBtn,
    dom.sharedContextRefreshGitBtn
  ];

  for (const control of controls) {
    if (control) {
      control.disabled = !hasWorkspace;
    }
  }

  if (dom.sharedContextAppendGitBtn) {
    dom.sharedContextAppendGitBtn.disabled = !hasWorkspace || !workspace?.gitStatus?.ok;
  }
  if (dom.sharedContextSendActiveBtn) {
    dom.sharedContextSendActiveBtn.disabled = !hasContext || !activeAiSession;
  }
  if (dom.sharedContextSendAllBtn) {
    dom.sharedContextSendAllBtn.disabled = !hasContext || aiSessionCount === 0;
  }
}

export function openSharedContextModal() {
  const workspace = getActiveWorkspace();
  if (!workspace) {
    showNotice("Apri prima un workspace per usare il contesto condiviso.", { type: "warning" });
    return;
  }

  modalWorkspaceId = workspace.id;
  loadFormFromWorkspace(workspace);
  dom.sharedContextModal?.classList.remove("hidden");
  syncSharedContextUi();
  refreshWorkspaceGitStatus();
  dom.sharedContextGoalInput?.focus();
}

export function closeSharedContextModal() {
  dom.sharedContextModal?.classList.add("hidden");
  modalWorkspaceId = null;
}

export function syncSharedContextUi() {
  const workspace = getActiveWorkspace();
  syncContextButton(workspace);
  renderGitToolbar(workspace?.gitStatus);

  if (workspace && !workspace.gitStatus && !workspace.gitStatusPending && window.launcherAPI?.getGitStatus) {
    refreshWorkspaceGitStatus();
  }

  if (!dom.sharedContextModal || dom.sharedContextModal.classList.contains("hidden")) {
    return;
  }

  if (!workspace) {
    closeSharedContextModal();
    return;
  }

  if (modalWorkspaceId !== workspace.id) {
    modalWorkspaceId = workspace.id;
    loadFormFromWorkspace(workspace);
  }

  updateModalState();
}

export function initSharedContext() {
  if (!dom.sharedContextToggle || !dom.sharedContextModal || !dom.sharedContextInput) {
    return;
  }

  dom.sharedContextToggle.addEventListener("click", () => openSharedContextModal());
  dom.sharedContextCloseBtn?.addEventListener("click", () => closeSharedContextModal());
  dom.sharedContextBackdrop?.addEventListener("click", () => closeSharedContextModal());
  dom.gitToolbarBadge?.addEventListener("click", () => openSharedContextModal());

  dom.sharedContextTemplateSelect?.addEventListener("change", () => {
    const template = dom.sharedContextTemplateSelect.value;
    const workspace = getActiveWorkspace();
    if (!workspace) {
      return;
    }
    updateWorkspaceFields(workspace, { template });
    applyTemplateDefaults(template);
  });
  dom.sharedContextGoalInput?.addEventListener("input", () => {
    updateWorkspaceFields(getActiveWorkspace(), { goal: dom.sharedContextGoalInput.value });
    syncSharedContextUi();
  });
  dom.sharedContextConstraintsInput?.addEventListener("input", () => {
    updateWorkspaceFields(getActiveWorkspace(), { constraints: dom.sharedContextConstraintsInput.value });
    syncSharedContextUi();
  });
  dom.sharedContextDecisionsInput?.addEventListener("input", () => {
    updateWorkspaceFields(getActiveWorkspace(), { decisions: dom.sharedContextDecisionsInput.value });
    syncSharedContextUi();
  });
  dom.sharedContextNextStepInput?.addEventListener("input", () => {
    updateWorkspaceFields(getActiveWorkspace(), { nextStep: dom.sharedContextNextStepInput.value });
    syncSharedContextUi();
  });
  dom.sharedContextSummaryInput?.addEventListener("input", () => {
    updateWorkspaceFields(getActiveWorkspace(), { summary: dom.sharedContextSummaryInput.value });
    syncSharedContextUi();
  });
  dom.sharedContextInput.addEventListener("input", () => {
    setWorkspaceSharedContext(getActiveWorkspace(), dom.sharedContextInput.value, { skipEditorSync: true });
  });

  dom.sharedContextCaptureSelectionBtn?.addEventListener("click", () => handleCaptureSelection());
  dom.sharedContextCaptureTailBtn?.addEventListener("click", () => handleCaptureTail());
  dom.sharedContextGenerateSummaryBtn?.addEventListener("click", () => handleGenerateSummary());
  dom.sharedContextRefreshGitBtn?.addEventListener("click", () => {
    refreshWorkspaceGitStatus({ notifyErrors: true });
  });
  dom.sharedContextAppendGitBtn?.addEventListener("click", () => handleAppendGitSnapshot());
  dom.sharedContextClearBtn?.addEventListener("click", () => {
    const workspace = getActiveWorkspace();
    if (!workspace) {
      return;
    }

    workspace.sharedContext = "";
    workspace.handoff = normalizeStructuredContext({ template: workspace.handoff.template });
    loadFormFromWorkspace(workspace);
    syncSharedContextUi();
    showNotice("Handoff e note del workspace azzerati.", { type: "info", timeoutMs: 2200 });
  });
  dom.sharedContextSendActiveBtn?.addEventListener("click", () => {
    const session = getPreferredTargetSession();
    if (!session) {
      showNotice("Nessuna sessione AI attiva disponibile.", { type: "warning" });
      return;
    }
    sendContextToSessions([session]);
  });
  dom.sharedContextSendAllBtn?.addEventListener("click", () => {
    sendContextToSessions(getWorkspaceAiSessions());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.sharedContextModal.classList.contains("hidden")) {
      closeSharedContextModal();
    }
  });

  syncSharedContextUi();
}
