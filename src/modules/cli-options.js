import { providerCatalog } from "./state.js";

const BOOL = ["true", "false"];

const CODEX_OPTIONS = [
  { key: "dangerously-bypass-approvals-and-sandbox", values: [], valueHint: "flag" },
  { key: "model", values: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"] },
  /*{ key: "model_reasoning_effort", values: ["high", "medium", "low"] },
  { key: "model_verbosity", values: ["low"] },
  { key: "model_context_window", values: ["128000"], valueHint: "integer" },
  { key: "model_reasoning_summary", values: ["none"] },
  { key: "hide_agent_reasoning", values: BOOL },
  { key: "show_raw_agent_reasoning", values: BOOL },
  {
    key: "approval_policy",
    values: ["never", "on-request", "untrusted", "{ granular = {...} }"],
  },
  { key: "sandbox_mode", values: ["workspace-write", "danger-full-access"] },
  { key: "allow_login_shell", values: BOOL },
  { key: "oss_provider", values: ["ollama", "lmstudio"] },
  {
    key: "file_opener",
    values: ["vscode", "cursor", "windsurf", "vscode-insiders", "none"],
  },
  { key: "tui.notification_method", values: ["auto", "osc9", "bel"] },
  { key: "tui.alternate_screen", values: ["never"] },
  { key: "tui.animations", values: BOOL },*/
];

const CLAUDE_OPTIONS = [
  {
    key: "model",
    values: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-6[1m]", "claude-sonnet-4-6[1m]"],
  },
  { key: "effort", values: ["max", "high", "medium", "low"] },
  { key: "dangerously-skip-permissions", values: [], valueHint: "flag"  },
  /*{ key: "alwaysThinkingEnabled", values: BOOL },
  { key: "defaultMode", values: ["acceptEdits"] },
  { key: "enableAllProjectMcpServers", values: BOOL },
  { key: "sandbox.enabled", values: BOOL },
  { key: "sandbox.autoAllowBashIfSandboxed", values: BOOL },
  { key: "sandbox.allowUnsandboxedCommands", values: BOOL },
  { key: "autoConnectIde", values: BOOL },
  { key: "editorMode", values: ["normal", "vim"] },
  { key: "teammateMode", values: ["auto", "in-process", "tmux"] },
  { key: "fastModePerSessionOptIn", values: BOOL },
  { key: "showTurnDuration", values: BOOL },
  { key: "spinnerTipsEnabled", values: BOOL },
  { key: "terminalProgressBarEnabled", values: BOOL },
  { key: "prefersReducedMotion", values: BOOL },
  { key: "language", values: ["english", "italian", "japanese", "spanish", "french"] },
  { key: "voiceEnabled", values: BOOL },
  { key: "autoUpdatesChannel", values: ["stable", "latest"] },
  { key: "disableBypassPermissionsMode", values: ["disable"] },*/
];

export function getInlineOptionsSchema(provider) {
  if (provider === "codex") return CODEX_OPTIONS;
  if (provider === "claude") return CLAUDE_OPTIONS;
  return [];
}

export function quoteIfNeeded(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const alreadyQuoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (alreadyQuoted) return trimmed;
  if (/\s/.test(trimmed)) return `"${trimmed.replace(/"/g, '\\"')}"`;
  return trimmed;
}

export function appendInlineArg(existingArgs, key, value = "") {
  const cleanKey = typeof key === "string" ? key.trim() : "";
  if (!cleanKey) return typeof existingArgs === "string" ? existingArgs.trim() : "";

  const cleanValue = typeof value === "string" ? value.trim() : "";
  const fragment = cleanValue ? `--${cleanKey} ${quoteIfNeeded(cleanValue)}` : `--${cleanKey}`;

  const head = typeof existingArgs === "string" ? existingArgs.trim() : "";
  return head ? `${head} ${fragment}` : fragment;
}

export function buildClientCommand(provider, inlineArgs = "") {
  if (provider === "browser") {
    return typeof inlineArgs === "string" && inlineArgs.trim() ? inlineArgs.trim() : "https://example.com";
  }

  const baseCommand = providerCatalog[provider]?.defaultCommand ?? provider;
  const tail = typeof inlineArgs === "string" ? inlineArgs.trim() : "";

  if (baseCommand && tail) return `${baseCommand} ${tail}`.trim();
  if (baseCommand) return baseCommand.trim();
  return tail;
}

export function extractInlineArgs(provider, command = "") {
  const full = typeof command === "string" ? command.trim() : "";
  if (!full) return "";

  if (provider === "browser") {
    return full;
  }

  const baseCommand = providerCatalog[provider]?.defaultCommand ?? provider;
  const base = typeof baseCommand === "string" ? baseCommand.trim() : "";
  if (!base) return full;

  if (full === base) return "";
  if (full.startsWith(`${base} `)) return full.slice(base.length + 1).trim();
  return full;
}

export function normalizeInlineArgs(inlineArgs, expectedLength) {
  const normalized = Array.isArray(inlineArgs) ? inlineArgs.slice(0, expectedLength) : [];
  while (normalized.length < expectedLength) normalized.push("");
  return normalized.map((value) => (typeof value === "string" ? value : ""));
}
