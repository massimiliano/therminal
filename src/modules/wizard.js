import { state, providerCatalog, PROVIDER_STYLE } from "./state.js";
import { dom } from "./dom.js";
import {
  appendInlineArg,
  getInlineOptionsSchema,
  normalizeInlineArgs,
} from "./cli-options.js";
import { showNotice } from "./notices.js";
import { getFirstAvailableProvider, refreshProviderCatalog } from "./providers.js";

export function showStep(step) {
  state.wizardStep = step;
  dom.homeOverview.classList.toggle("hidden", step !== 1);
  dom.step1El.classList.toggle("hidden", step !== 1);
  dom.step2El.classList.toggle("hidden", step !== 2);
  if (step !== 2) {
    closeWizardEditor();
  }
}

const DOT_GRIDS = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  8: { cols: 4, rows: 2 },
  16: { cols: 4, rows: 4 },
  32: { cols: 8, rows: 4 },
};

const PROVIDER_ACTION_STYLE = {
  claude: "text-amber-300 border-amber-500/30 bg-amber-500/12 hover:bg-amber-500/20 hover:border-amber-400/50",
  codex: "text-sky-300 border-sky-500/30 bg-sky-500/12 hover:bg-sky-500/20 hover:border-sky-400/50",
  gemini: "text-violet-300 border-violet-500/30 bg-violet-500/12 hover:bg-violet-500/20 hover:border-violet-400/50",
  terminal: "text-emerald-300 border-emerald-500/30 bg-emerald-500/12 hover:bg-emerald-500/20 hover:border-emerald-400/50",
  lazygit: "text-lime-300 border-lime-500/30 bg-lime-500/12 hover:bg-lime-500/20 hover:border-lime-400/50",
};

const PROVIDER_META = {
  claude: {
    icon: "bi-stars",
    description: "Assistente Anthropic per sessioni di coding con controllo su modello ed effort.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Claude",
    inlinePlaceholder: "es: --model claude-sonnet-4-6 --effort high",
  },
  codex: {
    icon: "bi-braces-asterisk",
    description: "CLI OpenAI orientata a coding, automazioni e task multi-file.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Codex",
    inlinePlaceholder: "es: --model gpt-5.4 --approval-policy on-request",
  },
  gemini: {
    icon: "bi-magic",
    description: "CLI Gemini per task generali, revisione e supporto al coding.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Gemini",
    inlinePlaceholder: "es: --model gemini-2.5-pro",
  },
  terminal: {
    icon: "bi-terminal",
    description: "Terminale classico, utile per comandi liberi, script e processi locali.",
    kindLabel: "Shell",
    bulkPlaceholder: "Comando per tutti i terminali",
    inlinePlaceholder: "es: npm run dev",
  },
  lazygit: {
    icon: "bi-git",
    description: "Interfaccia Git interattiva nel terminale, utile per status, commit, branch e staging rapido.",
    kindLabel: "Git TUI",
    bulkPlaceholder: "Argomenti per tutti i LazyGit",
    inlinePlaceholder: "es: --path .",
  },
  browser: {
    icon: "bi-globe2",
    description: "Sessione browser con URL iniziale personalizzabile.",
    kindLabel: "Browser",
    bulkPlaceholder: "URL per tutti i browser",
    inlinePlaceholder: "es: https://example.com",
  },
};

let activeWizardEditorIndex = null;

function getProviderActionClass(providerKey) {
  return (
    PROVIDER_ACTION_STYLE[providerKey] ||
    "text-emerald-300 border-emerald-500/30 bg-emerald-500/12 hover:bg-emerald-500/20 hover:border-emerald-400/50"
  );
}

function getProviderMeta(providerKey, provider = {}) {
  const fallbackLabel = providerKey ? providerKey.charAt(0).toUpperCase() + providerKey.slice(1) : "Provider";
  const label = typeof provider.label === "string" && provider.label.trim() ? provider.label : fallbackLabel;
  const shortLabel = label.replace(" CLI", "");
  return {
    icon: "bi-cpu",
    description: "Provider configurabile per i client selezionati.",
    kindLabel: provider?.kind === "shell" ? "Shell" : "CLI",
    bulkPlaceholder: `Argomenti per tutti i client ${shortLabel}`,
    inlinePlaceholder: "es: --flag valore",
    label,
    shortLabel,
    ...PROVIDER_META[providerKey],
  };
}

function buildDotGrid(count) {
  const { cols } = DOT_GRIDS[count] || { cols: Math.ceil(Math.sqrt(count)) };
  const grid = document.createElement("div");
  grid.className = "grid gap-[3px]";
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  const dotSize = count <= 4 ? "w-2 h-2" : count <= 16 ? "w-1.5 h-1.5" : "w-1 h-1";

  for (let i = 0; i < count; i++) {
    const dot = document.createElement("span");
    dot.className = `${dotSize} rounded-full bg-emerald-400/50`;
    grid.append(dot);
  }
  return grid;
}

export function buildCountOptions() {
  const counts = [1, 2, 4, 8, 16, 32];
  dom.countOptions.innerHTML = "";

  for (const count of counts) {
    const option = document.createElement("div");
    option.className = "w-[112px] flex flex-col items-center gap-1.5";

    const card = document.createElement("button");
    card.className =
      "group w-full aspect-square flex flex-col items-center justify-center bg-th-card border border-th-border-lt rounded-2xl cursor-pointer transition-all duration-200 gap-2.5 px-4 py-4 hover:border-emerald-400 hover:bg-emerald-400/[0.03] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(52,211,153,0.06)]";

    const dotGrid = buildDotGrid(count);
    dotGrid.classList.add("opacity-40", "group-hover:opacity-80", "transition-opacity", "duration-200");

    const bottom = document.createElement("div");
    bottom.className = "flex items-center justify-center";

    const number = document.createElement("span");
    number.className = "text-xl font-bold text-white";
    number.textContent = count;

    const label = document.createElement("span");
    label.className = "text-[10px] text-zinc-500 uppercase tracking-wide";
    label.textContent = "client";

    bottom.append(number);
    card.append(dotGrid, bottom);
    option.append(card, label);

    card.addEventListener("click", async () => {
      try {
        if (Object.keys(providerCatalog).length === 0) {
          await refreshProviderCatalog();
        }

        state.wizardClientCount = count;
        const defaultProvider = getFirstAvailableProvider();
        state.wizardProviders = new Array(count).fill(defaultProvider);
        state.wizardInlineArgs = new Array(count).fill("");
        state.wizardBulkInlineArgs = {};
        buildStep2();
        showStep(2);

        void refreshProviderCatalog()
          .then(() => {
            if (state.wizardStep === 2 && state.wizardClientCount === count) {
              buildStep2();
            }
          })
          .catch((error) => {
            console.error("Provider refresh after step switch failed:", error);
          });
      } catch (error) {
        console.error("Provider preload failed:", error);
        showNotice("Impossibile rilevare i provider CLI disponibili.", { type: "error" });
      }
    });
    dom.countOptions.append(option);
  }
}

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

function renderQuickSelect(providerEntries) {
  dom.quickSelect.innerHTML = "";

  for (const [key, provider] of providerEntries) {
    const meta = getProviderMeta(key, provider);
    const isUnavailable = provider?.available === false;
    const button = document.createElement("button");
    button.type = "button";
    button.className = isUnavailable
      ? "wizard-provider-shortcut opacity-55 cursor-not-allowed"
      : "wizard-provider-shortcut";
    button.dataset.provider = key;
    button.disabled = isUnavailable;
    button.title = isUnavailable
      ? `${meta.shortLabel} non disponibile`
      : `Assegna ${meta.shortLabel} a tutti i client`;

    button.innerHTML = `
      <div class="wizard-provider-shortcut-top">
        <i class="bi ${meta.icon} wizard-provider-shortcut-icon"></i>
      </div>
      <div class="wizard-provider-shortcut-body">
        <p class="wizard-provider-shortcut-name">${meta.shortLabel}</p>
        <p class="wizard-provider-shortcut-action">${isUnavailable ? "Non disponibile" : "Clicca per usare su tutti i client"}</p>
      </div>
      <div class="wizard-provider-shortcut-meta">
        <span><i class="bi bi-people"></i>${state.wizardClientCount} client</span>
      </div>
    `;

    button.addEventListener("click", () => {
      state.wizardProviders.fill(key);
      state.wizardInlineArgs.fill(state.wizardBulkInlineArgs[key] || "");
      renderClientGrid();
    });

    dom.quickSelect.append(button);
  }
}

function renderBulkFlagsPanel(providerEntries) {
  if (!dom.bulkFlags) return;

  normalizeBulkInlineArgs(providerEntries);
  dom.bulkFlags.innerHTML = "";

  const panel = document.createElement("details");
  panel.className = "wizard-panel wizard-panel-min th-accordion wizard-accordion";

  const head = document.createElement("summary");
  head.className = "wizard-panel-head wizard-panel-head-min wizard-accordion-summary";
  head.innerHTML = `
    <div>
      <p class="wizard-eyebrow">Regole per provider</p>
      <h3 class="wizard-panel-title">Argomenti globali</h3>
    </div>
    <i class="bi bi-chevron-down th-accordion-chevron wizard-accordion-chevron"></i>
  `;

  const grid = document.createElement("div");
  grid.className = "wizard-bulk-grid";

  for (const [providerKey, provider] of providerEntries) {
    const meta = getProviderMeta(providerKey, provider);
    const isUnavailable = provider?.available === false;

    const card = document.createElement("div");
    card.className = "wizard-bulk-card wizard-bulk-card-min";
    if (!isUnavailable) {
      card.classList.add("wizard-bulk-card-clickable");
      card.title = `Applica questi argomenti a tutti i client ${meta.shortLabel}`;
    }

    const top = document.createElement("div");
    top.className = "wizard-bulk-top";
    top.innerHTML = `
      <div class="min-w-0 flex items-center gap-2">
        <span class="wizard-provider-badge ${PROVIDER_STYLE[providerKey]?.badge || "bg-zinc-800 text-zinc-300"}">
          <i class="bi ${meta.icon}"></i>
          <span>${meta.shortLabel}</span>
        </span>
      </div>
    `;

    const field = document.createElement("div");
    field.className = "wizard-bulk-field";

    const inputRow = document.createElement("div");
    inputRow.className = "wizard-bulk-input-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "wizard-input wizard-input-mono";
    input.placeholder = isUnavailable ? "Provider non disponibile" : meta.bulkPlaceholder;
    input.value = state.wizardBulkInlineArgs[providerKey] || "";
    input.disabled = isUnavailable;

    const apply = () => {
      state.wizardBulkInlineArgs[providerKey] = input.value;
      applyBulkInlineArgsForProvider(providerKey);
      renderClientGrid();
    };

    input.addEventListener("input", () => {
      state.wizardBulkInlineArgs[providerKey] = input.value;
    });
    input.addEventListener("click", (event) => event.stopPropagation());

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    });
    inputRow.addEventListener("click", (event) => event.stopPropagation());

    const helper = document.createElement("p");
    helper.className = "wizard-bulk-apply-note";
    helper.textContent = isUnavailable ? "Provider non disponibile" : `Click sulla card per applicare a tutti i ${meta.shortLabel}`;

    if (!isUnavailable) {
      card.addEventListener("click", apply);
    }

    inputRow.append(input);
    field.append(inputRow);
    card.append(top, field, helper);
    grid.append(card);
  }

  panel.append(head, grid);
  dom.bulkFlags.append(panel);
}

export function buildStep2() {
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  const providerEntries = Object.entries(providerCatalog);
  normalizeBulkInlineArgs(providerEntries);

  renderQuickSelect(providerEntries);
  renderBulkFlagsPanel(providerEntries);
  renderClientGrid();
}

function buildSelectionOption(providerEntries, selectedKey, clientIndex, providerKey, provider) {
  const meta = getProviderMeta(providerKey, provider);
  const isSelected = selectedKey === providerKey;
  const isUnavailable = provider?.available === false;
  const button = document.createElement("button");
  button.type = "button";

  button.className = isUnavailable
    ? "wizard-provider-pill opacity-55 cursor-not-allowed"
    : `wizard-provider-pill ${isSelected ? "is-selected" : ""}`;
  button.disabled = isUnavailable;
  button.setAttribute("aria-pressed", isSelected ? "true" : "false");

  button.innerHTML = `
    <span class="wizard-provider-badge ${PROVIDER_STYLE[providerKey]?.badge || "bg-zinc-800 text-zinc-300"}">
      <i class="bi ${meta.icon}"></i>
      <span>${meta.shortLabel}</span>
    </span>
    <span class="wizard-provider-check ${isSelected ? "is-active" : ""}">
      <i class="bi ${isSelected ? "bi-check-lg" : "bi-plus"}"></i>
    </span>
  `;

  button.addEventListener("click", () => {
    state.wizardProviders[clientIndex] = providerKey;
    state.wizardInlineArgs[clientIndex] = state.wizardBulkInlineArgs[providerKey] || "";
    renderClientGrid();
  });

  return button;
}

export function renderClientGrid() {
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  const providerEntries = Object.entries(providerCatalog);
  dom.clientGrid.innerHTML = "";
  dom.clientGrid.style.gridTemplateColumns = "1fr";
  dom.clientGrid.dataset.density = state.wizardClientCount >= 16 ? "dense" : "compact";

  if (!providerEntries.length) {
    const empty = document.createElement("div");
    empty.className = "wizard-empty-state";
    empty.innerHTML = `
      <i class="bi bi-exclamation-diamond"></i>
      <div>
        <p class="wizard-panel-title">Provider non disponibili</p>
        <p class="wizard-panel-copy">Impossibile costruire la schermata finche il catalogo provider non viene caricato.</p>
      </div>
    `;
    dom.clientGrid.append(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "wizard-client-row wizard-client-row-head";
  header.innerHTML = `
    <div class="wizard-client-col wizard-client-col-id">#</div>
    <div class="wizard-client-col wizard-client-col-provider">Provider</div>
    <div class="wizard-client-col wizard-client-col-config">Configurazione</div>
  `;
  dom.clientGrid.append(header);

  for (let i = 0; i < state.wizardClientCount; i++) {
    const selectedKey = state.wizardProviders[i];
    const selectedProvider = providerCatalog[selectedKey] || {};
    const selectedMeta = getProviderMeta(selectedKey, selectedProvider);

    const row = document.createElement("article");
    row.className = "wizard-client-row";

    const selector = document.createElement("div");
    selector.className = "wizard-provider-pill-group";
    for (const [providerKey, provider] of providerEntries) {
      selector.append(buildSelectionOption(providerEntries, selectedKey, i, providerKey, provider));
    }

    const idCell = document.createElement("div");
    idCell.className = "wizard-client-col wizard-client-col-id";
    idCell.innerHTML = `<span class="wizard-client-index">#${i + 1}</span>`;

    const providerCell = document.createElement("div");
    providerCell.className = "wizard-client-col wizard-client-col-provider";
    providerCell.append(selector);

    const configCell = document.createElement("div");
    configCell.className = "wizard-client-col wizard-client-col-config";

    const configButton = document.createElement("button");
    configButton.type = "button";
    configButton.className = `wizard-config-trigger ${activeWizardEditorIndex === i ? "is-active" : ""}`;
    configButton.innerHTML = `
      <span class="wizard-config-trigger-copy">
        <span class="wizard-config-trigger-title">Configura</span>
        <span class="wizard-config-trigger-summary">${getArgsSummary(state.wizardInlineArgs[i], selectedKey)}</span>
      </span>
      <span class="wizard-config-trigger-icon">
        <i class="bi bi-sliders2"></i>
      </span>
    `;
    configButton.addEventListener("click", () => openWizardEditor(i));
    configCell.append(configButton);

    row.append(idCell, providerCell, configCell);
    dom.clientGrid.append(row);
  }

  renderWizardEditor();
}
