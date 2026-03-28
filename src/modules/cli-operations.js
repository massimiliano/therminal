import { dom } from "./dom.js";
import { state, sessionStore } from "./state.js";
import {
  MAX_FAVORITE_MESSAGE_PRESETS,
  getMessagePresets,
  saveMessagePresets
} from "./app-config.js";
import { showNotice } from "./notices.js";

let editingPresetId = null;
let preferredSessionId = null;

function getPresetSummary(text = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Nessun contenuto";
  }
  if (normalized.length <= 96) {
    return normalized;
  }
  return `${normalized.slice(0, 96)}...`;
}

function resolveTargetSession() {
  const preferred = preferredSessionId ? sessionStore.get(preferredSessionId) : null;
  if (preferred) {
    return preferred;
  }

  const focused = state.focusedSessionId ? sessionStore.get(state.focusedSessionId) : null;
  if (focused) {
    return focused;
  }

  const activeWorkspaceMatch = Array.from(sessionStore.values()).find(
    (session) => session.workspaceId === state.activeView
  );
  if (activeWorkspaceMatch) {
    return activeWorkspaceMatch;
  }

  return Array.from(sessionStore.values())[0] || null;
}

function getSessionLabel(session) {
  if (!session) {
    return "Nessuna sessione target selezionata.";
  }

  return `${session.provider} - Workspace ${session.workspaceId} - Client ${session.clientIndex + 1}`;
}

function dispatchMessagePresetUpdate() {
  document.dispatchEvent(
    new CustomEvent("therminal:message-presets-updated", {
      detail: getMessagePresets()
    })
  );
}

function setEditorTitle() {
  if (!dom.operationEditorTitle) {
    return;
  }

  dom.operationEditorTitle.textContent = editingPresetId ? "Modifica preset" : "Nuovo preset";
}

function fillPresetForm(preset = null) {
  editingPresetId = preset?.id || null;
  if (dom.operationNameInput) {
    dom.operationNameInput.value = preset?.label || "";
  }
  if (dom.operationContentInput) {
    dom.operationContentInput.value = preset?.content || "";
  }
  setEditorTitle();
}

function setActiveView(view) {
  const isLibrary = view === "library";
  dom.operationsLibrarySection?.classList.toggle("hidden", !isLibrary);
  dom.operationsEditorSection?.classList.toggle("hidden", isLibrary);
}

function showLibraryView() {
  fillPresetForm();
  setActiveView("library");
  dom.operationNewBtn?.focus();
}

function showEditorView(preset = null) {
  fillPresetForm(preset);
  setActiveView("editor");
  window.setTimeout(() => {
    if (dom.operationNameInput?.value?.trim()) {
      dom.operationContentInput?.focus();
      return;
    }
    dom.operationNameInput?.focus();
  }, 0);
}

function renderTargetMeta() {
  if (!dom.operationsTargetMeta) {
    return;
  }

  dom.operationsTargetMeta.textContent = getSessionLabel(resolveTargetSession());
}

function buildEmptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "message-preset-empty";
  wrapper.innerHTML = `
    <i class="bi bi-chat-square-text"></i>
    <div>
      <p class="text-sm font-medium text-zinc-300">Nessun preset salvato</p>
      <p class="mt-1 text-xs text-zinc-500">Crea una libreria di messaggi riutilizzabili e segnane fino a 5 come preferiti.</p>
    </div>
  `;
  return wrapper;
}

async function sendPresetToSession(sessionId, preset) {
  const target = sessionStore.get(sessionId);
  if (!target) {
    showNotice("Sessione target non disponibile.", { type: "warning", timeoutMs: 2600 });
    return;
  }

  const content = String(preset.content || "").replace(/\r\n/g, "\n");
  target.terminal?.focus?.();
  window.launcherAPI.writeSession(target.id, content);
  preferredSessionId = target.id;
  renderTargetMeta();
  showNotice(`Preset inserito in ${target.provider} #${target.clientIndex + 1}. Premi Enter dal terminale per inviarlo.`, {
    type: "success",
    timeoutMs: 2600
  });
}

function sendPreset(preset) {
  const target = resolveTargetSession();
  if (!target) {
    showNotice("Nessuna sessione disponibile per l'invio.", {
      type: "warning",
      timeoutMs: 3000
    });
    return;
  }

  sendPresetToSession(target.id, preset);
}

async function toggleFavoritePreset(presetId) {
  const nextPresets = getMessagePresets();
  const target = nextPresets.find((preset) => preset.id === presetId);
  if (!target) {
    return;
  }

  target.isFavorite = !target.isFavorite;
  const favoriteCount = nextPresets.filter((preset) => preset.isFavorite).length;
  if (favoriteCount > MAX_FAVORITE_MESSAGE_PRESETS) {
    showNotice(`Puoi avere al massimo ${MAX_FAVORITE_MESSAGE_PRESETS} preferiti.`, {
      type: "warning",
      timeoutMs: 3200
    });
    return;
  }

  await saveMessagePresets(nextPresets);
  renderOperationsModal();
  dispatchMessagePresetUpdate();
}

async function deletePreset(presetId) {
  const nextPresets = getMessagePresets().filter((preset) => preset.id !== presetId);
  await saveMessagePresets(nextPresets);
  renderOperationsModal();
  dispatchMessagePresetUpdate();
  showNotice("Preset eliminato.", { type: "success", timeoutMs: 2200 });
}

function createIconButton(title, iconClass, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.innerHTML = `<i class="bi ${iconClass}"></i>`;
  button.addEventListener("click", onClick);
  return button;
}

function renderOperationsList() {
  if (!dom.operationsList) {
    return;
  }

  const presets = getMessagePresets();
  dom.operationsList.innerHTML = "";

  if (presets.length === 0) {
    dom.operationsList.append(buildEmptyState());
    return;
  }

  for (const preset of presets) {
    const article = document.createElement("article");
    article.className = "message-preset-card";

    const head = document.createElement("div");
    head.className = "flex items-start justify-between gap-3";

    const info = document.createElement("div");
    info.className = "min-w-0 flex-1";
    info.innerHTML = `
      <div class="message-preset-card-top">
        <p class="message-preset-card-title">${preset.label}</p>
      </div>
      <p class="message-preset-card-summary">${getPresetSummary(preset.content)}</p>
      <div class="message-preset-card-meta">
        <span><i class="bi bi-keyboard"></i> Invio manuale</span>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "message-preset-actions";

    const favoriteBtn = createIconButton(
      preset.isFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti",
      preset.isFavorite ? "bi-star-fill" : "bi-star",
      `message-preset-star ${preset.isFavorite ? "is-active" : ""}`,
      () => toggleFavoritePreset(preset.id)
    );

    const sendBtn = createIconButton(
      "Inserisci preset nel terminale",
      "bi-send-fill",
      "message-preset-icon-btn is-send",
      () => sendPreset(preset)
    );

    const editBtn = createIconButton(
      "Modifica preset",
      "bi-pencil-square",
      "message-preset-icon-btn",
      () => showEditorView(preset)
    );

    const deleteBtn = createIconButton(
      "Elimina preset",
      "bi-trash3",
      "message-preset-icon-btn is-danger",
      () => deletePreset(preset.id)
    );

    actions.append(favoriteBtn, sendBtn, editBtn, deleteBtn);
    head.append(info, actions);
    article.append(head);
    dom.operationsList.append(article);
  }
}

function renderOperationsModal() {
  renderTargetMeta();
  renderOperationsList();
  setEditorTitle();
}

async function handleSavePreset() {
  const content = dom.operationContentInput?.value?.trim() || "";
  if (!content) {
    showNotice("Inserisci un messaggio da salvare.", { type: "warning", timeoutMs: 2600 });
    return;
  }

  const nextPreset = {
    id: editingPresetId,
    label: dom.operationNameInput?.value?.trim() || "",
    content: dom.operationContentInput?.value || ""
  };

  const nextPresets = getMessagePresets();
  const existingIndex = nextPresets.findIndex((preset) => preset.id === editingPresetId);

  if (existingIndex >= 0) {
    nextPresets[existingIndex] = {
      ...nextPresets[existingIndex],
      label: nextPreset.label,
      content: nextPreset.content
    };
  } else {
    nextPresets.push({
      ...nextPreset,
      isFavorite: false
    });
  }

  const favoriteCount = nextPresets.filter((preset) => preset.isFavorite).length;
  if (favoriteCount > MAX_FAVORITE_MESSAGE_PRESETS) {
    showNotice(`Puoi avere al massimo ${MAX_FAVORITE_MESSAGE_PRESETS} preferiti.`, {
      type: "warning",
      timeoutMs: 3200
    });
    return;
  }

  await saveMessagePresets(nextPresets);
  renderOperationsModal();
  dispatchMessagePresetUpdate();
  showLibraryView();
  showNotice("Preset salvato.", { type: "success", timeoutMs: 2200 });
}

export function getFavoriteMessagePresetButtons() {
  return getMessagePresets()
    .filter((preset) => preset.isFavorite)
    .slice(0, MAX_FAVORITE_MESSAGE_PRESETS);
}

export function sendMessagePresetToSession(sessionId, presetId) {
  const preset = getMessagePresets().find((entry) => entry.id === presetId);
  if (!preset) {
    showNotice("Preset non trovato.", { type: "warning", timeoutMs: 2200 });
    return;
  }

  sendPresetToSession(sessionId, preset);
}

export function toggleCliOperationsModal() {
  const willOpen = dom.operationsModal?.classList.contains("hidden");
  dom.operationsModal?.classList.toggle("hidden");

  if (willOpen) {
    showLibraryView();
    renderOperationsModal();
  }
}

export function openCliOperationsModal(options = {}) {
  preferredSessionId = options.sessionId || state.focusedSessionId || null;
  dom.operationsModal?.classList.remove("hidden");
  showLibraryView();
  renderOperationsModal();
}

export function openCliOperationsModalForSession(sessionId) {
  openCliOperationsModal({ sessionId });
}

export function initCliOperationsModal() {
  dom.operationsCloseBtn?.addEventListener("click", () => toggleCliOperationsModal());
  dom.operationsBackdrop?.addEventListener("click", () => toggleCliOperationsModal());
  dom.operationNewBtn?.addEventListener("click", () => showEditorView());
  dom.operationBackBtn?.addEventListener("click", () => showLibraryView());
  dom.operationSaveBtn?.addEventListener("click", () => handleSavePreset());
}
