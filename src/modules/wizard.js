import { state, providerCatalog, PROVIDER_STYLE } from "./state.js";
import { dom } from "./dom.js";
import {
  appendInlineArg,
  getInlineOptionsSchema,
  normalizeInlineArgs,
} from "./cli-options.js";

export function showStep(step) {
  state.wizardStep = step;
  dom.homeOverview.classList.toggle("hidden", step !== 1);
  dom.step1El.classList.toggle("hidden", step !== 1);
  dom.step2El.classList.toggle("hidden", step !== 2);
}

// Dot grid layouts for each count
const DOT_GRIDS = {
  1:  { cols: 1, rows: 1 },
  2:  { cols: 2, rows: 1 },
  4:  { cols: 2, rows: 2 },
  8:  { cols: 4, rows: 2 },
  16: { cols: 4, rows: 4 },
  32: { cols: 8, rows: 4 },
};

const PROVIDER_ACTION_STYLE = {
  claude: "text-amber-400 border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20",
  codex: "text-blue-400 border-blue-500/35 bg-blue-500/10 hover:bg-blue-500/20",
  gemini: "text-violet-400 border-violet-500/35 bg-violet-500/10 hover:bg-violet-500/20",
  terminal: "text-emerald-400 border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20",
};

function getProviderActionClass(providerKey) {
  return (
    PROVIDER_ACTION_STYLE[providerKey] ||
    "text-emerald-400 border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20"
  );
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

    card.addEventListener("click", () => {
      state.wizardClientCount = count;
      const defaultProvider = Object.keys(providerCatalog)[0] || "claude";
      state.wizardProviders = new Array(count).fill(defaultProvider);
      state.wizardInlineArgs = new Array(count).fill("");
      state.wizardBulkInlineArgs = {};
      buildStep2();
      showStep(2);
    });
    dom.countOptions.append(option);
  }
}

function buildInlineComposer(providerKey, clientIndex, inlineInput) {
  const schema = getInlineOptionsSchema(providerKey);
  if (schema.length === 0) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "w-full flex flex-col gap-1";

  const hint = document.createElement("p");
  hint.className = "text-[9px] text-zinc-600";
  hint.textContent = `Preset parametri: ${providerCatalog[providerKey]?.label || providerKey}`;

  const row = document.createElement("div");
  row.className = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1 w-full";

  const paramSelect = document.createElement("select");
  paramSelect.className =
    "w-full min-w-0 bg-th-bg border border-th-border-lt rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Parametro";
  paramSelect.append(defaultOption);

  for (const option of schema) {
    const opt = document.createElement("option");
    opt.value = option.key;
    opt.textContent = option.key;
    paramSelect.append(opt);
  }

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className =
    "w-full min-w-0 bg-th-bg border border-th-border-lt rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none";
  valueInput.placeholder = "Valore (opzionale)";

  const valuesDatalist = document.createElement("datalist");
  valuesDatalist.id = `param-values-${providerKey}-${clientIndex}`;
  valueInput.setAttribute("list", valuesDatalist.id);

  const addBtn = document.createElement("button");
  addBtn.className =
    `px-2 py-1 rounded-md text-[10px] font-semibold border cursor-pointer transition-all duration-150 ${getProviderActionClass(providerKey)}`;
  addBtn.textContent = "Aggiungi";

  function refreshValueSuggestions() {
    valuesDatalist.innerHTML = "";
    const selected = schema.find((entry) => entry.key === paramSelect.value);
    if (!selected) {
      valueInput.placeholder = "Valore (opzionale)";
      return;
    }

    if (selected.valueHint === "flag") {
      valueInput.placeholder = "Flag senza valore";
      return;
    }

    if (selected.valueHint === "integer") {
      valueInput.placeholder = "Numero intero";
    } else {
      valueInput.placeholder = "Valore";
    }

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
  });

  refreshValueSuggestions();
  row.append(paramSelect, valueInput, addBtn);
  wrapper.append(hint, row, valuesDatalist);
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

function renderBulkFlagsPanel(providerEntries) {
  if (!dom.bulkFlags) return;

  normalizeBulkInlineArgs(providerEntries);
  dom.bulkFlags.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "bg-th-card border border-th-border-lt rounded-xl p-3";

  const head = document.createElement("div");
  head.className = "mb-2";

  const title = document.createElement("p");
  title.className = "text-xs font-semibold uppercase tracking-wider text-zinc-500";
  title.textContent = "Flag globali per tipo";

  const subtitle = document.createElement("p");
  subtitle.className = "text-[10px] text-zinc-600 mt-1";
  subtitle.textContent = "Applica in blocco argomenti/comandi a tutti i client dello stesso provider.";

  head.append(title, subtitle);

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-2 gap-2";

  for (const [providerKey, provider] of providerEntries) {
    const row = document.createElement("div");
    row.className =
      "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-th-bg border border-th-border-lt rounded-lg px-2 py-1.5 min-w-0";

    const label = document.createElement("span");
    label.className = `inline-flex items-center justify-center w-24 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${PROVIDER_STYLE[providerKey]?.badge || "text-zinc-400 bg-zinc-800"}`;
    label.textContent = provider.label.replace(" CLI", "");

    const input = document.createElement("input");
    input.type = "text";
    input.className =
      "w-full min-w-0 bg-th-card border border-th-border-lt rounded-md px-2 py-1 text-[10px] font-mono text-zinc-300 outline-none";
    input.placeholder =
      providerKey === "terminal"
        ? "Comando per tutti i terminali normali"
        : "Flag per tutti i terminali di questo tipo";
    input.value = state.wizardBulkInlineArgs[providerKey] || "";

    const applyBtn = document.createElement("button");
    applyBtn.className =
      `px-2 py-1 rounded-md text-[10px] font-semibold border cursor-pointer transition-all duration-150 ${getProviderActionClass(providerKey)}`;
    applyBtn.textContent = "Applica";

    const apply = () => {
      state.wizardBulkInlineArgs[providerKey] = input.value;
      applyBulkInlineArgsForProvider(providerKey);
      renderClientGrid();
    };

    input.addEventListener("input", () => {
      state.wizardBulkInlineArgs[providerKey] = input.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });
    applyBtn.addEventListener("click", apply);

    row.append(label, input, applyBtn);
    grid.append(row);
  }

  panel.append(head, grid);
  dom.bulkFlags.append(panel);
}

export function buildStep2() {
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  const providerEntries = Object.entries(providerCatalog);
  normalizeBulkInlineArgs(providerEntries);

  dom.quickSelect.innerHTML = "";
  for (const [key, prov] of providerEntries) {
    const btn = document.createElement("button");
    btn.className = `py-[7px] px-[18px] rounded-full text-xs font-semibold border border-th-border-lt bg-th-card cursor-pointer transition-all duration-150 hover:-translate-y-px ${PROVIDER_STYLE[key]?.quick || ""}`;
    const shortName = prov.label.replace(" CLI", "");
    btn.innerHTML = `<i class="bi bi-check2-all"></i> Tutti: ${shortName}`;
    btn.addEventListener("click", () => {
      state.wizardProviders.fill(key);
      state.wizardInlineArgs.fill(state.wizardBulkInlineArgs[key] || "");
      renderClientGrid();
    });
    dom.quickSelect.append(btn);
  }

  renderBulkFlagsPanel(providerEntries);
  renderClientGrid();
}

export function renderClientGrid() {
  state.wizardInlineArgs = normalizeInlineArgs(state.wizardInlineArgs, state.wizardClientCount);
  const providerEntries = Object.entries(providerCatalog);
  const providerCount = providerEntries.length;
  const optionCols = providerCount >= 3 ? 2 : Math.max(providerCount, 1);

  const cols =
    state.wizardClientCount === 1
      ? 1
      : state.wizardClientCount <= 4
        ? 2
        : state.wizardClientCount <= 8
          ? 4
          : 4;
  dom.clientGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  dom.clientGrid.innerHTML = "";

  for (let i = 0; i < state.wizardClientCount; i++) {
    const selectedKey = state.wizardProviders[i];

    const card = document.createElement("div");
    card.className = `flex flex-col items-center px-2.5 py-3 bg-th-card border rounded-xl gap-2 min-w-0 transition-[border-color,box-shadow] duration-200 ${PROVIDER_STYLE[selectedKey]?.card || "border-th-border"}`;

    const label = document.createElement("span");
    label.className = "text-[11px] font-bold text-zinc-600 tracking-wide";
    label.textContent = `#${i + 1}`;

    const options = document.createElement("div");
    options.className = "grid gap-1 w-full";
    options.style.gridTemplateColumns = `repeat(${optionCols}, minmax(0, 1fr))`;

    for (const [key, prov] of providerEntries) {
      const toggle = document.createElement("button");
      const isSelected = selectedKey === key;
      const shortName = prov.label.replace(" CLI", "");
      toggle.className = `w-full min-w-0 truncate px-2.5 py-[5px] rounded-md text-[11px] font-semibold border cursor-pointer transition-all duration-150 ${
        isSelected
          ? PROVIDER_STYLE[key]?.toggle || ""
          : "border-transparent bg-th-bg text-zinc-600 hover:text-zinc-400 hover:bg-th-hover"
      }`;
      toggle.textContent = shortName;
      toggle.addEventListener("click", () => {
        state.wizardProviders[i] = key;
        state.wizardInlineArgs[i] = state.wizardBulkInlineArgs[key] || "";
        renderClientGrid();
      });
      options.append(toggle);
    }

    const inlineWrap = document.createElement("div");
    inlineWrap.className = "w-full flex flex-col gap-1";

    const inlineLabel = document.createElement("span");
    inlineLabel.className = "text-[9px] font-semibold text-zinc-600 uppercase tracking-wide";
    inlineLabel.textContent = selectedKey === "terminal" ? "Comando Inline" : "Argomenti Inline";

    const inlineInput = document.createElement("input");
    inlineInput.type = "text";
    inlineInput.className =
      "w-full min-w-0 bg-th-bg border border-th-border-lt rounded-md px-2 py-1 text-[10px] font-mono text-zinc-300 outline-none";
    inlineInput.placeholder =
      selectedKey === "terminal"
        ? "es: npm run dev"
        : "es: --model gpt-5-codex --approval_policy on-request";
    inlineInput.value = state.wizardInlineArgs[i] || "";
    inlineInput.addEventListener("input", () => {
      state.wizardInlineArgs[i] = inlineInput.value;
    });

    inlineWrap.append(inlineLabel, inlineInput);

    const composer = buildInlineComposer(selectedKey, i, inlineInput);
    if (composer) inlineWrap.append(composer);

    card.append(label, options, inlineWrap);
    dom.clientGrid.append(card);
  }
}
