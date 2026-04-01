export const CAPTURE_TAIL_LINES = 80;
export const CONTEXT_BUTTON_IDLE = "text-zinc-500";
export const CONTEXT_BUTTON_ACTIVE = "text-emerald-400 bg-emerald-400/5";
export const NON_AI_PROVIDERS = new Set(["terminal", "lazygit", "browser"]);
export const WORKFLOW_TEMPLATES = {
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

export function ensureWorkspaceContextModel(workspace) {
  if (!workspace) {
    return null;
  }

  workspace.sharedContext = normalizeSharedContext(workspace.sharedContext);
  workspace.handoff = normalizeStructuredContext(workspace.handoff || workspace.meta?.handoff || {});
  return workspace;
}

export function isAnyContextPresent(workspace) {
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

export function getWorkspaceContextStats(workspace) {
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

export function updateWorkspaceFields(workspace, patch) {
  if (!workspace) {
    return;
  }

  ensureWorkspaceContextModel(workspace);
  workspace.handoff = normalizeStructuredContext({
    ...workspace.handoff,
    ...patch
  });
}
