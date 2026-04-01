const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { app } = require("electron");

const {
  DEFAULT_GROQ_MODEL,
  DEFAULT_VOICE_CONFIG,
  DEFAULT_VOICE_PROVIDER,
  GROQ_STT_MODELS
} = require("../constants");

const GROQ_TRANSCRIPTION_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_REQUEST_TIMEOUT_MS = 120000;
const WHISPER_SERVER_HOST = "127.0.0.1";
const WHISPER_SERVER_READY_TIMEOUT_MS = 25000;
const WHISPER_SERVER_REQUEST_TIMEOUT_MS = 120000;
const WHISPER_SERVER_POLL_INTERVAL_MS = 250;
const WHISPER_SERVER_MAX_TRANSCRIBE_ATTEMPTS = 4;
const WHISPER_SERVER_LOG_TAIL_LIMIT = 4000;

let whisperServerRuntime = createWhisperServerRuntime();

function getVoiceConfigPath() {
  return path.join(app.getPath("userData"), "voice-config.json");
}

function normalizeVoiceConfig(payload = {}) {
  const enabled =
    typeof payload.enabled === "boolean" ? payload.enabled : DEFAULT_VOICE_CONFIG.enabled;
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
      : DEFAULT_GROQ_MODEL;

  return {
    enabled,
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

function normalizedBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function getVoiceRuntimeKey(payload = {}) {
  const config = normalizeVoiceConfig(payload);
  return JSON.stringify([
    normalizedBoolean(config.enabled, DEFAULT_VOICE_CONFIG.enabled),
    config.provider,
    config.whisperCliPath,
    config.modelPath,
    String(config.language || DEFAULT_VOICE_CONFIG.language).toLowerCase(),
    config.groqModel
  ]);
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
  if (!normalized.enabled) {
    return false;
  }

  if (normalized.provider === "groq") {
    return Boolean(normalized.groqApiKey && normalized.groqModel);
  }

  return Boolean(normalized.whisperCliPath && normalized.modelPath);
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

function getResolvedVoiceRuntimeConfig(payload = loadVoiceConfigFile()) {
  const config = normalizeVoiceConfig(payload);
  if (!config.enabled) {
    throw new Error("Voice integrato disabilitato.");
  }
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

function getResolvedGroqVoiceConfig(payload = loadVoiceConfigFile()) {
  const config = normalizeVoiceConfig(payload);
  if (!config.enabled) {
    throw new Error("Voice integrato disabilitato.");
  }
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

function registerVoiceIpcHandlers(ipcMain) {
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
}

module.exports = {
  loadVoiceConfigFile,
  registerVoiceIpcHandlers,
  stopWhisperServerRuntime
};
