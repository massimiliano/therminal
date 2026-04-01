const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { PROVIDERS } = require("../constants");

const PROVIDER_CACHE_TTL_MS = 15000;

let providerAvailabilityCache = null;

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

function registerProviderIpcHandlers(ipcMain) {
  ipcMain.handle("providers:list", (_event, payload = {}) => {
    return getProviderCatalog(Boolean(payload?.force));
  });
}

module.exports = {
  PROVIDERS,
  assertProviderAvailable,
  getProviderCatalog,
  registerProviderIpcHandlers,
  resolveCommandPath
};
