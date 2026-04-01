import { providerCatalog } from "../state.js";

export const DOT_GRIDS = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  8: { cols: 4, rows: 2 },
  16: { cols: 4, rows: 4 },
  32: { cols: 8, rows: 4 }
};

const PROVIDER_ACTION_STYLE = {
  claude: "text-amber-300 border-amber-500/30 bg-amber-500/12 hover:bg-amber-500/20 hover:border-amber-400/50",
  codex: "text-sky-300 border-sky-500/30 bg-sky-500/12 hover:bg-sky-500/20 hover:border-sky-400/50",
  copilot: "text-sky-200 border-sky-400/30 bg-sky-400/12 hover:bg-sky-400/20 hover:border-sky-300/50",
  gemini: "text-violet-300 border-violet-500/30 bg-violet-500/12 hover:bg-violet-500/20 hover:border-violet-400/50",
  terminal: "text-emerald-300 border-emerald-500/30 bg-emerald-500/12 hover:bg-emerald-500/20 hover:border-emerald-400/50"
};

const PROVIDER_META = {
  claude: {
    icon: "bi-stars",
    description: "Assistente Anthropic per sessioni di coding con controllo su modello ed effort.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Claude",
    inlinePlaceholder: "es: --model claude-sonnet-4-6 --effort high"
  },
  codex: {
    icon: "bi-braces-asterisk",
    description: "CLI OpenAI orientata a coding, automazioni e task multi-file.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Codex",
    inlinePlaceholder: "es: --model gpt-5.4 --approval-policy on-request"
  },
  copilot: {
    icon: "bi-github",
    description: "Copilot CLI per assistenza guidata e task di coding in shell.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Copilot CLI",
    inlinePlaceholder: "es: --help"
  },
  gemini: {
    icon: "bi-magic",
    description: "CLI Gemini per task generali, revisione e supporto al coding.",
    kindLabel: "AI CLI",
    bulkPlaceholder: "Argomenti per tutti i Gemini",
    inlinePlaceholder: "es: --model gemini-2.5-pro"
  },
  terminal: {
    icon: "bi-terminal",
    description: "Terminale classico, utile per comandi liberi, script e processi locali.",
    kindLabel: "Shell",
    bulkPlaceholder: "Comando per tutti i terminali",
    inlinePlaceholder: "es: npm run dev"
  },
  browser: {
    icon: "bi-globe2",
    description: "Sessione browser con URL iniziale personalizzabile.",
    kindLabel: "Browser",
    bulkPlaceholder: "URL per tutti i browser",
    inlinePlaceholder: "es: https://example.com"
  }
};

const LAUNCHER_PROVIDER_KEYS = ["claude", "codex", "copilot", "gemini", "terminal"];

export function getLauncherProviderEntries() {
  return Object.entries(providerCatalog).filter(([providerKey]) =>
    LAUNCHER_PROVIDER_KEYS.includes(providerKey)
  );
}

export function getFirstLauncherProvider(getFirstAvailableProvider) {
  const providerEntries = getLauncherProviderEntries();
  for (const [providerKey, provider] of providerEntries) {
    if (provider?.available !== false) {
      return providerKey;
    }
  }
  return providerEntries[0]?.[0] || getFirstAvailableProvider();
}

export function getProviderActionClass(providerKey) {
  return (
    PROVIDER_ACTION_STYLE[providerKey] ||
    "text-emerald-300 border-emerald-500/30 bg-emerald-500/12 hover:bg-emerald-500/20 hover:border-emerald-400/50"
  );
}

export function getProviderMeta(providerKey, provider = {}) {
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
    ...PROVIDER_META[providerKey]
  };
}

export function buildDotGrid(count) {
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
