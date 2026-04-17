import { buildDotGrid } from "./wizard-meta.js";

async function launchWizardWithCount({
  count,
  state,
  providerCatalog,
  refreshProviderCatalog,
  showNotice,
  getFirstLauncherProvider,
  buildStep2,
  showStep
}) {
  try {
    if (!Number.isInteger(count) || count <= 0) {
      showNotice("Inserisci un numero di client maggiore di zero.", { type: "warning" });
      return;
    }

    if (Object.keys(providerCatalog).length === 0) {
      await refreshProviderCatalog();
    }

    state.wizardClientCount = count;
    const defaultProvider = getFirstLauncherProvider();
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
}

function getCustomCountValue(input, showNotice) {
  const parsedValue = Number.parseInt(input?.value?.trim() || "", 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    showNotice("Inserisci un numero intero maggiore di zero.", { type: "warning" });
    input?.focus();
    input?.select();
    return null;
  }

  return parsedValue;
}

export function buildCountOptions({
  dom,
  state,
  providerCatalog,
  refreshProviderCatalog,
  showNotice,
  getFirstLauncherProvider,
  buildStep2,
  showStep
}) {
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
      await launchWizardWithCount({
        count,
        state,
        providerCatalog,
        refreshProviderCatalog,
        showNotice,
        getFirstLauncherProvider,
        buildStep2,
        showStep
      });
    });
    dom.countOptions.append(option);
  }

  const customOption = document.createElement("div");
  customOption.className = "w-[144px] flex flex-col items-center gap-1.5";

  const customCard = document.createElement("div");
  customCard.className =
    "w-full min-h-[112px] flex flex-col items-center justify-center bg-th-card border border-dashed border-th-border-lt rounded-2xl transition-all duration-200 gap-3 px-3 py-3 hover:border-emerald-400 hover:bg-emerald-400/[0.03] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(52,211,153,0.06)]";
  customCard.setAttribute("aria-label", "Client personalizzati");
  customCard.innerHTML = `
    <div class="text-center">
      <div class="text-[22px] font-bold leading-none text-white">Custom</div>
    </div>
  `;

  const controls = document.createElement("div");
  controls.className = "w-full flex items-center gap-2";

  const customInput = document.createElement("input");
  customInput.type = "number";
  customInput.min = "1";
  customInput.step = "1";
  customInput.inputMode = "numeric";
  customInput.value = state.wizardClientCount > 0 ? String(state.wizardClientCount) : "5";
  customInput.placeholder = "5";
  customInput.className =
    "w-full min-w-0 rounded-xl border border-zinc-800/80 bg-th-body px-3 py-2 text-sm font-semibold text-center text-white outline-none transition-colors focus:border-emerald-400/45";

  const customLaunchBtn = document.createElement("button");
  customLaunchBtn.type = "button";
  customLaunchBtn.className =
    "shrink-0 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:border-emerald-400 hover:bg-emerald-500/15 hover:text-white";
  customLaunchBtn.textContent = "Avvia";

  const handleCustomLaunch = async () => {
    const count = getCustomCountValue(customInput, showNotice);
    if (count === null) {
      return;
    }

    await launchWizardWithCount({
      count,
      state,
      providerCatalog,
      refreshProviderCatalog,
      showNotice,
      getFirstLauncherProvider,
      buildStep2,
      showStep
    });
  };

  customInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    await handleCustomLaunch();
  });
  customLaunchBtn.addEventListener("click", () => {
    void handleCustomLaunch();
  });

  controls.append(customInput, customLaunchBtn);
  customCard.append(controls);

  const customLabel = document.createElement("span");
  customLabel.className = "text-[10px] text-zinc-500 uppercase tracking-wide";
  customLabel.textContent = "∞ client";

  customOption.append(customCard, customLabel);
  dom.countOptions.append(customOption);
}
