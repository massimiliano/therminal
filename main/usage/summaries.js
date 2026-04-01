const fs = require("fs");
const os = require("os");
const path = require("path");
const pty = require("node-pty");

const { PROVIDERS } = require("../constants");
const { getPreferredShell, getShellArgs } = require("../session");
const {
  getSortedFiles,
  numberOrZero,
  readJsonFile,
  readTailUtf8,
  stripAnsiOutput
} = require("./shared");

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

function createUsageSummaryManager({ getLatestActiveSession }) {
  let usageSummaryCache = null;

  function invalidateUsageSummaryCache() {
    usageSummaryCache = null;
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
      Date.now() - usageSummaryCache.timestamp < 60000
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

  return {
    getUsageSummary,
    invalidateUsageSummaryCache
  };
}

module.exports = {
  createUsageSummaryManager,
  getClaudeUsageSummary,
  parseCodexStatusOutput
};
