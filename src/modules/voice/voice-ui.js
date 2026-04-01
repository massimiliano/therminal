export const DEFAULT_VOICE_PROVIDER = "local";
export const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";

export function getVoiceProvider(config = {}) {
  return config?.provider === "groq" ? "groq" : DEFAULT_VOICE_PROVIDER;
}

export function isVoiceEnabled(config = {}) {
  return Boolean(config?.enabled);
}

export function isGroqVoiceProvider(config = {}) {
  return getVoiceProvider(config) === "groq";
}

export function getSelectedVoiceProvider(dom) {
  return dom.voiceProviderSelect?.value === "groq" ? "groq" : DEFAULT_VOICE_PROVIDER;
}

export function isVoiceConfigured(config = {}) {
  if (!isVoiceEnabled(config)) {
    return false;
  }

  if (isGroqVoiceProvider(config)) {
    return Boolean(config?.groqApiKey && config?.groqModel);
  }

  return Boolean(config?.whisperCliPath && config?.modelPath);
}

export function getVoiceConfigRequirementText(config = {}) {
  if (isGroqVoiceProvider(config)) {
    return "Configura Groq API key e modello cloud prima di usare il push-to-talk.";
  }

  return "Configura whisper-cli.exe e il modello locale prima di usare il push-to-talk.";
}

function getReadyVoiceDetail(config, getShortcutValue, formatShortcutLabel) {
  const shortcutLabel = formatShortcutLabel(getShortcutValue("pushToTalk"));
  if (isGroqVoiceProvider(config)) {
    return `Tieni premuto ${shortcutLabel} nella finestra di Therminal per dettare via Groq (${config.groqModel || DEFAULT_GROQ_MODEL}).`;
  }

  return `Tieni premuto ${shortcutLabel} nella finestra di Therminal per dettare nella sessione attiva.`;
}

function getTranscribingVoiceDetail(config) {
  if (isGroqVoiceProvider(config)) {
    return `Audio catturato. Sto eseguendo la trascrizione con Groq (${config.groqModel || DEFAULT_GROQ_MODEL}).`;
  }

  return "Audio catturato. Sto eseguendo la trascrizione locale con il modello configurato.";
}

function getToolbarReadyLabel(config) {
  return isGroqVoiceProvider(config) ? "Groq" : "Local";
}

export function renderVoiceProviderFields(dom, config, provider = getSelectedVoiceProvider(dom)) {
  const enabled = isVoiceEnabled(config);
  dom.voiceConfigFields?.classList.toggle("hidden", !enabled);
  if (!enabled) {
    dom.voiceLocalFields?.classList.add("hidden");
    dom.voiceGroqFields?.classList.add("hidden");
    return;
  }

  const showGroq = provider === "groq";
  dom.voiceLocalFields?.classList.toggle("hidden", showGroq);
  dom.voiceGroqFields?.classList.toggle("hidden", !showGroq);
}

export function truncateText(text, maxLength = 120) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function getVoiceStatusMeta({ voiceCapture, voiceConfig, getShortcutValue, formatShortcutLabel }) {
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
      detail: getTranscribingVoiceDetail(voiceConfig),
      badgeClass: "border-amber-500/35 bg-amber-500/10 text-amber-200",
      dotClass: "bg-amber-400",
      toolbarClass: "border-amber-500/35 bg-amber-500/10 text-amber-200",
      toolbarLabel: "STT"
    };
  }

  if (!isVoiceEnabled(voiceConfig)) {
    return {
      label: "Disattivato",
      detail: "Voice integrato disattivato. Puoi usare un sistema esterno senza configurare Therminal.",
      badgeClass: "border-zinc-700/60 bg-th-body text-zinc-400",
      dotClass: "bg-zinc-500",
      toolbarClass: "border-zinc-700/60 bg-th-body text-zinc-500",
      toolbarLabel: "Off"
    };
  }

  if (isVoiceConfigured(voiceConfig)) {
    return {
      label: "Pronto",
      detail: getReadyVoiceDetail(voiceConfig, getShortcutValue, formatShortcutLabel),
      badgeClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
      dotClass: "bg-emerald-400",
      toolbarClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
      toolbarLabel: getToolbarReadyLabel(voiceConfig)
    };
  }

  return {
    label: "Non configurato",
    detail: getVoiceConfigRequirementText(voiceConfig),
    badgeClass: "border-zinc-700/60 bg-th-body text-zinc-400",
    dotClass: "bg-zinc-500",
    toolbarClass: "border-zinc-700/60 bg-th-body text-zinc-500",
    toolbarLabel: "Off"
  };
}

export function renderVoiceConfig(dom, voiceConfig) {
  if (dom.voiceEnabledCheckbox) {
    dom.voiceEnabledCheckbox.checked = isVoiceEnabled(voiceConfig);
  }
  if (dom.voiceProviderSelect) {
    dom.voiceProviderSelect.value = getVoiceProvider(voiceConfig);
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
  renderVoiceProviderFields(dom, voiceConfig, getVoiceProvider(voiceConfig));
}

export function renderVoiceStatus(dom, meta) {
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

export function getVoiceConfigPayload(dom) {
  return {
    enabled: Boolean(dom.voiceEnabledCheckbox?.checked),
    provider: getSelectedVoiceProvider(dom),
    whisperCliPath: dom.voiceWhisperPathInput?.value?.trim() || "",
    modelPath: dom.voiceModelPathInput?.value?.trim() || "",
    groqApiKey: dom.voiceGroqApiKeyInput?.value?.trim() || "",
    groqModel: dom.voiceGroqModelSelect?.value || DEFAULT_GROQ_MODEL,
    language: dom.voiceLanguageInput?.value?.trim() || "it",
    autoSubmit: Boolean(dom.voiceAutoSubmitCheckbox?.checked)
  };
}
