import { dom } from "../dom.js";
import { state, sessionStore, workspaces } from "../state.js";
import { hideNotice, showNotice } from "../notices.js";
import { getShortcutValue } from "../app-config.js";
import { formatShortcutLabel } from "../shortcut-utils.js";
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_VOICE_PROVIDER,
  getSelectedVoiceProvider,
  getVoiceConfigPayload,
  getVoiceConfigRequirementText,
  getVoiceStatusMeta,
  isGroqVoiceProvider,
  isVoiceConfigured,
  isVoiceEnabled,
  renderVoiceConfig,
  renderVoiceProviderFields,
  renderVoiceStatus,
  truncateText
} from "./voice-ui.js";
import {
  MIN_RECORDING_MS,
  TARGET_SAMPLE_RATE,
  downsampleBuffer,
  encodeWav,
  mergeFloat32Chunks,
  releaseVoiceResources
} from "./voice-audio.js";
import {
  isPushToTalkActive,
  isPushToTalkKey,
  matchesPushToTalkShortcut
} from "./voice-shortcuts.js";

let voiceConfig = {
  enabled: true,
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

function renderCurrentVoiceConfig() {
  renderVoiceConfig(dom, voiceConfig);
}

function renderCurrentVoiceStatus() {
  renderVoiceStatus(
    dom,
    getVoiceStatusMeta({
      voiceCapture,
      voiceConfig,
      getShortcutValue,
      formatShortcutLabel
    })
  );
}

async function refreshVoiceConfig() {
  voiceConfig = await window.launcherAPI.getVoiceConfig();
  renderCurrentVoiceConfig();
  renderCurrentVoiceStatus();
}

async function warmVoiceModel({ notify = false } = {}) {
  if (
    !window.launcherAPI?.warmVoiceModel ||
    !isVoiceEnabled(voiceConfig) ||
    isGroqVoiceProvider(voiceConfig) ||
    !isVoiceConfigured(voiceConfig)
  ) {
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
  voiceConfig = await window.launcherAPI.saveVoiceConfig(getVoiceConfigPayload(dom));
  renderCurrentVoiceConfig();
  renderCurrentVoiceStatus();

  if (!isVoiceEnabled(voiceConfig)) {
    if (voiceCapture.phase === "recording") {
      await stopVoiceCapture({ cancelled: true });
    }
    showNotice("Voice integrato disattivato.", { type: "success", timeoutMs: 2500 });
    return;
  }

  const warmup = await warmVoiceModel({ notify: true });
  if (!warmup || (warmup.mode !== "server" && !warmup.error)) {
    showNotice("Configurazione voice salvata.", { type: "success", timeoutMs: 2500 });
  }
}

async function persistVoiceEnabledChange(enabled) {
  const previousEnabled = isVoiceEnabled(voiceConfig);
  voiceConfig = {
    ...voiceConfig,
    enabled
  };
  renderVoiceProviderFields(dom, voiceConfig, getSelectedVoiceProvider(dom));
  renderCurrentVoiceStatus();

  try {
    const savedConfig = await window.launcherAPI.saveVoiceConfig({
      ...voiceConfig,
      enabled
    });
    voiceConfig = {
      ...voiceConfig,
      enabled: Boolean(savedConfig?.enabled)
    };

    if (!isVoiceEnabled(voiceConfig) && voiceCapture.phase === "recording") {
      await stopVoiceCapture({ cancelled: true });
    }
  } catch (error) {
    voiceConfig = {
      ...voiceConfig,
      enabled: previousEnabled
    };
    if (dom.voiceEnabledCheckbox) {
      dom.voiceEnabledCheckbox.checked = previousEnabled;
    }
    renderVoiceProviderFields(dom, voiceConfig, getSelectedVoiceProvider(dom));
    renderCurrentVoiceStatus();
    showNotice(error?.message || "Impossibile salvare la preferenza voice.", {
      type: "error",
      timeoutMs: 3200
    });
  }
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

async function startVoiceCapture() {
  if (voiceCapture.phase !== "idle" || !isVoiceEnabled(voiceConfig)) {
    return;
  }

  if (!isVoiceConfigured(voiceConfig)) {
    showNotice(getVoiceConfigRequirementText(voiceConfig), {
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
    renderCurrentVoiceStatus();
    showNotice(
      `Voice attivo: parla e rilascia ${formatShortcutLabel(getShortcutValue("pushToTalk"))} per trascrivere.`,
      {
        type: "info",
        timeoutMs: 0
      }
    );
  } catch (error) {
    voiceCapture = createIdleCapture();
    renderCurrentVoiceStatus();
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
  renderCurrentVoiceStatus();

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

    showNotice(`Trascrizione ${isGroqVoiceProvider(voiceConfig) ? "Groq" : "locale"} in corso...`, {
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
    renderCurrentVoiceStatus();
  }
}

function bindPushToTalkShortcut() {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!isVoiceEnabled(voiceConfig)) {
        return;
      }

      if (isPushToTalkKey(event, getShortcutValue)) {
        pressedKeys.add(event.code);
      }

      if (event.repeat && voiceCapture.phase !== "recording") {
        return;
      }

      const comboActive = isPushToTalkActive(pressedKeys, getShortcutValue);
      if (!comboActive && !matchesPushToTalkShortcut(event, getShortcutValue)) {
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
      if (!isPushToTalkKey(event, getShortcutValue)) {
        return;
      }

      if (!isVoiceEnabled(voiceConfig)) {
        pressedKeys.delete(event.code);
        return;
      }

      const wasActive = isPushToTalkActive(pressedKeys, getShortcutValue);
      pressedKeys.delete(event.code);
      const isActiveAfterRelease = isPushToTalkActive(pressedKeys, getShortcutValue);

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
  dom.voiceEnabledCheckbox?.addEventListener("change", () => {
    void persistVoiceEnabledChange(Boolean(dom.voiceEnabledCheckbox?.checked));
  });
  dom.voiceProviderSelect?.addEventListener("change", () => {
    renderVoiceProviderFields(dom, voiceConfig, getSelectedVoiceProvider(dom));
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
  document.addEventListener("therminal:shortcuts-updated", () => renderCurrentVoiceStatus());
  bindVoiceUi();
  bindPushToTalkShortcut();
  void warmVoiceModel();
}
