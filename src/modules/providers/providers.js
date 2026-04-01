import { providerCatalog } from "../state.js";
import { dom } from "../dom.js";
import { showNotice } from "../notices.js";

let providerBannerDismissed = false;

function replaceProviderCatalog(nextCatalog) {
  for (const key of Object.keys(providerCatalog)) {
    delete providerCatalog[key];
  }

  for (const [key, value] of Object.entries(nextCatalog || {})) {
    providerCatalog[key] = value;
  }
}

export function getProviderLabel(providerKey) {
  return providerCatalog[providerKey]?.label || providerKey;
}

export function getFirstAvailableProvider() {
  for (const [key, provider] of Object.entries(providerCatalog)) {
    if (provider?.available !== false) {
      return key;
    }
  }
  return "terminal";
}

export function getUnavailableProviders(providerKeys = []) {
  const unique = new Set();
  for (const key of providerKeys) {
    if (providerCatalog[key]?.available === false) {
      unique.add(key);
    }
  }
  return Array.from(unique);
}

export function buildUnavailableProvidersMessage(providerKeys = []) {
  const labels = providerKeys.map((key) => getProviderLabel(key));
  if (labels.length === 0) {
    return "";
  }
  if (labels.length === 1) {
    return `${labels[0]} non \u00E8 installato o non \u00E8 nel PATH.`;
  }
  return `${labels.join(", ")} non sono installati o non sono nel PATH.`;
}

export function renderProviderAvailabilityBanner() {
  if (!dom.providerStatusBanner || !dom.providerStatusText) return;

  const missing = Object.entries(providerCatalog)
    .filter(([, provider]) => provider?.kind === "cli" && provider.available === false)
    .map(([key]) => key);

  if (missing.length === 0) {
    dom.providerStatusBanner.classList.add("hidden");
    dom.providerStatusText.textContent = "";
    providerBannerDismissed = false;
    return;
  }

  if (providerBannerDismissed) {
    dom.providerStatusBanner.classList.add("hidden");
    return;
  }

  dom.providerStatusText.textContent =
    `${buildUnavailableProvidersMessage(missing)} Installa i CLI mancanti e poi premi "Rileva di nuovo". Nel frattempo puoi usare i provider disponibili o il Terminale.`;
  dom.providerStatusBanner.classList.remove("hidden");
}

export async function refreshProviderCatalog(force = false) {
  const nextCatalog = await window.launcherAPI.listProviders({ force });
  replaceProviderCatalog(nextCatalog);
  if (force) {
    providerBannerDismissed = false;
  }
  renderProviderAvailabilityBanner();
  return providerCatalog;
}

export function dismissProviderAvailabilityBanner() {
  providerBannerDismissed = true;
  dom.providerStatusBanner?.classList.add("hidden");
}

export async function validateProviderSelection(providerKeys, { force = true, notify = true } = {}) {
  if (force) {
    await refreshProviderCatalog(true);
  }

  const unavailable = getUnavailableProviders(providerKeys);
  if (unavailable.length === 0) {
    return { ok: true, unavailable: [] };
  }

  const message = `${buildUnavailableProvidersMessage(unavailable)} Installa i CLI mancanti oppure cambia provider.`;
  if (notify) {
    showNotice(message, { type: "warning", timeoutMs: 0 });
  }
  renderProviderAvailabilityBanner();

  return {
    ok: false,
    unavailable,
    message
  };
}
