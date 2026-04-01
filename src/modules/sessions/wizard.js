import { state, providerCatalog, PROVIDER_STYLE } from "../state.js";
import { dom } from "../dom.js";
import { normalizeInlineArgs } from "../cli-options.js";
import { showNotice } from "../notices.js";
import { getFirstAvailableProvider, refreshProviderCatalog } from "../providers.js";
import { showHomePage } from "../home-pages.js";
import {
  getFirstLauncherProvider,
  getLauncherProviderEntries,
  getProviderMeta
} from "./wizard-meta.js";
import { buildCountOptions as buildStep1CountOptions } from "./wizard-step1.js";
import { createWizardEditorController } from "./wizard-editor.js";

export function showStep(step) {
  state.wizardStep = step;
  showHomePage("home", { scroll: false });
  dom.step1El.classList.toggle("hidden", step !== 1);
  dom.step2El.classList.toggle("hidden", step !== 2);
  if (step !== 2) {
    wizardEditor.closeWizardEditor();
  }
}

const wizardEditor = createWizardEditorController({
  dom,
  state,
  providerCatalog,
  getProviderMeta,
  getProviderActionClass: (providerKey) =>
    ({
      claude: "text-amber-300 border-amber-500/30 bg-amber-500/12 hover:bg-amber-500/20 hover:border-amber-400/50",
      codex: "text-sky-300 border-sky-500/30 bg-sky-500/12 hover:bg-sky-500/20 hover:border-sky-400/50",
      copilot: "text-sky-200 border-sky-400/30 bg-sky-400/12 hover:bg-sky-400/20 hover:border-sky-300/50",
      gemini: "text-violet-300 border-violet-500/30 bg-violet-500/12 hover:bg-violet-500/20 hover:border-violet-400/50",
      terminal: "text-emerald-300 border-emerald-500/30 bg-emerald-500/12 hover:bg-emerald-500/20 hover:border-emerald-400/50"
    }[providerKey] ||
    "text-emerald-300 border-emerald-500/30 bg-emerald-500/12 hover:bg-emerald-500/20 hover:border-emerald-400/50"),
  renderClientGrid
});

export function buildCountOptions() {
  return buildStep1CountOptions({
    dom,
    state,
    providerCatalog,
    refreshProviderCatalog,
    showNotice,
    getFirstLauncherProvider: () => getFirstLauncherProvider(getFirstAvailableProvider),
    buildStep2,
    showStep
  });
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

  wizardEditor.normalizeBulkInlineArgs(providerEntries);
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
      wizardEditor.applyBulkInlineArgsForProvider(providerKey);
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
  const providerEntries = getLauncherProviderEntries();
  wizardEditor.normalizeBulkInlineArgs(providerEntries);

  renderQuickSelect(providerEntries);
  renderBulkFlagsPanel(providerEntries);
  renderClientGrid();
}

function buildSelectionOption(selectedKey, clientIndex, providerKey, provider) {
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
  const providerEntries = getLauncherProviderEntries();
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
    <div class="wizard-client-col wizard-client-col-provider">CLI / Terminale</div>
    <div class="wizard-client-col wizard-client-col-config">Configurazione</div>
  `;
  dom.clientGrid.append(header);

  for (let i = 0; i < state.wizardClientCount; i++) {
    const selectedKey = providerEntries.some(([providerKey]) => providerKey === state.wizardProviders[i])
      ? state.wizardProviders[i]
      : getFirstLauncherProvider(getFirstAvailableProvider);

    const selectedProvider = providerCatalog[selectedKey] || {};
    const row = document.createElement("article");
    row.className = "wizard-client-row";

    const selector = document.createElement("div");
    selector.className = "wizard-provider-pill-group";
    for (const [providerKey, provider] of providerEntries) {
      selector.append(buildSelectionOption(selectedKey, i, providerKey, provider));
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
    configButton.className = `wizard-config-trigger ${wizardEditor.getActiveWizardEditorIndex() === i ? "is-active" : ""}`;
    configButton.innerHTML = `
      <span class="wizard-config-trigger-copy">
        <span class="wizard-config-trigger-title">Configura</span>
        <span class="wizard-config-trigger-summary">${wizardEditor.getArgsSummary(state.wizardInlineArgs[i], selectedKey)}</span>
      </span>
      <span class="wizard-config-trigger-icon">
        <i class="bi bi-sliders2"></i>
      </span>
    `;
    configButton.addEventListener("click", () => wizardEditor.openWizardEditor(i));
    configCell.append(configButton);

    row.append(idCell, providerCell, configCell);
    dom.clientGrid.append(row);
  }

  wizardEditor.renderWizardEditor();
}
