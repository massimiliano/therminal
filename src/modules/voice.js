import { dom } from "./dom.js";
import { state, sessionStore, workspaces } from "./state.js";
import { hideNotice, showNotice } from "./notices.js";
import { getShortcutValue } from "./app-config.js";
import { formatShortcutLabel, parseShortcut, shortcutMatchesEvent } from "./shortcut-utils.js";

const TARGET_SAMPLE_RATE = 16000;
const MIN_RECORDING_MS = 180;
const DEFAULT_VOICE_PROVIDER = "local";
const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";

let voiceConfig = {
  provider: DEFAULT_VOICE_PROVIDER,
  whisperCliPath: "",
  modelPath: "",
  language: "it",
  autoSubmit: false,
  groqApiKey: "",
  groqModel: DEFAULT_GROQ_MODEL
};

let voiceCapture = createIdleCapture();
const pressedKeys = new Set();

function createIdleCapture() {
  return {
    phase: "idle",
    stream: null,
    audioContext: null,
    source: null,
    processor: null,
    sink: null,
    chunks: [],
    sampleRate: 0,
    sampleCount: 0,
    startedAt: 0
  };
}

function getVoiceProvider(config = voiceConfig) {
  return config?.provider === "groq" ? "groq" : DEFAULT_VOICE_PROVIDER;
}

function isGroqVoiceProvider(config = voiceConfig) {
  return getVoiceProvider(config) === "groq";
}

function getSelectedVoiceProvider() {
  return dom.voiceProviderSelect?.value === "groq" ? "groq" : DEFAULT_VOICE_PROVIDER;
}

function isVoiceConfigured(config = voiceConfig) {
  if (isGroqVoiceProvider(config)) {
    return Boolean(config?.groqApiKey && config?.groqModel);
  }

  return Boolean(config?.whisperCliPath && config?.modelPath);
}

function getVoiceConfigRequirementText(config = voiceConfig) {
  if (isGroqVoiceProvider(config)) {
    return "Configura Groq API key e modello cloud prima di usare il push-to-talk.";
  }

  return "Configura whisper-cli.exe e il modello locale prima di usare il push-to-talk.";
}

function getReadyVoiceDetail(config = voiceConfig) {
  const shortcutLabel = formatShortcutLabel(getShortcutValue("pushToTalk"));
  if (isGroqVoiceProvider(config)) {
    return `Tieni premuto ${shortcutLabel} nella finestra di Therminal per dettare via Groq (${config.groqModel || DEFAULT_GROQ_MODEL}).`;
  }

  return `Tieni premuto ${shortcutLabel} nella finestra di Therminal per dettare nella sessione attiva.`;
}

function getTranscribingVoiceDetail(config = voiceConfig) {
  if (isGroqVoiceProvider(config)) {
    return `Audio catturato. Sto eseguendo la trascrizione con Groq (${config.groqModel || DEFAULT_GROQ_MODEL}).`;
  }

  return "Audio catturato. Sto eseguendo la trascrizione locale con il modello configurato.";
}

function getToolbarReadyLabel(config = voiceConfig) {
  return isGroqVoiceProvider(config) ? "Groq" : "Local";
}

function renderVoiceProviderFields(provider = getSelectedVoiceProvider()) {
  const showGroq = provider === "groq";
  dom.voiceLocalFields?.classList.toggle("hidden", showGroq);
  dom.voiceGroqFields?.classList.toggle("hidden", !showGroq);
}

function truncateText(text, maxLength = 120) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function getVoiceStatusMeta() {
  const shortcutLabel = formatShortcutLabel(getShortcutValue("pushToTalk"));
  if (voiceCapture.phase === "recording") {
    return {
      label: "In ascolto",
      detail: `Microfono attivo. Rilascia ${shortcutLabel} per fermare e trascrivere.`,
      badgeClass: "border-red-500/35 bg-red-500/10 text-red-200",
      dotClass: "bg-red-400",
      toolbarClass: "border-red-500/35 bg-red-500/10 text-red-200",
      toolbarLabel: "REC"
    };
  }

  if (voiceCapture.phase === "transcribing") {
    return {
      label: "Trascrizione",
      detail: getTranscribingVoiceDetail(),
      badgeClass: "border-amber-500/35 bg-amber-500/10 text-amber-200",
      dotClass: "bg-amber-400",
      toolbarClass: "border-amber-500/35 bg-amber-500/10 text-amber-200",
      toolbarLabel: "STT"
    };
  }

  if (isVoiceConfigured()) {
    return {
      label: "Pronto",
      detail: getReadyVoiceDetail(),
      badgeClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
      dotClass: "bg-emerald-400",
      toolbarClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
      toolbarLabel: getToolbarReadyLabel()
    };
  }

  return {
    label: "Non configurato",
    detail: getVoiceConfigRequirementText(),
    badgeClass: "border-zinc-700/60 bg-th-body text-zinc-400",
    dotClass: "bg-zinc-500",
    toolbarClass: "border-zinc-700/60 bg-th-body text-zinc-500",
    toolbarLabel: "Off"
  };
}

function renderVoiceConfig() {
  if (dom.voiceProviderSelect) {
    dom.voiceProviderSelect.value = getVoiceProvider();
  }
  if (dom.voiceWhisperPathInput) {
    dom.voiceWhisperPathInput.value = voiceConfig.whisperCliPath || "";
  }
  if (dom.voiceModelPathInput) {
    dom.voiceModelPathInput.value = voiceConfig.modelPath || "";
  }
  if (dom.voiceGroqApiKeyInput) {
    dom.voiceGroqApiKeyInput.value = voiceConfig.groqApiKey || "";
  }
  if (dom.voiceGroqModelSelect) {
    dom.voiceGroqModelSelect.value = voiceConfig.groqModel || DEFAULT_GROQ_MODEL;
  }
  if (dom.voiceLanguageInput) {
    dom.voiceLanguageInput.value = voiceConfig.language || "it";
  }
  if (dom.voiceAutoSubmitCheckbox) {
    dom.voiceAutoSubmitCheckbox.checked = Boolean(voiceConfig.autoSubmit);
  }
  renderVoiceProviderFields(getVoiceProvider());
}

function renderVoiceStatus() {
  const meta = getVoiceStatusMeta();

  if (dom.voiceStatusBadge) {
    dom.voiceStatusBadge.className =
      `inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${meta.badgeClass}`;
  }
  if (dom.voiceStatusDot) {
    dom.voiceStatusDot.className = `inline-block w-1.5 h-1.5 rounded-full ${meta.dotClass}`;
  }
  if (dom.voiceStatusLabel) {
    dom.voiceStatusLabel.textContent = meta.label;
  }
  if (dom.voiceStatusText) {
    dom.voiceStatusText.textContent = meta.detail;
  }
  if (dom.voiceToolbarBadge) {
    dom.voiceToolbarBadge.className =
      `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide select-none ${meta.toolbarClass}`;
  }
  if (dom.voiceToolbarText) {
    dom.voiceToolbarText.textContent = meta.toolbarLabel;
  }
}

function getVoiceConfigPayload() {
  return {
    provider: getSelectedVoiceProvider(),
    whisperCliPath: dom.voiceWhisperPathInput?.value?.trim() || "",
    modelPath: dom.voiceModelPathInput?.value?.trim() || "",
    groqApiKey: dom.voiceGroqApiKeyInput?.value?.trim() || "",
    groqModel: dom.voiceGroqModelSelect?.value || DEFAULT_GROQ_MODEL,
    language: dom.voiceLanguageInput?.value?.trim() || "it",
    autoSubmit: Boolean(dom.voiceAutoSubmitCheckbox?.checked)
  };
}

async function refreshVoiceConfig() {
  voiceConfig = await window.launcherAPI.getVoiceConfig();
  renderVoiceConfig();
  renderVoiceStatus();
}

async function warmVoiceModel({ notify = false } = {}) {
  if (!window.launcherAPI?.warmVoiceModel || isGroqVoiceProvider() || !isVoiceConfigured()) {
    return null;
  }

  try {
    const result = await window.launcherAPI.warmVoiceModel();
    if (notify && result?.mode === "server" && result?.warmed) {
      showNotice("Configurazione voice salvata. Modello caricato in background.", {
        type: "success",
        timeoutMs: 2800
      });
      return result;
    }

    if (notify && result?.persistentAvailable && result?.error) {
      showNotice(`Configurazione voice salvata. Warmup non riuscito: ${result.error}`, {
        type: "warning",
        timeoutMs: 4200
      });
      return result;
    }

    return result;
  } catch {
    return null;
  }
}

async function pickVoiceBinary() {
  const selectedPath = await window.launcherAPI.openFileDialog({
    title: "Seleziona whisper-cli.exe",
    defaultPath: dom.voiceWhisperPathInput?.value?.trim() || undefined,
    filters: [
      { name: "Executable", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (selectedPath && dom.voiceWhisperPathInput) {
    dom.voiceWhisperPathInput.value = selectedPath;
  }
}

async function pickVoiceModel() {
  const selectedPath = await window.launcherAPI.openFileDialog({
    title: "Seleziona il modello Whisper",
    defaultPath: dom.voiceModelPathInput?.value?.trim() || undefined,
    filters: [
      { name: "Whisper model", extensions: ["bin"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (selectedPath && dom.voiceModelPathInput) {
    dom.voiceModelPathInput.value = selectedPath;
  }
}

async function saveVoiceSettings() {
  voiceConfig = await window.launcherAPI.saveVoiceConfig(getVoiceConfigPayload());
  renderVoiceConfig();
  renderVoiceStatus();
  const warmup = await warmVoiceModel({ notify: true });
  if (!warmup || (warmup.mode !== "server" && !warmup.error)) {
    showNotice("Configurazione voice salvata.", { type: "success", timeoutMs: 2500 });
  }
}

function matchesPushToTalkShortcut(event) {
  return shortcutMatchesEvent(event, getShortcutValue("pushToTalk"));
}

function isPushToTalkKey(event) {
  const parsed = parseShortcut(getShortcutValue("pushToTalk"));
  if (!parsed) {
    return false;
  }

  const groups = getPushToTalkGroups(parsed);
  return groups.some((group) => group.includes(event.code));
}

function isPushToTalkActive() {
  const parsed = parseShortcut(getShortcutValue("pushToTalk"));
  if (!parsed) {
    return false;
  }

  const groups = getPushToTalkGroups(parsed);
  return groups.length > 0 && groups.every((group) => group.some((code) => pressedKeys.has(code)));
}

function shortcutKeyToCode(key) {
  if (!key) {
    return "";
  }

  if (/^[A-Z]$/.test(key)) {
    return `Key${key}`;
  }

  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }

  if (key === "/") return "Slash";
  if (key === "`") return "Backquote";
  if (key === "Space") return "Space";
  if (key === "Enter") return "Enter";
  if (key === "Tab") return "Tab";
  if (key === "Escape") return "Escape";
  if (key === "-") return "Minus";
  return "";
}

function getPushToTalkGroups(parsed) {
  const groups = [];

  if (parsed.modifiers.has("CommandOrControl")) {
    groups.push(["ControlLeft", "ControlRight", "MetaLeft", "MetaRight"]);
  }
  if (parsed.modifiers.has("Meta")) {
    groups.push(["MetaLeft", "MetaRight"]);
  }
  if (parsed.modifiers.has("Alt")) {
    groups.push(["AltLeft", "AltRight"]);
  }
  if (parsed.modifiers.has("Shift")) {
    groups.push(["ShiftLeft", "ShiftRight"]);
  }

  const keyCode = shortcutKeyToCode(parsed.key);
  if (keyCode) {
    groups.push([keyCode]);
  }

  return groups;
}

function findActiveSessionId() {
  if (state.focusedSessionId && sessionStore.has(state.focusedSessionId)) {
    return state.focusedSessionId;
  }

  const activeWorkspace = workspaces.get(state.activeView);
  if (activeWorkspace?.clients?.length) {
    const activeClient = activeWorkspace.clients.find(
      (client) => client.sessionId && sessionStore.has(client.sessionId)
    );
    if (activeClient?.sessionId) {
      return activeClient.sessionId;
    }
  }

  const firstSession = sessionStore.keys().next();
  return firstSession.done ? null : firstSession.value;
}

function releaseVoiceResources(capture) {
  try {
    capture.source?.disconnect();
  } catch {}

  try {
    capture.processor?.disconnect();
  } catch {}

  try {
    capture.sink?.disconnect();
  } catch {}

  try {
    capture.stream?.getTracks?.().forEach((track) => track.stop());
  } catch {}

  const closeResult = capture.audioContext?.close?.();
  if (closeResult && typeof closeResult.then === "function") {
    return closeResult.catch(() => {});
  }

  return Promise.resolve();
}

function mergeFloat32Chunks(chunks, totalLength) {
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(buffer.length / sampleRateRatio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(
      buffer.length,
      Math.round((offsetResult + 1) * sampleRateRatio)
    );
    let accumulated = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
      accumulated += buffer[i];
      count += 1;
    }

    result[offsetResult] = count > 0 ? accumulated / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

async function startVoiceCapture() {
  if (voiceCapture.phase !== "idle") {
    return;
  }

  if (!isVoiceConfigured()) {
    showNotice(getVoiceConfigRequirementText(), {
      type: "warning",
      timeoutMs: 3500
    });
    return;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
    showNotice("Microfono o Web Audio API non disponibili in questa sessione Electron.", {
      type: "error"
    });
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const sink = audioContext.createGain();
    sink.gain.value = 0;

    voiceCapture = {
      phase: "recording",
      stream,
      audioContext,
      source,
      processor,
      sink,
      chunks: [],
      sampleRate: audioContext.sampleRate,
      sampleCount: 0,
      startedAt: Date.now()
    };

    processor.onaudioprocess = (audioEvent) => {
      if (voiceCapture.phase !== "recording") {
        return;
      }

      const inputChannel = audioEvent.inputBuffer.getChannelData(0);
      voiceCapture.chunks.push(new Float32Array(inputChannel));
      voiceCapture.sampleCount += inputChannel.length;
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioContext.destination);
    await audioContext.resume();
    renderVoiceStatus();
    showNotice(`Voice attivo: parla e rilascia ${formatShortcutLabel(getShortcutValue("pushToTalk"))} per trascrivere.`, {
      type: "info",
      timeoutMs: 0
    });
  } catch (error) {
    voiceCapture = createIdleCapture();
    renderVoiceStatus();
    showNotice(error?.message || "Impossibile attivare il microfono.", { type: "error" });
  }
}

async function stopVoiceCapture({ cancelled = false } = {}) {
  if (voiceCapture.phase !== "recording") {
    return;
  }

  const capture = voiceCapture;
  voiceCapture = {
    ...capture,
    phase: "transcribing"
  };
  renderVoiceStatus();

  await releaseVoiceResources(capture);
  hideNotice();

  try {
    if (cancelled || capture.sampleCount === 0) {
      return;
    }

    if (Date.now() - capture.startedAt < MIN_RECORDING_MS) {
      showNotice("Tieni premuta la shortcut un po' di piu prima di rilasciare.", {
        type: "warning",
        timeoutMs: 2200
      });
      return;
    }

    const merged = mergeFloat32Chunks(capture.chunks, capture.sampleCount);
    const resampled = downsampleBuffer(merged, capture.sampleRate, TARGET_SAMPLE_RATE);
    const wavBytes = encodeWav(resampled, TARGET_SAMPLE_RATE);

    if (wavBytes.byteLength <= 44) {
      showNotice("Audio troppo breve. Riprova tenendo premuta la shortcut un po' di piu.", {
        type: "warning",
        timeoutMs: 2500
      });
      return;
    }

    showNotice(`Trascrizione ${isGroqVoiceProvider() ? "Groq" : "locale"} in corso...`, {
      type: "info",
      timeoutMs: 0
    });
    const result = await window.launcherAPI.transcribeVoice(wavBytes);
    hideNotice();

    const text = String(result?.text || "").trim();
    if (!text) {
      showNotice("Nessun testo riconosciuto.", { type: "warning", timeoutMs: 2500 });
      return;
    }

    const sessionId = findActiveSessionId();
    if (!sessionId) {
      showNotice("Nessuna sessione attiva disponibile per inserire la trascrizione.", {
        type: "warning",
        timeoutMs: 3500
      });
      return;
    }

    const payload = `${text}${result?.autoSubmit ? "\r" : ""}`;
    window.launcherAPI.writeSession(sessionId, payload);
    sessionStore.get(sessionId)?.terminal?.focus?.();
    showNotice(`Trascritto: ${truncateText(text)}`, { type: "success", timeoutMs: 3500 });
  } catch (error) {
    hideNotice();
    showNotice(error?.message || "Trascrizione fallita.", { type: "error" });
  } finally {
    voiceCapture = createIdleCapture();
    renderVoiceStatus();
  }
}

function bindPushToTalkShortcut() {
  document.addEventListener(
    "keydown",
    (event) => {
      if (isPushToTalkKey(event)) {
        pressedKeys.add(event.code);
      }

      if (event.repeat && voiceCapture.phase !== "recording") {
        return;
      }

      const comboActive = isPushToTalkActive();
      if (!comboActive && !matchesPushToTalkShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (comboActive && voiceCapture.phase === "idle") {
        startVoiceCapture();
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      if (!isPushToTalkKey(event)) {
        return;
      }

      const wasActive = isPushToTalkActive();
      pressedKeys.delete(event.code);
      const isActiveAfterRelease = isPushToTalkActive();

      if (voiceCapture.phase !== "recording" || !wasActive || isActiveAfterRelease) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      stopVoiceCapture();
    },
    true
  );

  window.addEventListener("blur", () => {
    pressedKeys.clear();
    if (voiceCapture.phase === "recording") {
      stopVoiceCapture();
    }
  });
}

function bindVoiceUi() {
  dom.voiceProviderSelect?.addEventListener("change", () => {
    renderVoiceProviderFields(getSelectedVoiceProvider());
  });
  dom.voicePickBinaryBtn?.addEventListener("click", () => pickVoiceBinary());
  dom.voicePickModelBtn?.addEventListener("click", () => pickVoiceModel());
  dom.voiceSaveSettingsBtn?.addEventListener("click", () => saveVoiceSettings());
}

export async function initVoiceToText() {
  if (!window.launcherAPI?.getVoiceConfig) {
    return;
  }

  await refreshVoiceConfig();
  document.addEventListener("therminal:shortcuts-updated", () => renderVoiceStatus());
  bindVoiceUi();
  bindPushToTalkShortcut();
  void warmVoiceModel();
}
