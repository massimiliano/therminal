import { dom } from "../dom.js";
import { showNotice } from "../notices.js";
import { state, sessionStore, workspaces } from "../state.js";
import { getTaskStatusMeta } from "../task-status.js";
import { createSharedContextCaptureController } from "./capture.js";
import {
  CONTEXT_BUTTON_ACTIVE,
  CONTEXT_BUTTON_IDLE,
  WORKFLOW_TEMPLATES,
  ensureWorkspaceContextModel,
  getWorkspaceContextStats,
  isAnyContextPresent,
  normalizeSharedContext,
  normalizeStructuredContext,
  updateWorkspaceFields
} from "./model.js";

let modalWorkspaceId = null;

function getActiveWorkspace() {
  return ensureWorkspaceContextModel(workspaces.get(state.activeView) || null);
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

const captureController = createSharedContextCaptureController({
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
});

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
  const activeAiSession = captureController.getPreferredTargetSession();
  const aiSessionCount = captureController.getWorkspaceAiSessions().length;
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
    dom.sharedContextClearBtn
  ];

  for (const control of controls) {
    if (control) {
      control.disabled = !hasWorkspace;
    }
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
  dom.sharedContextGoalInput?.focus();
}

export function closeSharedContextModal() {
  dom.sharedContextModal?.classList.add("hidden");
  modalWorkspaceId = null;
}

export function syncSharedContextUi() {
  const workspace = getActiveWorkspace();
  syncContextButton(workspace);

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

  dom.sharedContextCaptureSelectionBtn?.addEventListener("click", () => captureController.handleCaptureSelection());
  dom.sharedContextCaptureTailBtn?.addEventListener("click", () => captureController.handleCaptureTail());
  dom.sharedContextGenerateSummaryBtn?.addEventListener("click", () => captureController.handleGenerateSummary());
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
    const session = captureController.getPreferredTargetSession();
    if (!session) {
      showNotice("Nessuna sessione AI attiva disponibile.", { type: "warning" });
      return;
    }
    captureController.sendContextToSessions([session]);
  });
  dom.sharedContextSendAllBtn?.addEventListener("click", () => {
    captureController.sendContextToSessions(captureController.getWorkspaceAiSessions());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.sharedContextModal.classList.contains("hidden")) {
      closeSharedContextModal();
    }
  });

  syncSharedContextUi();
}
