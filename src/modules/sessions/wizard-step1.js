import { buildDotGrid } from "./wizard-meta.js";

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
      try {
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
    });
    dom.countOptions.append(option);
  }
}
