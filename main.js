const crypto = require("crypto");
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, clipboard } = require("electron");
const pty = require("node-pty");

function configureSessionDataPath() {
  if (app.isPackaged) {
    return;
  }

  const sessionDataPath = path.join(
    app.getPath("temp"),
    "therminal-dev-session-data",
    String(process.pid)
  );

  fs.mkdirSync(sessionDataPath, { recursive: true });
  app.setPath("sessionData", sessionDataPath);
}

configureSessionDataPath();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const PROVIDERS = Object.freeze({
  claude: {
    label: "Claude CLI",
    defaultCommand: "claude"
  },
  codex: {
    label: "Codex CLI",
    defaultCommand: "codex"
  },
  gemini: {
    label: "Gemini CLI",
    defaultCommand: "gemini"
  },
  terminal: {
    label: "Terminale",
    defaultCommand: ""
  }
});

const sessionMap = new Map();
let mainWindow = null;
let usageSummaryCache = null;
const usagePanelItemCache = new Map();
let serviceStatusCache = null;
let providerAvailabilityCache = null;
const USAGE_CACHE_TTL_MS = 60000;
const USAGE_PANEL_CACHE_TTL_MS = 240000;
const SERVICE_STATUS_CACHE_TTL_MS = 240000;
const PROVIDER_CACHE_TTL_MS = 15000;
const STATUS_PAGE_RENDER_TIMEOUT_MS = 12000;
const STATUS_PAGE_RENDER_SETTLE_MS = 2500;
const DEFAULT_VOICE_PROVIDER = "local";
const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";
const GROQ_STT_MODELS = new Set(["whisper-large-v3", "whisper-large-v3-turbo"]);
const GROQ_TRANSCRIPTION_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_VOICE_CONFIG = Object.freeze({
  provider: DEFAULT_VOICE_PROVIDER,
  whisperCliPath: "",
  modelPath: "",
  language: "it",
  autoSubmit: false,
  groqApiKey: "",
  groqModel: DEFAULT_GROQ_MODEL
});
const WHISPER_SERVER_HOST = "127.0.0.1";
const WHISPER_SERVER_READY_TIMEOUT_MS = 25000;
const WHISPER_SERVER_REQUEST_TIMEOUT_MS = 120000;
const WHISPER_SERVER_POLL_INTERVAL_MS = 250;
const WHISPER_SERVER_MAX_TRANSCRIBE_ATTEMPTS = 4;
const WHISPER_SERVER_LOG_TAIL_LIMIT = 4000;
let whisperServerRuntime = createWhisperServerRuntime();

app.on("second-instance", () => {
  if (!app.isReady()) {
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
});

// ─── CPU Metrics ────────────────────────────────────────
let prevCpuInfo = null;

function getCpuTimes() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

function getCpuPercent() {
  const cur = getCpuTimes();
  if (!prevCpuInfo) {
    prevCpuInfo = cur;
    return 0;
  }
  const idleDiff = cur.idle - prevCpuInfo.idle;
  const totalDiff = cur.total - prevCpuInfo.total;
  prevCpuInfo = cur;
  if (totalDiff === 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 100);
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function invalidateUsageSummaryCache() {
  usageSummaryCache = null;
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveCommandPath(command) {
  if (typeof command !== "string" || command.trim().length === 0) {
    return { available: false, path: null };
  }

  const trimmed = command.trim();
  if (trimmed.includes("\\") || trimmed.includes("/")) {
    const directPath = path.resolve(trimmed);
    if (fs.existsSync(directPath)) {
      return { available: true, path: directPath };
    }
  }

  const options = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
  };

  if (process.platform === "win32") {
    const result = spawnSync("where.exe", [trimmed], options);
    const candidates = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (result.status === 0 && candidates.length > 0) {
      return { available: true, path: candidates[0] };
    }

    return { available: false, path: null };
  }

  const shellPath = process.env.SHELL || "/bin/sh";
  const result = spawnSync(shellPath, ["-lc", `command -v ${shellEscape(trimmed)}`], options);
  const resolved = String(result.stdout || "").trim().split(/\r?\n/).find(Boolean) || null;
  return {
    available: result.status === 0 && Boolean(resolved),
    path: resolved
  };
}

function getProviderCatalog(force = false) {
  const cacheIsFresh =
    providerAvailabilityCache &&
    providerAvailabilityCache.data &&
    Date.now() - providerAvailabilityCache.timestamp < PROVIDER_CACHE_TTL_MS;

  if (!force && cacheIsFresh) {
    return providerAvailabilityCache.data;
  }

  const data = {};

  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const command = provider.defaultCommand;
    const kind = command ? "cli" : "shell";
    const availability = command
      ? resolveCommandPath(command)
      : { available: true, path: null };

    data[key] = {
      ...provider,
      kind,
      available: availability.available,
      resolvedCommandPath: availability.path,
      availabilityMessage:
        availability.available || !command
          ? null
          : `${provider.label} non trovato. Installa "${command}" e assicurati che sia disponibile nel PATH.`
    };
  }

  providerAvailabilityCache = {
    timestamp: Date.now(),
    data
  };

  return data;
}

function assertProviderAvailable(providerKey, force = false) {
  const provider = getProviderCatalog(force)[providerKey];
  if (provider?.kind === "cli" && provider.available === false) {
    throw new Error(
      provider.availabilityMessage ||
        `${provider.label || providerKey} non trovato. Installa il relativo CLI e riprova.`
    );
  }
}

function getPresetsPath() {
  return path.join(app.getPath("userData"), "presets.json");
}

function getSessionPath() {
  return path.join(app.getPath("userData"), "session.json");
}

function getVoiceConfigPath() {
  return path.join(app.getPath("userData"), "voice-config.json");
}

function normalizeVoiceConfig(payload = {}) {
  const provider =
    typeof payload.provider === "string" && payload.provider.trim().toLowerCase() === "groq"
      ? "groq"
      : DEFAULT_VOICE_PROVIDER;
  const language =
    typeof payload.language === "string" && payload.language.trim().length > 0
      ? payload.language.trim()
      : DEFAULT_VOICE_CONFIG.language;
  const groqModel =
    typeof payload.groqModel === "string" && GROQ_STT_MODELS.has(payload.groqModel.trim())
      ? payload.groqModel.trim()
      : DEFAULT_VOICE_CONFIG.groqModel;

  return {
    provider,
    whisperCliPath:
      typeof payload.whisperCliPath === "string" ? payload.whisperCliPath.trim() : "",
    modelPath: typeof payload.modelPath === "string" ? payload.modelPath.trim() : "",
    language,
    autoSubmit: Boolean(payload.autoSubmit),
    groqApiKey: typeof payload.groqApiKey === "string" ? payload.groqApiKey.trim() : "",
    groqModel
  };
}

function loadVoiceConfigFile() {
  try {
    const configPath = getVoiceConfigPath();
    if (fs.existsSync(configPath)) {
      return normalizeVoiceConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
    }
  } catch {}

  return { ...DEFAULT_VOICE_CONFIG };
}

function saveVoiceConfigFile(payload) {
  const currentConfig = loadVoiceConfigFile();
  const normalized = normalizeVoiceConfig(payload);
  fs.writeFileSync(getVoiceConfigPath(), JSON.stringify(normalized, null, 2), "utf8");
  if (getVoiceRuntimeKey(currentConfig) !== getVoiceRuntimeKey(normalized)) {
    stopWhisperServerRuntime();
  }
  return normalized;
}

function isVoiceConfigReady(config = {}) {
  const normalized = normalizeVoiceConfig(config);
  if (normalized.provider === "groq") {
    return Boolean(normalized.groqApiKey && normalized.groqModel);
  }

  return Boolean(normalized.whisperCliPath && normalized.modelPath);
}

function getVoiceRuntimeKey(payload = {}) {
  const config = normalizeVoiceConfig(payload);
  return JSON.stringify([
    config.provider,
    config.whisperCliPath,
    config.modelPath,
    String(config.language || DEFAULT_VOICE_CONFIG.language).toLowerCase(),
    config.groqModel
  ]);
}

function resolveWhisperServerPath(whisperCliPath) {
  if (typeof whisperCliPath !== "string" || whisperCliPath.trim().length === 0) {
    return null;
  }

  const resolvedCliPath = path.resolve(whisperCliPath.trim());
  const dir = path.dirname(resolvedCliPath);
  const ext = path.extname(resolvedCliPath);
  const baseName = path.basename(resolvedCliPath, ext).toLowerCase();
  const candidates = [
    path.join(dir, `whisper-server${ext}`),
    path.join(dir, `server${ext}`)
  ];

  if (baseName.includes("cli")) {
    candidates.unshift(path.join(dir, `${baseName.replace("cli", "server")}${ext}`));
  }

  for (const candidate of candidates) {
    if (candidate !== resolvedCliPath && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getResolvedVoiceRuntimeConfig(payload = loadVoiceConfigFile()) {
  const config = normalizeVoiceConfig(payload);
  if (config.provider !== "local") {
    throw new Error("Provider voice locale non selezionato.");
  }
  const whisperCliPath = assertExistingFile(config.whisperCliPath, "whisper-cli");
  const modelPath = assertExistingFile(config.modelPath, "Modello Whisper");
  return {
    ...config,
    whisperCliPath,
    modelPath,
    whisperServerPath: resolveWhisperServerPath(whisperCliPath),
    runtimeKey: getVoiceRuntimeKey(config)
  };
}

function createWhisperServerRuntime() {
  return {
    child: null,
    baseUrl: "",
    port: 0,
    runtimeKey: "",
    readyPromise: null
  };
}

function getResolvedGroqVoiceConfig(payload = loadVoiceConfigFile()) {
  const config = normalizeVoiceConfig(payload);
  if (config.provider !== "groq") {
    throw new Error("Provider voice Groq non selezionato.");
  }

  const groqApiKey =
    config.groqApiKey || (typeof process.env.GROQ_API_KEY === "string" ? process.env.GROQ_API_KEY.trim() : "");
  if (!groqApiKey) {
    throw new Error("Configura la Groq API key per usare il voice to text cloud.");
  }

  return {
    ...config,
    groqApiKey
  };
}

function appendLogTail(currentValue, chunk) {
  const nextValue = `${currentValue || ""}${String(chunk || "")}`;
  if (nextValue.length <= WHISPER_SERVER_LOG_TAIL_LIMIT) {
    return nextValue;
  }
  return nextValue.slice(-WHISPER_SERVER_LOG_TAIL_LIMIT);
}

function stopWhisperServerRuntime() {
  const child = whisperServerRuntime.child;
  whisperServerRuntime = createWhisperServerRuntime();

  if (child && !child.killed) {
    try {
      child.kill();
    } catch {
      // Ignore shutdown issues during cleanup.
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = WHISPER_SERVER_REQUEST_TIMEOUT_MS) {
  const timeout = createTimeoutSignal(timeoutMs);
  try {
    return await fetch(resource, {
      ...options,
      signal: timeout.signal
    });
  } finally {
    timeout.clear();
  }
}

async function allocateWhisperServerPort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, WHISPER_SERVER_HOST, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function buildWhisperServerArgs(runtimeConfig, port) {
  const args = [
    "-m",
    runtimeConfig.modelPath,
    "--host",
    WHISPER_SERVER_HOST,
    "--port",
    String(port),
    "-nt",
    "-sns",
    "-nth",
    "0.35"
  ];

  if (runtimeConfig.language && runtimeConfig.language.toLowerCase() !== "auto") {
    args.push("-l", runtimeConfig.language);
  }

  return args;
}

function getWhisperServerFailureDetails(state) {
  return [state.stderrTail, state.stdoutTail]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function createWhisperServerError(message, state) {
  const details = getWhisperServerFailureDetails(state);
  return new Error(details ? `${message}\n${details}` : message);
}

async function waitForWhisperServerReady(state) {
  const deadline = Date.now() + WHISPER_SERVER_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (state.startupError) {
      throw createWhisperServerError(
        `Avvio di whisper-server fallito: ${state.startupError.message}`,
        state
      );
    }

    if (state.hasExited) {
      throw createWhisperServerError(
        `whisper-server si e chiuso prematuramente (code ${state.exitCode ?? "unknown"}).`,
        state
      );
    }

    try {
      const response = await fetchWithTimeout(state.baseUrl, {}, 1200);
      if (!shouldRetryWhisperServerResponse(response.status, "")) {
        return;
      }
    } catch {}

    await delay(WHISPER_SERVER_POLL_INTERVAL_MS);
  }

  throw createWhisperServerError("Timeout durante il caricamento del modello Whisper.", state);
}

async function ensureWhisperServerRuntime(runtimeConfig) {
  if (!runtimeConfig.whisperServerPath) {
    return null;
  }

  if (
    whisperServerRuntime.child &&
    whisperServerRuntime.runtimeKey === runtimeConfig.runtimeKey &&
    whisperServerRuntime.readyPromise
  ) {
    await whisperServerRuntime.readyPromise;
    return whisperServerRuntime;
  }

  stopWhisperServerRuntime();

  const port = await allocateWhisperServerPort();
  const state = {
    child: null,
    baseUrl: `http://${WHISPER_SERVER_HOST}:${port}`,
    port,
    runtimeKey: runtimeConfig.runtimeKey,
    readyPromise: null,
    stdoutTail: "",
    stderrTail: "",
    startupError: null,
    exitCode: null,
    hasExited: false
  };

  const child = spawn(runtimeConfig.whisperServerPath, buildWhisperServerArgs(runtimeConfig, port), {
    windowsHide: true,
    shell: false
  });

  state.child = child;
  state.readyPromise = waitForWhisperServerReady(state);
  whisperServerRuntime = state;

  child.stdout.on("data", (chunk) => {
    state.stdoutTail = appendLogTail(state.stdoutTail, chunk.toString());
  });

  child.stderr.on("data", (chunk) => {
    state.stderrTail = appendLogTail(state.stderrTail, chunk.toString());
  });

  child.on("error", (error) => {
    state.startupError = error;
  });

  child.on("close", (code) => {
    state.hasExited = true;
    state.exitCode = code;
    if (whisperServerRuntime.child === child) {
      whisperServerRuntime = createWhisperServerRuntime();
    }
  });

  await state.readyPromise;
  return state;
}

function assertExistingFile(filePath, label) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error(`${label} non configurato.`);
  }

  const resolved = path.resolve(filePath.trim());

  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} non trovato: ${resolved}`);
  }

  return resolved;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value));
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  throw new Error("Payload audio non valido.");
}

function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    if (!filePath) {
      continue;
    }

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore temp file cleanup issues.
    }
  }
}

function parseWhisperStdout(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("whisper_") &&
        !line.startsWith("main:") &&
        !line.startsWith("system_info:")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTranscriptionText(text) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const withoutBracketOnlyTokens = normalized
    .replace(/(?:^|\s)[\[(][^\])]{1,40}[\])](?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const lowerValue = withoutBracketOnlyTokens.toLowerCase();
  if (
    !withoutBracketOnlyTokens ||
    lowerValue === "musica" ||
    lowerValue === "music" ||
    lowerValue === "applausi" ||
    lowerValue === "applause"
  ) {
    return "";
  }

  return withoutBracketOnlyTokens;
}

async function transcribeWithWhisperCli(audioBuffer, runtimeConfig) {
  const tempBase = path.join(app.getPath("temp"), `therminal-stt-${crypto.randomUUID()}`);
  const audioPath = `${tempBase}.wav`;
  const outputBase = `${tempBase}-result`;
  const outputTextPath = `${outputBase}.txt`;
  const args = [
    "-m",
    runtimeConfig.modelPath,
    "-f",
    audioPath,
    "-otxt",
    "-of",
    outputBase,
    "-nt",
    "-np",
    "-sns",
    "-nth",
    "0.35"
  ];

  if (runtimeConfig.language && runtimeConfig.language.toLowerCase() !== "auto") {
    args.push("-l", runtimeConfig.language);
  }

  fs.writeFileSync(audioPath, toBuffer(audioBuffer));

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(runtimeConfig.whisperCliPath, args, {
        windowsHide: true,
        shell: false
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => reject(error));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

    const rawText = fs.existsSync(outputTextPath)
      ? fs.readFileSync(outputTextPath, "utf8").replace(/\s+/g, " ").trim()
      : parseWhisperStdout(result.stdout);

    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout || "Trascrizione fallita.").trim());
    }

    return {
      text: normalizeTranscriptionText(rawText),
      language: runtimeConfig.language,
      autoSubmit: runtimeConfig.autoSubmit
    };
  } finally {
    cleanupFiles([audioPath, outputTextPath, `${outputBase}.srt`, `${outputBase}.vtt`, `${outputBase}.csv`, `${outputBase}.json`]);
  }
}

function shouldRetryWhisperServerResponse(status, body) {
  if (status === 425 || status === 429 || status === 503) {
    return true;
  }

  const normalizedBody = String(body || "").toLowerCase();
  return normalizedBody.includes("loading") || normalizedBody.includes("busy");
}

function shouldRetryWhisperServerError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.name === "AbortError" ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up")
  );
}

async function transcribeWithWhisperServer(audioBuffer, runtimeConfig) {
  const serverState = await ensureWhisperServerRuntime(runtimeConfig);
  if (!serverState) {
    throw new Error("whisper-server non disponibile.");
  }

  let lastError = null;

  for (let attempt = 0; attempt < WHISPER_SERVER_MAX_TRANSCRIBE_ATTEMPTS; attempt += 1) {
    try {
      const formData = new FormData();
      formData.set("file", new Blob([toBuffer(audioBuffer)], { type: "audio/wav" }), "audio.wav");
      formData.set("response_format", "text");

      const response = await fetchWithTimeout(
        `${serverState.baseUrl}/inference`,
        {
          method: "POST",
          body: formData
        },
        WHISPER_SERVER_REQUEST_TIMEOUT_MS
      );

      const responseText = (await response.text()).trim();
      if (response.ok) {
        return {
          text: normalizeTranscriptionText(responseText),
          language: runtimeConfig.language,
          autoSubmit: runtimeConfig.autoSubmit
        };
      }

      const error = new Error(
        responseText || `Trascrizione con whisper-server fallita (HTTP ${response.status}).`
      );
      if (!shouldRetryWhisperServerResponse(response.status, responseText)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
      if (!shouldRetryWhisperServerError(error)) {
        break;
      }
    }

    await delay(WHISPER_SERVER_POLL_INTERVAL_MS);
  }

  throw lastError || new Error("Trascrizione con whisper-server fallita.");
}

async function warmLocalWhisperModel() {
  const config = loadVoiceConfigFile();
  if (config.provider !== "local" || !isVoiceConfigReady(config)) {
    stopWhisperServerRuntime();
    return {
      warmed: false,
      mode: config.provider === "groq" ? "groq" : "disabled",
      persistentAvailable: false
    };
  }

  let runtimeConfig;
  try {
    runtimeConfig = getResolvedVoiceRuntimeConfig(config);
  } catch (error) {
    stopWhisperServerRuntime();
    return {
      warmed: false,
      mode: "invalid",
      persistentAvailable: false,
      error: error.message
    };
  }

  if (!runtimeConfig.whisperServerPath) {
    stopWhisperServerRuntime();
    return {
      warmed: false,
      mode: "cli",
      persistentAvailable: false
    };
  }

  try {
    await ensureWhisperServerRuntime(runtimeConfig);
    return {
      warmed: true,
      mode: "server",
      persistentAvailable: true
    };
  } catch (error) {
    stopWhisperServerRuntime();
    return {
      warmed: false,
      mode: "cli",
      persistentAvailable: true,
      error: error.message
    };
  }
}

async function transcribeWithLocalWhisper(audioBuffer) {
  const runtimeConfig = getResolvedVoiceRuntimeConfig();

  if (runtimeConfig.whisperServerPath) {
    try {
      return await transcribeWithWhisperServer(audioBuffer, runtimeConfig);
    } catch {
      stopWhisperServerRuntime();
    }
  }

  return await transcribeWithWhisperCli(audioBuffer, runtimeConfig);
}

async function transcribeWithGroq(audioBuffer) {
  const runtimeConfig = getResolvedGroqVoiceConfig();
  const formData = new FormData();
  formData.set("file", new Blob([toBuffer(audioBuffer)], { type: "audio/wav" }), "audio.wav");
  formData.set("model", runtimeConfig.groqModel);
  formData.set("temperature", "0");
  formData.set("response_format", "verbose_json");

  if (runtimeConfig.language && runtimeConfig.language.toLowerCase() !== "auto") {
    formData.set("language", runtimeConfig.language);
  }

  const response = await fetchWithTimeout(
    GROQ_TRANSCRIPTION_API_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtimeConfig.groqApiKey}`
      },
      body: formData
    },
    GROQ_REQUEST_TIMEOUT_MS
  );

  const responseText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {}

  if (!response.ok) {
    const apiMessage =
      payload?.error?.message ||
      payload?.message ||
      responseText.trim() ||
      `Trascrizione Groq fallita (HTTP ${response.status}).`;
    throw new Error(apiMessage);
  }

  return {
    text: normalizeTranscriptionText(payload?.text || ""),
    language: payload?.language || runtimeConfig.language,
    autoSubmit: runtimeConfig.autoSubmit,
    provider: "groq",
    model: runtimeConfig.groqModel
  };
}

async function transcribeVoice(audioBuffer) {
  const config = loadVoiceConfigFile();
  if (config.provider === "groq") {
    stopWhisperServerRuntime();
    return await transcribeWithGroq(audioBuffer);
  }

  return await transcribeWithLocalWhisper(audioBuffer);
}

async function showOpenFileDialog(event, payload = {}) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win || undefined, {
    title: payload.title || "Seleziona file",
    defaultPath:
      typeof payload.defaultPath === "string" && payload.defaultPath.trim().length > 0
        ? payload.defaultPath.trim()
        : undefined,
    filters: Array.isArray(payload.filters) ? payload.filters : undefined,
    properties: ["openFile"]
  });

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

function loadPresetsFile() {
  try {
    const p = getPresetsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch {}
  return {};
}

function savePresetsFile(data) {
  fs.writeFileSync(getPresetsPath(), JSON.stringify(data, null, 2), "utf8");
}

function getPreferredShell() {
  if (process.platform === "win32") {
    const pwshPath = path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "PowerShell",
      "7",
      "pwsh.exe"
    );

    if (fs.existsSync(pwshPath)) {
      return pwshPath;
    }

    return "powershell.exe";
  }

  return process.env.SHELL || (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
}

function getShellArgs(command) {
  const hasCommand = typeof command === "string" && command.trim().length > 0;

  if (process.platform === "win32") {
    if (!hasCommand) return ["-NoLogo", "-NoExit"];
    return ["-NoLogo", "-NoExit", "-Command", command];
  }

  if (!hasCommand) return [];
  return ["-lc", command];
}

function closeAllSessions() {
  for (const [id, session] of Array.from(sessionMap.entries())) {
    try {
      session.pty.kill();
    } catch {
      // Ignore process teardown failures at shutdown.
    }
    sessionMap.delete(id);
  }
  invalidateUsageSummaryCache();
}

function sanitizeSessionPayload(payload = {}) {
  const provider = PROVIDERS[payload.provider] ? payload.provider : "codex";
  const defaultCommand = PROVIDERS[provider].defaultCommand;
  const command =
    typeof payload.command === "string" && payload.command.trim().length > 0
      ? payload.command.trim()
      : defaultCommand;

  const requestedCwd =
    typeof payload.cwd === "string" && payload.cwd.trim().length > 0 ? payload.cwd.trim() : ".";
  const cwd = path.resolve(requestedCwd);

  if (!fs.existsSync(cwd)) {
    throw new Error(`La directory non esiste: ${cwd}`);
  }

  assertProviderAvailable(provider);

  return { provider, command, cwd };
}

function getExistingDirectory(defaultPath) {
  if (typeof defaultPath !== "string" || defaultPath.trim().length === 0) {
    return undefined;
  }

  const resolved = path.resolve(defaultPath.trim());

  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {}

  return undefined;
}

function runGitCommand(cwd, args) {
  return spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
  });
}

function parseGitStatusLine(line) {
  if (typeof line !== "string" || line.length < 3) {
    return null;
  }

  const indexStatus = line[0];
  const worktreeStatus = line[1];
  const rawPath = line.slice(3).trim();
  const pathValue = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop().trim() : rawPath;

  if (!pathValue) {
    return null;
  }

  return {
    path: pathValue,
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== " " && indexStatus !== "?",
    untracked: indexStatus === "?" || worktreeStatus === "?",
    raw: line
  };
}

function getGitStatusSummary(payload = {}) {
  const requestedCwd =
    typeof payload.cwd === "string" && payload.cwd.trim().length > 0 ? payload.cwd.trim() : process.cwd();
  const cwd = path.resolve(requestedCwd);

  if (!fs.existsSync(cwd)) {
    return {
      ok: false,
      cwd,
      reason: "missing-cwd",
      message: `Directory non trovata: ${cwd}`
    };
  }

  const rootResult = runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
  if (rootResult.error || rootResult.status !== 0) {
    return {
      ok: false,
      cwd,
      reason: "not-a-repo",
      message: "Nessun repository Git rilevato nel workspace."
    };
  }

  const repoRoot = String(rootResult.stdout || "").trim();
  const branchResult = runGitCommand(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const statusResult = runGitCommand(cwd, ["status", "--short", "--branch", "--untracked-files=all"]);

  const branch = String(branchResult.stdout || "").trim() || "HEAD";
  const statusLines = String(statusResult.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean);
  const branchLine = statusLines[0] || "";
  const fileLines = statusLines.slice(branchLine.startsWith("##") ? 1 : 0);
  const files = fileLines.map(parseGitStatusLine).filter(Boolean);

  let ahead = 0;
  let behind = 0;
  const aheadMatch = branchLine.match(/ahead (\d+)/i);
  const behindMatch = branchLine.match(/behind (\d+)/i);
  if (aheadMatch) {
    ahead = Number(aheadMatch[1]) || 0;
  }
  if (behindMatch) {
    behind = Number(behindMatch[1]) || 0;
  }

  return {
    ok: true,
    cwd,
    repoRoot,
    branch,
    branchLine,
    dirty: files.length > 0,
    ahead,
    behind,
    stagedCount: files.filter((file) => file.staged).length,
    untrackedCount: files.filter((file) => file.untracked).length,
    changedCount: files.length,
    files: files.slice(0, 12)
  };
}

function getLatestActiveSession(provider) {
  const sessions = Array.from(sessionMap.values());
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    if (sessions[i].provider === provider) {
      return sessions[i];
    }
  }
  return null;
}

function getSortedFiles(rootPath, matcher = () => true, recursive = false) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const stack = [rootPath];

  while (stack.length) {
    const currentPath = stack.pop();
    let entries = [];

    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !matcher(fullPath, entry.name)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          mtimeMs: stat.mtimeMs
        });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTailUtf8(filePath, maxBytes = 131072) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");

    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }

    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function stripAnsiOutput(text) {
  return text
    .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function parseCodexStatusOutput(text) {
  const primaryMatch = text.match(/5h limit:\s*\[[^\]]+\]\s*(\d+)% left\s*\(resets ([^)]+)\)/i);
  const secondaryMatch = text.match(
    /Weekly limit:\s*\[[^\]]+\]\s*(\d+)% left\s*\(resets ([^)]+)\)/i
  );

  if (!primaryMatch || !secondaryMatch) {
    return null;
  }

  const modelMatch = text.match(/Model:\s+(.+?)\s*(?:\n|│)/i);
  const accountMatch = text.match(/Account:\s+(.+?)\s*(?:\n|│)/i);
  const sessionMatch = text.match(/Session:\s+([a-z0-9-]+)\s*(?:\n|│)/i);

  return {
    available: true,
    source: "probe",
    model: modelMatch?.[1]?.trim() || null,
    account: accountMatch?.[1]?.trim() || null,
    sessionId: sessionMatch?.[1]?.trim() || null,
    primaryLeftPercent: numberOrZero(primaryMatch[1]),
    primaryUsedPercent: 100 - numberOrZero(primaryMatch[1]),
    primaryResetLabel: primaryMatch[2]?.trim() || null,
    secondaryLeftPercent: numberOrZero(secondaryMatch[1]),
    secondaryUsedPercent: 100 - numberOrZero(secondaryMatch[1]),
    secondaryResetLabel: secondaryMatch[2]?.trim() || null
  };
}

async function probeCodexUsageSummary(cwd) {
  return await new Promise((resolve) => {
    let rawOutput = "";
    let commandSent = false;
    let settled = false;
    let delayedSend = null;

    const probe = pty.spawn(getPreferredShell(), getShellArgs(PROVIDERS.codex.defaultCommand), {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: cwd || process.cwd(),
      env: process.env
    });

    const cleanup = () => {
      if (delayedSend) {
        clearTimeout(delayedSend);
        delayedSend = null;
      }
      clearTimeout(fallbackSendTimer);
      clearTimeout(timeoutTimer);

      try {
        probe.kill();
      } catch {
        // Ignore teardown failures from background probes.
      }
    };

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const sendStatus = () => {
      if (commandSent || settled) {
        return;
      }
      commandSent = true;

      try {
        probe.write("/status\r");
      } catch {
        finish(null);
      }
    };

    const timeoutTimer = setTimeout(() => finish(null), 22000);
    const fallbackSendTimer = setTimeout(sendStatus, 15000);

    probe.onData((chunk) => {
      rawOutput += chunk;
      const cleanOutput = stripAnsiOutput(rawOutput);

      if (
        !commandSent &&
        !delayedSend &&
        cleanOutput.includes("OpenAI Codex") &&
        cleanOutput.includes("% left")
      ) {
        delayedSend = setTimeout(sendStatus, 4000);
      }

      const parsed = parseCodexStatusOutput(cleanOutput);
      if (parsed) {
        finish(parsed);
      }
    });

    probe.onExit(() => {
      const parsed = parseCodexStatusOutput(stripAnsiOutput(rawOutput));
      finish(parsed);
    });
  });
}

function parseCodexUsageFromText(text) {
  let latestUsage = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const rateLimits = entry?.payload?.rate_limits;
    if (!rateLimits?.primary || !rateLimits?.secondary) {
      continue;
    }

    latestUsage = {
      available: true,
      source: "rate_limits",
      planType: typeof rateLimits.plan_type === "string" ? rateLimits.plan_type : null,
      primaryLeftPercent: 100 - numberOrZero(rateLimits.primary.used_percent),
      primaryUsedPercent: numberOrZero(rateLimits.primary.used_percent),
      primaryWindowMinutes: numberOrZero(rateLimits.primary.window_minutes),
      primaryResetsAt: numberOrZero(rateLimits.primary.resets_at) || null,
      secondaryLeftPercent: 100 - numberOrZero(rateLimits.secondary.used_percent),
      secondaryUsedPercent: numberOrZero(rateLimits.secondary.used_percent),
      secondaryWindowMinutes: numberOrZero(rateLimits.secondary.window_minutes),
      secondaryResetsAt: numberOrZero(rateLimits.secondary.resets_at) || null,
      totalTokens: numberOrZero(entry?.payload?.info?.total_token_usage?.total_tokens) || null,
      timestamp: entry?.timestamp || null
    };
  }

  return latestUsage;
}

function getCodexUsageSummaryFromFiles() {
  const sessionRoot = path.join(os.homedir(), ".codex", "sessions");
  const recentFiles = getSortedFiles(sessionRoot, (_fullPath, name) => name.endsWith(".jsonl"), true)
    .slice(0, 8);

  for (const file of recentFiles) {
    const usage = parseCodexUsageFromText(readTailUtf8(file.path));
    if (usage) {
      return usage;
    }
  }

  return null;
}

async function getCodexUsageSummary(cwd) {
  const liveSummary = await probeCodexUsageSummary(cwd);
  return liveSummary || getCodexUsageSummaryFromFiles();
}

function normalizePathLookup(value) {
  return path.resolve(String(value)).replace(/\//g, "\\").toLowerCase();
}

function getGeminiProjectIdForCwd(cwd) {
  const registryPath = path.join(os.homedir(), ".gemini", "projects.json");
  const registry = readJsonFile(registryPath);
  const projects = registry?.projects;

  if (!projects || typeof projects !== "object") {
    return null;
  }

  const normalizedCwd = normalizePathLookup(cwd);
  let bestMatch = null;
  let bestLength = -1;

  for (const [projectPath, projectId] of Object.entries(projects)) {
    if (typeof projectId !== "string" || !projectId) {
      continue;
    }

    const normalizedProject = normalizePathLookup(projectPath);
    const isExactMatch = normalizedCwd === normalizedProject;
    const isNestedMatch = normalizedCwd.startsWith(`${normalizedProject}\\`);

    if ((isExactMatch || isNestedMatch) && normalizedProject.length > bestLength) {
      bestMatch = projectId;
      bestLength = normalizedProject.length;
    }
  }

  return bestMatch;
}

function getGeminiUsageSummary(cwd) {
  if (!cwd) {
    return null;
  }

  const projectId = getGeminiProjectIdForCwd(cwd);
  if (!projectId) {
    return null;
  }

  const chatsRoot = path.join(os.homedir(), ".gemini", "tmp", projectId, "chats");
  const latestChat = getSortedFiles(chatsRoot, (_fullPath, name) => name.endsWith(".json")).shift();
  const sessionData = latestChat ? readJsonFile(latestChat.path) : null;
  const messages = Array.isArray(sessionData?.messages) ? sessionData.messages : [];

  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let thoughtTokens = 0;
  let toolTokens = 0;
  let model = null;

  for (const message of messages) {
    const tokens = message?.tokens;
    if (tokens && typeof tokens === "object") {
      totalTokens += numberOrZero(tokens.total);
      inputTokens += numberOrZero(tokens.input);
      outputTokens += numberOrZero(tokens.output);
      cachedTokens += numberOrZero(tokens.cached);
      thoughtTokens += numberOrZero(tokens.thoughts);
      toolTokens += numberOrZero(tokens.tool);
    }

    if (typeof message?.model === "string" && message.model) {
      model = message.model;
    }
  }

  if (!totalTokens) {
    return null;
  }

  return {
    available: true,
    source: "session_tokens",
    projectId,
    sessionId: sessionData?.sessionId || null,
    model,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    thoughtTokens,
    toolTokens,
    lastUpdated: sessionData?.lastUpdated || null
  };
}

function getClaudeProjectDir(cwd) {
  const projectKey = path.resolve(cwd).replace(/[^A-Za-z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", projectKey);
}

function getClaudeUsageSummary(cwd) {
  if (!cwd) {
    return null;
  }

  const projectDir = getClaudeProjectDir(cwd);
  const latestSessionFile = getSortedFiles(projectDir, (_fullPath, name) => name.endsWith(".jsonl")).shift();

  if (!latestSessionFile) {
    return null;
  }

  let content = "";
  try {
    content = fs.readFileSync(latestSessionFile.path, "utf8");
  } catch {
    return null;
  }

  const requestTotals = new Map();
  let model = null;
  let lastTimestamp = null;
  let fallbackIndex = 0;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const usage = entry?.message?.usage;
    if (!usage || typeof usage !== "object") {
      continue;
    }

    const statLine = {
      inputTokens: numberOrZero(usage.input_tokens),
      cacheCreationTokens: numberOrZero(usage.cache_creation_input_tokens),
      cacheReadTokens: numberOrZero(usage.cache_read_input_tokens),
      outputTokens: numberOrZero(usage.output_tokens)
    };
    statLine.totalTokens =
      statLine.inputTokens +
      statLine.cacheCreationTokens +
      statLine.cacheReadTokens +
      statLine.outputTokens;

    const requestKey =
      entry.requestId ||
      entry?.message?.id ||
      entry?.uuid ||
      `fallback-${fallbackIndex++}`;
    const previous = requestTotals.get(requestKey);

    if (!previous || statLine.totalTokens > previous.totalTokens) {
      requestTotals.set(requestKey, statLine);
    }

    if (typeof entry?.message?.model === "string" && entry.message.model) {
      model = entry.message.model;
    }
    if (typeof entry?.timestamp === "string") {
      lastTimestamp = entry.timestamp;
    }
  }

  if (!requestTotals.size) {
    return null;
  }

  const summary = {
    available: true,
    source: "session_tokens",
    model,
    totalTokens: 0,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    lastUpdated: lastTimestamp
  };

  for (const usage of requestTotals.values()) {
    summary.totalTokens += usage.totalTokens;
    summary.inputTokens += usage.inputTokens;
    summary.cacheCreationTokens += usage.cacheCreationTokens;
    summary.cacheReadTokens += usage.cacheReadTokens;
    summary.outputTokens += usage.outputTokens;
  }

  return summary;
}

async function getUsageSummary() {
  const activeGemini = getLatestActiveSession("gemini");
  const activeCodex = getLatestActiveSession("codex");
  const activeClaude = getLatestActiveSession("claude");
  const cacheKey = JSON.stringify({
    codexCwd: activeCodex?.cwd || "",
    geminiCwd: activeGemini?.cwd || "",
    claudeCwd: activeClaude?.cwd || ""
  });

  if (
    usageSummaryCache &&
    usageSummaryCache.key === cacheKey &&
    Date.now() - usageSummaryCache.timestamp < USAGE_CACHE_TTL_MS
  ) {
    return usageSummaryCache.data;
  }

  if (usageSummaryCache?.key === cacheKey && usageSummaryCache.promise) {
    return usageSummaryCache.promise;
  }

  const promise = (async () => {
    const data = {
      refreshedAt: new Date().toISOString(),
      codex: await getCodexUsageSummary(activeCodex?.cwd || process.cwd()),
      gemini: getGeminiUsageSummary(activeGemini?.cwd),
      claude: getClaudeUsageSummary(activeClaude?.cwd)
    };

    usageSummaryCache = {
      key: cacheKey,
      timestamp: Date.now(),
      data
    };

    return data;
  })();

  usageSummaryCache = {
    key: cacheKey,
    timestamp: Date.now(),
    promise
  };

  try {
    return await promise;
  } catch {
    usageSummaryCache = null;
    return {
      refreshedAt: new Date().toISOString(),
      codex: getCodexUsageSummaryFromFiles(),
      gemini: getGeminiUsageSummary(activeGemini?.cwd),
      claude: getClaudeUsageSummary(activeClaude?.cwd)
    };
  }
}

const USAGE_PROBE_PLANS = Object.freeze({
  codex: {
    command: "/status",
    initialDelay: 4500,
    retryDelay: 5000,
    maxRetries: 1,
    timeoutMs: 22000,
    successPattern: /5h limit:|Weekly limit:/i
  },
  gemini: {
    command: "/stats",
    initialDelay: 14000,
    retryDelay: 8000,
    maxRetries: 2,
    timeoutMs: 42000,
    successPattern: /Session Stats|Interaction Summary|Model usage|Performance/i
  },
  claude: {
    command: "/usage",
    initialDelay: 9000,
    retryDelay: 9000,
    maxRetries: 2,
    timeoutMs: 42000,
    successPattern: /Current session|Current week|Extra usage/i
  }
});

function resolveUsageProbeCwd(cwd) {
  const requested =
    typeof cwd === "string" && cwd.trim()
      ? cwd.trim()
      : getLatestActiveSession("codex")?.cwd ||
        getLatestActiveSession("gemini")?.cwd ||
        getLatestActiveSession("claude")?.cwd ||
        process.cwd();

  const resolved = path.resolve(requested);
  return fs.existsSync(resolved) ? resolved : process.cwd();
}

function parseGeminiStatsOutput(text) {
  if (!/Session Stats|Interaction Summary|Model usage|Performance/i.test(text)) {
    return null;
  }

  const tierMatch = text.match(/Tier:\s+([^\n]+)/i);
  const authMatch = text.match(/Auth Method:\s+([^\n]+)/i);
  const toolCallsMatch = text.match(/Tool Calls:\s+([^\n]+)/i);
  const rows = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const modelMatch = line.match(/(gemini-[^\s]+)/i);
    if (!modelMatch) {
      continue;
    }

    const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
    if (!percentMatch) {
      continue;
    }

    rows.push({
      model: modelMatch[1],
      usedPercent: numberOrZero(percentMatch[1]),
      resetLabel: line
        .slice(percentMatch.index + percentMatch[0].length)
        .replace(/[|│]+/g, " ")
        .trim()
    });
  }

  if (!rows.length && !tierMatch && !authMatch) {
    return null;
  }

  return {
    available: true,
    tier: tierMatch?.[1]?.trim() || null,
    authMethod: authMatch?.[1]?.trim() || null,
    toolCalls: toolCallsMatch?.[1]?.trim() || null,
    models: rows
  };
}

function parseClaudeUsageOutput(text) {
  if (!/Current session|Current week|Extra usage/i.test(text)) {
    return null;
  }

  const normalized = String(text).replace(/\u00a0/g, " ");

  function extractSection(label, nextLabels = []) {
    const start = normalized.search(new RegExp(label, "i"));
    if (start < 0) {
      return "";
    }

    let end = normalized.length;
    for (const nextLabel of nextLabels) {
      const nextIndex = normalized.slice(start + 1).search(new RegExp(nextLabel, "i"));
      if (nextIndex >= 0) {
        end = Math.min(end, start + 1 + nextIndex);
      }
    }

    return normalized.slice(start, end);
  }

  const currentSessionSection = extractSection("Current session", ["Current week", "Extra usage"]);
  const currentWeekSection = extractSection("Current week(?:\\s*\\(all models\\))?", ["Extra usage"]);
  const extraUsageSection = extractSection("Extra usage", ["Esc to cancel"]);

  const currentSessionMatch = currentSessionSection.match(/(\d+(?:\.\d+)?)%\s*used/i);
  const currentSessionResetMatch = currentSessionSection.match(/Resets?\s*([^\n]+)/i);

  const currentWeekMatch = currentWeekSection.match(/(\d+(?:\.\d+)?)%\s*used/i);
  const currentWeekResetMatch = currentWeekSection.match(/Resets?\s*([^\n]+)/i);

  const extraPercentMatch = extraUsageSection.match(/(\d+(?:\.\d+)?)%\s*used/i);
  const extraSpendMatch = extraUsageSection.match(/\$([0-9.,]+)\s*\/\s*\$([0-9.,]+)\s*spent/i);
  const extraResetMatch = extraUsageSection.match(/Resets?\s*([^\n]+)/i);

  if (!currentSessionMatch && !currentWeekMatch && !extraPercentMatch) {
    return null;
  }

  return {
    available: true,
    currentSessionUsedPercent: numberOrZero(currentSessionMatch?.[1]),
    currentSessionResetLabel: currentSessionResetMatch?.[1]?.trim() || null,
    currentWeekUsedPercent: numberOrZero(currentWeekMatch?.[1]),
    currentWeekResetLabel: currentWeekResetMatch?.[1]?.trim() || null,
    extraUsedPercent: numberOrZero(extraPercentMatch?.[1]),
    extraSpent: extraSpendMatch?.[1]?.trim() || null,
    extraLimit: extraSpendMatch?.[2]?.trim() || null,
    extraResetLabel: extraResetMatch?.[1]?.trim() || null
  };
}

function parseUsageProbeOutput(provider, text) {
  if (!text) {
    return null;
  }

  switch (provider) {
    case "codex":
      return parseCodexStatusOutput(text);
    case "gemini":
      return parseGeminiStatsOutput(text);
    case "claude":
      return parseClaudeUsageOutput(text);
    default:
      return null;
  }
}

function getLatestUsageLogFile(cwd, provider) {
  const resolvedCwd = resolveUsageProbeCwd(cwd);
  const matcher = (_fullPath, name) =>
    new RegExp(`^therminal-${provider}-.*\\.log$`, "i").test(name);
  return getSortedFiles(resolvedCwd, matcher, false)[0] || null;
}

function getUsageSummaryFromLog(provider, cwd) {
  const latestLog = getLatestUsageLogFile(cwd, provider);
  if (!latestLog) {
    return null;
  }

  const parsed = parseUsageProbeOutput(provider, stripAnsiOutput(readTailUtf8(latestLog.path, 262144)));
  if (!parsed) {
    return null;
  }

  return {
    summary: parsed,
    filePath: latestLog.path,
    sourceLabel: "Project log"
  };
}

async function probeUsageProvider(provider, cwd) {
  const plan = USAGE_PROBE_PLANS[provider];
  const command = PROVIDERS[provider]?.defaultCommand;

  if (!plan || !command) {
    return null;
  }

  return await new Promise((resolve) => {
    let rawOutput = "";
    let attempt = 0;
    let settled = false;

    const probe = pty.spawn(getPreferredShell(), getShellArgs(command), {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: process.env
    });

    const cleanup = () => {
      clearTimeout(initialSendTimer);
      clearTimeout(timeoutTimer);
      for (const timer of retryTimers) {
        clearTimeout(timer);
      }

      try {
        probe.kill();
      } catch {
        // Ignore background probe teardown failures.
      }
    };

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const tryParse = () => parseUsageProbeOutput(provider, stripAnsiOutput(rawOutput));

    const sendCommand = () => {
      if (settled) {
        return;
      }

      attempt += 1;

      try {
        probe.write("\r");
        setTimeout(() => {
          if (!settled) {
            probe.write(`${plan.command}\r`);
          }
        }, 220);
      } catch {
        finish(null);
        return;
      }

      if (attempt > plan.maxRetries) {
        return;
      }

      const retryTimer = setTimeout(() => {
        const parsed = tryParse();
        if (parsed) {
          finish(parsed);
          return;
        }
        sendCommand();
      }, plan.retryDelay);

      retryTimers.push(retryTimer);
    };

    const retryTimers = [];
    const initialSendTimer = setTimeout(sendCommand, plan.initialDelay);
    const timeoutTimer = setTimeout(() => finish(tryParse()), plan.timeoutMs);

    probe.onData((chunk) => {
      rawOutput += chunk;
      if (!plan.successPattern.test(stripAnsiOutput(rawOutput))) {
        return;
      }

      const parsed = tryParse();
      if (parsed) {
        finish(parsed);
      }
    });

    probe.onExit(() => {
      finish(tryParse());
    });
  });
}

function buildUsagePanelErrorItem(id, name, error, sourceLabel = "CLI command") {
  return {
    id,
    name,
    status: "error",
    sourceLabel,
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "Richiesta fallita."
  };
}

function buildCodexUsagePanelItem(summary, sourceLabel = "CLI /status") {
  return {
    id: "codex",
    name: "Codex",
    status: "ok",
    sourceLabel,
    checkedAt: new Date().toISOString(),
    summary: "Codex CLI",
    metrics: [
      {
        label: "5h limit",
        value: `${numberOrZero(summary?.primaryLeftPercent)}% left`,
        meta: summary?.primaryResetLabel ? `Reset ${summary.primaryResetLabel}` : "Reset n/d"
      },
      {
        label: "Weekly limit",
        value: `${numberOrZero(summary?.secondaryLeftPercent)}% left`,
        meta: summary?.secondaryResetLabel ? `Reset ${summary.secondaryResetLabel}` : "Reset n/d"
      }
    ]
  };
}

function buildGeminiUsagePanelItem(summary, sourceLabel = "CLI /stats") {
  const summaryParts = [summary?.tier, summary?.toolCalls ? `Tool calls ${summary.toolCalls}` : null]
    .filter(Boolean)
    .join(" · ");

  return {
    id: "gemini",
    name: "Gemini",
    status: "ok",
    sourceLabel,
    checkedAt: new Date().toISOString(),
    summary: summaryParts || summary?.authMethod || "Gemini CLI",
    metrics: (summary?.models || []).slice(0, 4).map((row) => ({
      label: row.model,
      value: `${numberOrZero(row.usedPercent)}% used`,
      meta: row.resetLabel ? `Reset ${row.resetLabel}` : "Reset n/d"
    }))
  };
}

function buildClaudeUsagePanelItem(summary, sourceLabel = "CLI /usage") {
  const extraValue =
    summary?.extraSpent && summary?.extraLimit
      ? `${numberOrZero(summary?.extraUsedPercent)}% used`
      : `${numberOrZero(summary?.extraUsedPercent)}% used`;

  return {
    id: "claude",
    name: "Claude",
    status: "ok",
    sourceLabel,
    checkedAt: new Date().toISOString(),
    summary: "Claude CLI",
    metrics: [
      {
        label: "Current session",
        value: `${numberOrZero(summary?.currentSessionUsedPercent)}% used`,
        meta: summary?.currentSessionResetLabel
          ? `Reset ${summary.currentSessionResetLabel}`
          : "Reset n/d"
      },
      {
        label: "Current week",
        value: `${numberOrZero(summary?.currentWeekUsedPercent)}% used`,
        meta: summary?.currentWeekResetLabel ? `Reset ${summary.currentWeekResetLabel}` : "Reset n/d"
      },
      {
        label: "Extra usage",
        value: extraValue,
        meta:
          summary?.extraSpent && summary?.extraLimit
            ? `$${summary.extraSpent} / $${summary.extraLimit}${summary?.extraResetLabel ? ` · Reset ${summary.extraResetLabel}` : ""}`
            : summary?.extraResetLabel
              ? `Reset ${summary.extraResetLabel}`
              : "Reset n/d"
      }
    ]
  };
}

function buildClaudeTokenUsagePanelItem(summary, sourceLabel = "Session tokens") {
  return {
    id: "claude",
    name: "Claude",
    status: "ok",
    sourceLabel,
    checkedAt: new Date().toISOString(),
    summary: summary?.model || "Claude session",
    metrics: [
      {
        label: "Total tokens",
        value: `${numberOrZero(summary?.totalTokens)}`,
        meta: summary?.lastUpdated ? `Update ${summary.lastUpdated}` : "Session data"
      },
      {
        label: "Input tokens",
        value: `${numberOrZero(summary?.inputTokens)}`,
        meta: `Cache read ${numberOrZero(summary?.cacheReadTokens)}`
      },
      {
        label: "Output tokens",
        value: `${numberOrZero(summary?.outputTokens)}`,
        meta: `Cache write ${numberOrZero(summary?.cacheCreationTokens)}`
      }
    ]
  };
}

function buildUsagePanelItem(provider, summary, sourceLabel) {
  switch (provider) {
    case "codex":
      return buildCodexUsagePanelItem(summary, sourceLabel);
    case "gemini":
      return buildGeminiUsagePanelItem(summary, sourceLabel);
    case "claude":
      return buildClaudeUsagePanelItem(summary, sourceLabel);
    default:
      return null;
  }
}

async function getUsagePanelProvider({ provider, force = false, cwd } = {}) {
  if (!USAGE_PROBE_PLANS[provider]) {
    return buildUsagePanelErrorItem(provider, provider, new Error("Provider non supportato."));
  }

  const resolvedCwd = resolveUsageProbeCwd(cwd);
  const cacheKey = `${provider}:${resolvedCwd}`;
  const cached = usagePanelItemCache.get(cacheKey);

  if (!force && cached?.data && Date.now() - cached.timestamp < USAGE_PANEL_CACHE_TTL_MS) {
    return cached.data;
  }

  if (!force && cached?.promise) {
    return cached.promise;
  }

  const promise = (async () => {
    const liveSummary = await probeUsageProvider(provider, resolvedCwd);
    if (liveSummary) {
      const item = buildUsagePanelItem(
        provider,
        liveSummary,
        `CLI /${USAGE_PROBE_PLANS[provider].command.slice(1)}`
      );
      usagePanelItemCache.set(cacheKey, { timestamp: Date.now(), data: item });
      return item;
    }

    const logSummary = getUsageSummaryFromLog(provider, resolvedCwd);
    if (logSummary?.summary) {
      const item = buildUsagePanelItem(provider, logSummary.summary, logSummary.sourceLabel);
      usagePanelItemCache.set(cacheKey, { timestamp: Date.now(), data: item });
      return item;
    }

    if (provider === "claude") {
      const sessionTokenSummary = getClaudeUsageSummary(resolvedCwd);
      if (sessionTokenSummary) {
        const item = buildClaudeTokenUsagePanelItem(sessionTokenSummary);
        usagePanelItemCache.set(cacheKey, { timestamp: Date.now(), data: item });
        return item;
      }
    }

    const errorItem = buildUsagePanelErrorItem(
      provider,
      provider === "codex" ? "Codex" : provider === "gemini" ? "Gemini" : "Claude",
      new Error("Nessun output valido."),
      `CLI /${USAGE_PROBE_PLANS[provider].command.slice(1)}`
    );
    usagePanelItemCache.set(cacheKey, { timestamp: Date.now(), data: errorItem });
    return errorItem;
  })().catch((error) => {
    usagePanelItemCache.delete(cacheKey);
    return buildUsagePanelErrorItem(
      provider,
      provider === "codex" ? "Codex" : provider === "gemini" ? "Gemini" : "Claude",
      error,
      `CLI /${USAGE_PROBE_PLANS[provider].command.slice(1)}`
    );
  });

  usagePanelItemCache.set(cacheKey, {
    timestamp: Date.now(),
    promise
  });

  return await promise;
}

async function getUsagePanelSummary({ force = false, cwd } = {}) {
  const resolvedCwd = resolveUsageProbeCwd(cwd);
  const items = await Promise.all([
    getUsagePanelProvider({ provider: "codex", force, cwd: resolvedCwd }),
    getUsagePanelProvider({ provider: "gemini", force, cwd: resolvedCwd }),
    getUsagePanelProvider({ provider: "claude", force, cwd: resolvedCwd })
  ]);

  return {
    cwd: resolvedCwd,
    refreshedAt: new Date().toISOString(),
    items
  };
}

function normalizeStatuspageSeverity(indicator) {
  switch (indicator) {
    case "minor":
      return "degraded";
    case "major":
    case "critical":
      return "major";
    case "none":
      return "operational";
    default:
      return "unknown";
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Therminal/1.0.0"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Therminal/1.0.0"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function wait(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function scrapeRenderedPageSnapshot(url, {
  timeoutMs = STATUS_PAGE_RENDER_TIMEOUT_MS,
  settleMs = STATUS_PAGE_RENDER_SETTLE_MS
} = {}) {
  let scraperWindow = null;

  const destroyWindow = () => {
    if (scraperWindow && !scraperWindow.isDestroyed()) {
      scraperWindow.destroy();
    }
    scraperWindow = null;
  };

  try {
    scraperWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: `status-scrape-${crypto.randomUUID()}`
      }
    });

    return await new Promise((resolve, reject) => {
      let completed = false;

      const finish = (error, result) => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timeout);
        destroyWindow();
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };

      const timeout = setTimeout(() => {
        finish(new Error("Timeout during status page render."));
      }, timeoutMs);

      scraperWindow.webContents.once("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        finish(new Error(errorDescription || `Load failed (${errorCode}) for ${validatedURL || url}`));
      });

      scraperWindow.webContents.once("did-finish-load", async () => {
        try {
          await wait(settleMs);
          const snapshot = await scraperWindow.webContents.executeJavaScript(`
            (() => {
              return {
                html: document.documentElement ? document.documentElement.outerHTML : ""
              };
            })();
          `, true);

          finish(null, snapshot);
        } catch (error) {
          finish(error);
        }
      });

      scraperWindow.loadURL(url).catch((error) => {
        finish(error);
      });
    });
  } finally {
    destroyWindow();
  }
}

function extractAiStudioStatusFromSnapshot(snapshot) {
  const html = String(snapshot?.html || "");
  const normalizedHtml = html.toLowerCase();

  const decodeHtmlEntities = (value) => String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

  const extractIncidentTitle = (testId) => {
    const regex = new RegExp(
      `<span[^>]*data-testid=["']${testId}["'][^>]*>([\\s\\S]*?)<\\/span>`,
      "i"
    );
    const match = html.match(regex);
    if (!match) {
      return "";
    }
    return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  };

  const partialOutageTitle = extractIncidentTitle("partial-outage-incident-title");
  if (partialOutageTitle) {
    return {
      severity: "degraded",
      label: "Partial outage",
      detail: partialOutageTitle
    };
  }

  const majorOutageTitle = extractIncidentTitle("major-outage-incident-title");
  if (majorOutageTitle) {
    return {
      severity: "major",
      label: "Major outage",
      detail: majorOutageTitle
    };
  }

  const incidentTitle = extractIncidentTitle("incident-title");
  if (incidentTitle) {
    return {
      severity: "degraded",
      label: "Incident reported",
      detail: incidentTitle
    };
  }

  if (!normalizedHtml) {
    return null;
  }

  if (normalizedHtml.includes("all systems operational") || normalizedHtml.includes("no incidents reported")) {
    return {
      severity: "operational",
      label: "All Systems Operational",
      detail: "Nessun incidente segnalato."
    };
  }

  return null;
}

function buildStatuspageStatus({ id, name, host, url, payload }) {
  const incidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
  const activeIncidents = incidents.filter((incident) => incident?.status !== "resolved");
  const headline = payload?.status?.description || "Status unavailable";
  const topIncident = activeIncidents[0]?.name;
  const incidentSuffix =
    activeIncidents.length > 1 ? ` (+${activeIncidents.length - 1} altri incidenti)` : "";

  return {
    id,
    name,
    host,
    url,
    severity: normalizeStatuspageSeverity(payload?.status?.indicator),
    label: headline,
    detail: topIncident ? `${headline}. ${topIncident}${incidentSuffix}` : headline,
    sourceLabel: "Status ufficiale",
    checkedAt: payload?.page?.updated_at || new Date().toISOString()
  };
}

function buildHtmlFallbackStatus({ id, name, host, url, html }) {
  const normalized = String(html || "").toLowerCase();
  const hasIssues = normalized.includes("currently experiencing issues");
  const isOperational = normalized.includes("fully operational");

  return {
    id,
    name,
    host,
    url,
    severity: hasIssues ? "degraded" : isOperational ? "operational" : "unknown",
    label: hasIssues ? "Issues reported" : isOperational ? "Operational" : "Unknown",
    detail: hasIssues
      ? "La status page segnala problemi in corso."
      : isOperational
        ? "La status page segnala operativita regolare."
        : "Impossibile dedurre lo stato dalla pagina HTML.",
    sourceLabel: "Status page HTML",
    checkedAt: new Date().toISOString()
  };
}

function buildServiceStatusError({ id, name, host, url, error, sourceLabel }) {
  return {
    id,
    name,
    host,
    url,
    severity: "unknown",
    label: "Unavailable",
    detail: error instanceof Error ? error.message : "Richiesta fallita.",
    sourceLabel,
    checkedAt: new Date().toISOString()
  };
}

async function getOpenAIServiceStatus() {
  const name = "OpenAI";
  const host = "status.openai.com";
  const url = "https://status.openai.com";

  try {
    const payload = await fetchJsonWithTimeout(`${url}/api/v2/summary.json`);
    return buildStatuspageStatus({ id: "openai", name, host, url, payload });
  } catch (error) {
    try {
      const html = await fetchTextWithTimeout(url);
      return buildHtmlFallbackStatus({ id: "openai", name, host, url, html });
    } catch (fallbackError) {
      return buildServiceStatusError({
        id: "openai",
        name,
        host,
        url,
        error: fallbackError || error,
        sourceLabel: "Status ufficiale"
      });
    }
  }
}

async function getClaudeServiceStatus() {
  const name = "Claude";
  const host = "status.claude.com";
  const url = "https://status.claude.com";

  try {
    const payload = await fetchJsonWithTimeout(`${url}/api/v2/summary.json`);
    return buildStatuspageStatus({ id: "claude", name, host, url, payload });
  } catch (error) {
    try {
      const html = await fetchTextWithTimeout(url);
      return buildHtmlFallbackStatus({ id: "claude", name, host, url, html });
    } catch (fallbackError) {
      return buildServiceStatusError({
        id: "claude",
        name,
        host,
        url,
        error: fallbackError || error,
        sourceLabel: "Status ufficiale"
      });
    }
  }
}

async function getAiStudioServiceStatus() {
  const id = "aistudio";
  const name = "AI Studio";
  const host = "aistudio.google.com/status";
  const url = "https://aistudio.google.com/status";

  try {
    const snapshot = await scrapeRenderedPageSnapshot(url);
    const parsedStatus = extractAiStudioStatusFromSnapshot(snapshot);

    if (parsedStatus) {
      return {
        id,
        name,
        host,
        url,
        ...parsedStatus,
        sourceLabel: "Status page DOM",
        checkedAt: new Date().toISOString()
      };
    }

    return {
      id,
      name,
      host,
      url,
      severity: "unknown",
      label: "Status not exposed",
      detail: "La status page e stata renderizzata, ma il DOM finale non espone uno stato leggibile in chiaro.",
      sourceLabel: "Status page DOM",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return buildServiceStatusError({
      id,
      name,
      host,
      url,
      error,
      sourceLabel: "Status page"
    });
  }
}

async function getServiceStatuses(force = false) {
  const cacheIsFresh =
    serviceStatusCache &&
    serviceStatusCache.data &&
    Date.now() - serviceStatusCache.timestamp < SERVICE_STATUS_CACHE_TTL_MS;

  if (!force && cacheIsFresh) {
    return serviceStatusCache.data;
  }

  if (!force && serviceStatusCache?.promise) {
    return serviceStatusCache.promise;
  }

  const promise = Promise.all([
    getOpenAIServiceStatus(),
    getClaudeServiceStatus(),
    getAiStudioServiceStatus()
  ]).then((services) => {
    const data = {
      refreshedAt: new Date().toISOString(),
      services
    };

    serviceStatusCache = {
      timestamp: Date.now(),
      data
    };

    return data;
  });

  serviceStatusCache = {
    timestamp: Date.now(),
    promise
  };

  try {
    return await promise;
  } catch {
    serviceStatusCache = null;
    return {
      refreshedAt: new Date().toISOString(),
      services: []
    };
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    show: false,
    icon: path.join(__dirname, "logo.png"),
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  if (process.platform !== "darwin") {
    // Remove the native menu so Alt doesn't toggle it on Windows/Linux.
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const key = String(input.key || "").toLowerCase();
    const wantsDevTools =
      key === "f12" ||
      ((input.control || input.meta) && input.shift && key === "i");

    if (!wantsDevTools) {
      return;
    }

    event.preventDefault();

    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
      return;
    }

    mainWindow.webContents.openDevTools({ mode: "detach", activate: true });
  });

  mainWindow.maximize();
  mainWindow.show();

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  return mainWindow;
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createMainWindow();

    // Quake-style global toggle: Ctrl+`
    globalShortcut.register("CommandOrControl+`", () => {
      if (!mainWindow) {
        createMainWindow();
        return;
      }
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on("before-quit", () => {
  stopWhisperServerRuntime();
  closeAllSessions();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("providers:list", (_event, payload = {}) => {
  return getProviderCatalog(Boolean(payload?.force));
});

ipcMain.handle("session:create", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) {
    throw new Error("Finestra non disponibile.");
  }

  const { provider, command, cwd } = sanitizeSessionPayload(payload);
  const sessionId = crypto.randomUUID();
  const ptyProcess = pty.spawn(getPreferredShell(), getShellArgs(command), {
    name: "xterm-256color",
    cols: 120,
    rows: 32,
    cwd,
    env: process.env
  });

  sessionMap.set(sessionId, {
    pty: ptyProcess,
    provider,
    command,
    cwd,
    webContents: event.sender
  });
  invalidateUsageSummaryCache();

  ptyProcess.onData((data) => {
    const session = sessionMap.get(sessionId);
    if (!session || session.webContents.isDestroyed()) {
      return;
    }
    session.webContents.send("session:data", {
      id: sessionId,
      data
    });
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    const session = sessionMap.get(sessionId);
    if (!session) {
      return;
    }

    if (!session.webContents.isDestroyed()) {
      session.webContents.send("session:exit", {
        id: sessionId,
        exitCode,
        signal
      });
    }

    sessionMap.delete(sessionId);
    invalidateUsageSummaryCache();
  });

  return {
    id: sessionId,
    provider,
    command,
    cwd
  };
});

ipcMain.on("session:write", (_event, payload) => {
  const session = sessionMap.get(payload?.id);
  if (!session || typeof payload?.data !== "string") {
    return;
  }

  session.pty.write(payload.data);
});

ipcMain.on("session:resize", (_event, payload) => {
  const session = sessionMap.get(payload?.id);
  if (!session) {
    return;
  }

  const cols = Number(payload?.cols);
  const rows = Number(payload?.rows);

  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) {
    return;
  }

  try {
    session.pty.resize(cols, rows);
  } catch {
    // Ignore transient resize errors (usually during fast DOM reflow).
  }
});

ipcMain.on("session:close", (_event, payload) => {
  const session = sessionMap.get(payload?.id);
  if (!session) {
    return;
  }

  try {
    session.pty.kill();
  } catch {
    // Ignore forced shutdown failures.
  }

  sessionMap.delete(payload.id);
  invalidateUsageSummaryCache();
});

ipcMain.on("session:close-all", () => {
  closeAllSessions();
});

// ─── Presets ──────────────────────────────────────────────

// ─── Saved Sessions ──────────────────────────────────────

function loadSessionsFile() {
  try {
    const p = getSessionPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch {}
  return {};
}

function saveSessionsFile(data) {
  fs.writeFileSync(getSessionPath(), JSON.stringify(data, null, 2), "utf8");
}

ipcMain.handle("sessions:list", () => loadSessionsFile());

ipcMain.handle("sessions:save", (_event, { name, config }) => {
  const sessions = loadSessionsFile();
  sessions[name] = config;
  saveSessionsFile(sessions);
  return true;
});

ipcMain.handle("sessions:delete", (_event, name) => {
  const sessions = loadSessionsFile();
  delete sessions[name];
  saveSessionsFile(sessions);
  return true;
});

// ─── Presets ──────────────────────────────────────────────

ipcMain.handle("presets:list", () => loadPresetsFile());

ipcMain.handle("presets:save", (_event, { name, config }) => {
  const presets = loadPresetsFile();
  presets[name] = config;
  savePresetsFile(presets);
  return true;
});

ipcMain.handle("presets:delete", (_event, name) => {
  const presets = loadPresetsFile();
  delete presets[name];
  savePresetsFile(presets);
  return true;
});

// ─── Shell & Dialog ───────────────────────────────────────

ipcMain.handle("shell:open-external", (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return shell.openExternal(url);
    }
  } catch {}
  return false;
});

ipcMain.handle("system:metrics", () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    cpuPercent: getCpuPercent(),
    memUsedPercent: Math.round((usedMem / totalMem) * 100),
    memUsedGB: +(usedMem / 1073741824).toFixed(1),
    memTotalGB: +(totalMem / 1073741824).toFixed(1),
  };
});

ipcMain.handle("usage:summary", () => getUsageSummary());
ipcMain.handle("usage:panel", (_event, payload) => getUsagePanelSummary(payload || {}));
ipcMain.handle("usage:panel-provider", (_event, payload) => getUsagePanelProvider(payload || {}));
ipcMain.handle("services:status", (_event, payload) => getServiceStatuses(Boolean(payload?.force)));
ipcMain.handle("git:status", (_event, payload) => getGitStatusSummary(payload || {}));

ipcMain.handle("dialog:open-directory", async (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win || undefined, {
    title: "Seleziona working directory",
    defaultPath: getExistingDirectory(payload.defaultPath),
    properties: ["openDirectory"]
  });

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:open-file", async (event, payload = {}) => {
  return await showOpenFileDialog(event, payload);
});

ipcMain.handle("dialog:save-file", async (event, { defaultFilename, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultFilename,
    filters: [
      { name: "Log files", extensions: ["log", "txt"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, "utf8");
    return result.filePath;
  }
  return null;
});

ipcMain.handle("clipboard:read-text", () => clipboard.readText());
ipcMain.handle("clipboard:write-text", (_event, text) => {
  clipboard.writeText(typeof text === "string" ? text : "");
  return true;
});

ipcMain.handle("voice:get-config", () => loadVoiceConfigFile());
ipcMain.handle("voice:save-config", (_event, payload) => {
  return saveVoiceConfigFile(payload);
});
ipcMain.handle("voice:warmup", async () => {
  return await warmLocalWhisperModel();
});
ipcMain.handle("voice:transcribe", async (_event, payload = {}) => {
  return await transcribeVoice(payload.audioData);
});

