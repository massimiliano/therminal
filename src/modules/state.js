// ─── Xterm Constructors ─────────────────────────────────
export const TerminalCtor = window.Terminal;
export const FitAddonCtor = window.FitAddon?.FitAddon || window.FitAddon;
export const WebLinksAddonCtor = window.WebLinksAddon?.WebLinksAddon || window.WebLinksAddon;
export const SearchAddonCtor = window.SearchAddon?.SearchAddon || window.SearchAddon;

// ─── Shared Maps ────────────────────────────────────────
export const providerCatalog = {};
export const workspaces = new Map();
export const sessionStore = new Map();
export const scheduledFit = new Map();

// ─── Mutable State ──────────────────────────────────────
export const state = {
  workspaceCounter: 0,
  activeView: "home",
  wizardStep: 1,
  wizardClientCount: 0,
  wizardProviders: [],
  wizardInlineArgs: [],
  wizardBulkInlineArgs: {},
  currentFontSize: parseInt(localStorage.getItem("therminal-font-size")) || 13,
  maximizedSessionId: null,
  focusedSessionId: null,
  dragSessionId: null,
  broadcastMode: false,
};

// ─── Constants ──────────────────────────────────────────
export const GUTTER_PX = 4;

export const PROVIDER_STYLE = {
  claude: {
    badge: "bg-amber-500/15 text-amber-400",
    toggle: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    quick: "text-amber-400 hover:border-amber-500/35 hover:bg-amber-500/5",
    card: "border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.03)]",
    dot: "bg-amber-500/25 text-amber-400",
  },
  codex: {
    badge: "bg-blue-500/15 text-blue-400",
    toggle: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    quick: "text-blue-400 hover:border-blue-500/35 hover:bg-blue-500/5",
    card: "border-blue-500/20 shadow-[0_0_12px_rgba(59,130,246,0.03)]",
    dot: "bg-blue-500/25 text-blue-400",
  },
  gemini: {
    badge: "bg-violet-500/15 text-violet-400",
    toggle: "bg-violet-500/10 border-violet-500/30 text-violet-400",
    quick: "text-violet-400 hover:border-violet-500/35 hover:bg-violet-500/5",
    card: "border-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.03)]",
    dot: "bg-violet-500/25 text-violet-400",
  },
  terminal: {
    badge: "bg-emerald-500/15 text-emerald-400",
    toggle: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
    quick: "text-emerald-400 hover:border-emerald-500/35 hover:bg-emerald-500/5",
    card: "border-emerald-500/20 shadow-[0_0_12px_rgba(52,211,153,0.03)]",
    dot: "bg-emerald-500/25 text-emerald-400",
  },
  lazygit: {
    badge: "bg-lime-500/15 text-lime-300",
    toggle: "bg-lime-500/10 border-lime-500/30 text-lime-300",
    quick: "text-lime-300 hover:border-lime-500/35 hover:bg-lime-500/5",
    card: "border-lime-500/20 shadow-[0_0_12px_rgba(132,204,22,0.03)]",
    dot: "bg-lime-500/25 text-lime-300",
  },
  browser: {
    badge: "bg-cyan-500/15 text-cyan-300",
    dot: "bg-cyan-500/25 text-cyan-300",
  },
};

export const GRID_LAYOUTS = {
  1: [1, 1],
  2: [2, 1],
  4: [2, 2],
  8: [4, 2],
  16: [4, 4],
};

export const XTERM_THEME = {
  background: "#0f1114",
  foreground: "#ecebe7",
  cursor: "#2fc19d",
  selectionBackground: "#2a7f6a66",
  black: "#0d1013",
  red: "#ef665a",
  green: "#72d89a",
  yellow: "#d8bf6c",
  blue: "#6da8f1",
  magenta: "#ca84e8",
  cyan: "#4bc1c5",
  white: "#ecebe7",
  brightBlack: "#636a74",
  brightRed: "#ff867f",
  brightGreen: "#95e6ae",
  brightYellow: "#e6cd7a",
  brightBlue: "#8dbcfa",
  brightMagenta: "#ddb3f7",
  brightCyan: "#72d7da",
  brightWhite: "#ffffff",
};
