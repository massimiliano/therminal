const PROVIDERS = Object.freeze({
  claude: {
    label: "Claude CLI",
    defaultCommand: "claude"
  },
  codex: {
    label: "Codex CLI",
    defaultCommand: "codex"
  },
  copilot: {
    label: "Copilot CLI",
    defaultCommand: "copilot"
  },
  gemini: {
    label: "Gemini CLI",
    defaultCommand: "gemini"
  },
  terminal: {
    label: "Terminale",
    defaultCommand: ""
  },
  lazygit: {
    label: "LazyGit",
    defaultCommand: "lazygit"
  }
});

const DEFAULT_SHORTCUTS = Object.freeze({
  toggleWindow: "CommandOrControl+`",
  toggleShortcuts: "CommandOrControl+/",
  toggleBroadcast: "CommandOrControl+Shift+B",
  pushToTalk: "Shift+Alt+Z"
});

const MAX_FAVORITE_MESSAGE_PRESETS = 5;
const DEFAULT_VOICE_PROVIDER = "local";
const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";
const GROQ_STT_MODELS = new Set(["whisper-large-v3", "whisper-large-v3-turbo"]);
const DEFAULT_VOICE_CONFIG = Object.freeze({
  enabled: true,
  provider: DEFAULT_VOICE_PROVIDER,
  whisperCliPath: "",
  modelPath: "",
  language: "it",
  autoSubmit: false,
  groqApiKey: "",
  groqModel: DEFAULT_GROQ_MODEL
});

module.exports = {
  DEFAULT_GROQ_MODEL,
  DEFAULT_SHORTCUTS,
  DEFAULT_VOICE_CONFIG,
  DEFAULT_VOICE_PROVIDER,
  GROQ_STT_MODELS,
  MAX_FAVORITE_MESSAGE_PRESETS,
  PROVIDERS
};
