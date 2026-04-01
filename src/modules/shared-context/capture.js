import { CAPTURE_TAIL_LINES, NON_AI_PROVIDERS, WORKFLOW_TEMPLATES } from "./model.js";

export function createSharedContextCaptureController({
  state,
  sessionStore,
  workspaces,
  dom,
  showNotice,
  getTaskStatusMeta,
  normalizeSharedContext,
  normalizeStructuredContext,
  ensureWorkspaceContextModel,
  isAnyContextPresent,
  updateWorkspaceFields,
  setWorkspaceSharedContext,
  getActiveWorkspace,
  syncSharedContextUi
}) {
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
      .filter((session) => session && !NON_AI_PROVIDERS.has(session.provider));
  }

  function getPreferredTargetSession() {
    const focused = state.focusedSessionId ? sessionStore.get(state.focusedSessionId) : null;
    if (
      focused &&
      focused.workspaceId === state.activeView &&
      !NON_AI_PROVIDERS.has(focused.provider)
    ) {
      return focused;
    }

    return getWorkspaceAiSessions()[0] || null;
  }

  function getFocusedWorkspaceSession() {
    const focused = state.focusedSessionId ? sessionStore.get(state.focusedSessionId) : null;
    if (focused && focused.workspaceId === state.activeView && focused.provider !== "browser") {
      return focused;
    }

    const workspace = getActiveWorkspace();
    const sessionId = workspace?.clients?.find((client) => {
      const session = client.sessionId ? sessionStore.get(client.sessionId) : null;
      return session && session.provider !== "browser";
    })?.sessionId;
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

  function buildStructuredPrompt(workspace) {
    const handoff = normalizeStructuredContext(workspace?.handoff);
    const taskBoard = buildTaskBoardSummary(workspace);
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

    const targetSessions = sessions.filter((session) => session && !NON_AI_PROVIDERS.has(session.provider));
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

  return {
    getPreferredTargetSession,
    getWorkspaceAiSessions,
    handleCaptureSelection,
    handleCaptureTail,
    handleGenerateSummary,
    sendContextToSessions
  };
}
