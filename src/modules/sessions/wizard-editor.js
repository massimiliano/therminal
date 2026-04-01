import { appendInlineArg, getInlineOptionsSchema } from "../cli-options.js";
import { PROVIDER_STYLE } from "../state.js";

export function createWizardEditorController({
  dom,
  state,
  providerCatalog,
  getProviderMeta,
  getProviderActionClass,
  renderClientGrid
}) {
  let activeWizardEditorIndex = null;

  function buildInlineComposer(providerKey, clientIndex, inlineInput, onChange) {
    const schema = getInlineOptionsSchema(providerKey);
    if (schema.length === 0) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "wizard-inline-builder wizard-inline-builder-compact";

    const row = document.createElement("div");
    row.className = "wizard-inline-builder-grid";

    const paramSelect = document.createElement("select");
    paramSelect.className = "wizard-select";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Scegli parametro";
    paramSelect.append(defaultOption);

    for (const option of schema) {
      const opt = document.createElement("option");
      opt.value = option.key;
      opt.textContent = option.key;
      paramSelect.append(opt);
    }

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.className = "wizard-input";
    valueInput.placeholder = "Valore opzionale";

    const valuesDatalist = document.createElement("datalist");
    valuesDatalist.id = `param-values-${providerKey}-${clientIndex}`;
    valueInput.setAttribute("list", valuesDatalist.id);

    const addBtn = document.createElement("button");
    addBtn.className = `wizard-inline-add ${getProviderActionClass(providerKey)}`;
    addBtn.type = "button";
    addBtn.innerHTML = '<i class="bi bi-plus-lg"></i><span>Aggiungi</span>';

    function refreshValueSuggestions() {
      valuesDatalist.innerHTML = "";
      const selected = schema.find((entry) => entry.key === paramSelect.value);
      if (!selected) {
        valueInput.placeholder = "Valore opzionale";
        return;
      }

      if (selected.valueHint === "flag") {
        valueInput.placeholder = "Flag senza valore";
        return;
      }

      valueInput.placeholder = selected.valueHint === "integer" ? "Numero intero" : "Valore";

      for (const value of selected.values || []) {
        const opt = document.createElement("option");
        opt.value = value;
        valuesDatalist.append(opt);
      }
    }

    paramSelect.addEventListener("change", refreshValueSuggestions);

    addBtn.addEventListener("click", () => {
      const key = paramSelect.value;
      if (!key) return;

      state.wizardInlineArgs[clientIndex] = appendInlineArg(
        state.wizardInlineArgs[clientIndex],
        key,
        valueInput.value
      );
      inlineInput.value = state.wizardInlineArgs[clientIndex];
      valueInput.value = "";
      if (typeof onChange === "function") onChange();
    });

    refreshValueSuggestions();
    row.append(paramSelect, valueInput, addBtn);
    wrapper.append(row, valuesDatalist);
    return wrapper;
  }

  function normalizeBulkInlineArgs(providerEntries) {
    const next = {};
    for (const [providerKey] of providerEntries) {
      const value = state.wizardBulkInlineArgs?.[providerKey];
      next[providerKey] = typeof value === "string" ? value : "";
    }
    state.wizardBulkInlineArgs = next;
  }

  function applyBulkInlineArgsForProvider(providerKey) {
    const value = state.wizardBulkInlineArgs?.[providerKey] || "";
    for (let i = 0; i < state.wizardProviders.length; i++) {
      if (state.wizardProviders[i] === providerKey) {
        state.wizardInlineArgs[i] = value;
      }
    }
  }

  function getArgsSummary(value = "", providerKey = "") {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      return providerKey === "terminal" ? "Nessun comando aggiuntivo" : "Nessun argomento";
    }

    if (text.length <= 56) return text;
    return `${text.slice(0, 56)}...`;
  }

  function closeWizardEditor() {
    activeWizardEditorIndex = null;
    dom.wizardEditorPanel?.classList.add("hidden");
    dom.wizardEditorBackdrop?.classList.add("hidden");
    dom.wizardEditorPanel?.setAttribute("aria-hidden", "true");
    if (dom.wizardEditorPanel) {
      delete dom.wizardEditorPanel.dataset.provider;
    }
    if (dom.wizardEditorBody) {
      dom.wizardEditorBody.innerHTML = "";
    }
  }

  function openWizardEditor(clientIndex) {
    activeWizardEditorIndex = clientIndex;
    renderClientGrid();
  }

  function ensureWizardEditorEventsBound() {
    if (dom.wizardEditorCloseBtn && !dom.wizardEditorCloseBtn.dataset.bound) {
      dom.wizardEditorCloseBtn.dataset.bound = "true";
      dom.wizardEditorCloseBtn.addEventListener("click", () => closeWizardEditor());
    }

    if (dom.wizardEditorBackdrop && !dom.wizardEditorBackdrop.dataset.bound) {
      dom.wizardEditorBackdrop.dataset.bound = "true";
      dom.wizardEditorBackdrop.addEventListener("click", () => closeWizardEditor());
    }
  }

  function renderWizardEditor() {
    ensureWizardEditorEventsBound();

    if (
      activeWizardEditorIndex === null ||
      activeWizardEditorIndex < 0 ||
      activeWizardEditorIndex >= state.wizardClientCount ||
      !dom.wizardEditorPanel ||
      !dom.wizardEditorBackdrop ||
      !dom.wizardEditorBody
    ) {
      closeWizardEditor();
      return;
    }

    const clientIndex = activeWizardEditorIndex;
    const selectedKey = state.wizardProviders[clientIndex];
    const selectedProvider = providerCatalog[selectedKey] || {};
    const selectedMeta = getProviderMeta(selectedKey, selectedProvider);
    const isSelectedUnavailable = selectedProvider.available === false;

    if (dom.wizardEditorEyebrow) {
      dom.wizardEditorEyebrow.textContent = `Client ${clientIndex + 1}`;
    }
    if (dom.wizardEditorTitle) {
      dom.wizardEditorTitle.textContent = selectedMeta.shortLabel;
    }
    dom.wizardEditorPanel.dataset.provider = selectedKey;

    dom.wizardEditorBody.innerHTML = "";

    const badgeRow = document.createElement("div");
    badgeRow.className = "wizard-editor-badges";
    badgeRow.innerHTML = `
      <span class="wizard-provider-badge ${PROVIDER_STYLE[selectedKey]?.badge || "bg-zinc-800 text-zinc-300"}">
        <i class="bi ${selectedMeta.icon}"></i>
        <span>${selectedMeta.shortLabel}</span>
      </span>
    `;

    const fieldWrap = document.createElement("div");
    fieldWrap.className = "wizard-editor-section";
    fieldWrap.innerHTML = `
      <div class="wizard-editor-label-row">
        <span class="wizard-field-label">${selectedKey === "terminal" ? "Comando / argomenti" : "Argomenti"}</span>
        <span class="wizard-editor-hint">Opzionale</span>
      </div>
    `;

    const inlineInput = document.createElement("input");
    inlineInput.type = "text";
    inlineInput.className = "wizard-input wizard-input-mono";
    inlineInput.placeholder = selectedMeta.inlinePlaceholder;
    inlineInput.value = state.wizardInlineArgs[clientIndex] || "";
    inlineInput.addEventListener("input", () => {
      state.wizardInlineArgs[clientIndex] = inlineInput.value;
      renderClientGrid();
    });
    fieldWrap.append(inlineInput);

    const composerWrap = document.createElement("div");
    composerWrap.className = "wizard-editor-section";
    composerWrap.innerHTML = `
      <div class="wizard-editor-label-row">
        <span class="wizard-field-label">Preset parametri</span>
      </div>
    `;

    if (isSelectedUnavailable) {
      const unavailableHint = document.createElement("div");
      unavailableHint.className = "wizard-warning-box";
      unavailableHint.innerHTML = `
        <i class="bi bi-exclamation-triangle"></i>
        <p>${selectedProvider.availabilityMessage || "Provider CLI non rilevato su questo sistema."}</p>
      `;
      composerWrap.append(unavailableHint);
    }

    const composer = buildInlineComposer(selectedKey, clientIndex, inlineInput, () => {
      state.wizardInlineArgs[clientIndex] = inlineInput.value;
      renderClientGrid();
    });

    if (composer) {
      composerWrap.append(composer);
    } else {
      const empty = document.createElement("div");
      empty.className = "wizard-inline-empty";
      empty.textContent = "Nessun preset disponibile";
      composerWrap.append(empty);
    }

    dom.wizardEditorBody.append(badgeRow, fieldWrap, composerWrap);
    dom.wizardEditorBackdrop.classList.remove("hidden");
    dom.wizardEditorPanel.classList.remove("hidden");
    dom.wizardEditorPanel.setAttribute("aria-hidden", "false");
  }

  return {
    applyBulkInlineArgsForProvider,
    closeWizardEditor,
    getActiveWizardEditorIndex: () => activeWizardEditorIndex,
    getArgsSummary,
    normalizeBulkInlineArgs,
    openWizardEditor,
    renderWizardEditor
  };
}
