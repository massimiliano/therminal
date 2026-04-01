const fs = require("fs");
const path = require("path");
const pty = require("node-pty");

const { PROVIDERS } = require("../constants");
const { getPreferredShell, getShellArgs } = require("../session");
const { numberOrZero, getSortedFiles, readTailUtf8, stripAnsiOutput } = require("./shared");
const { getClaudeUsageSummary, parseCodexStatusOutput } = require("./summaries");

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

function createUsagePanelManager({ getLatestActiveSession }) {
  const usagePanelItemCache = new Map();

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
      .join(" | ");

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
          value: `${numberOrZero(summary?.extraUsedPercent)}% used`,
          meta:
            summary?.extraSpent && summary?.extraLimit
              ? `$${summary.extraSpent} / $${summary.extraLimit}${summary?.extraResetLabel ? ` | Reset ${summary.extraResetLabel}` : ""}`
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

    if (!force && cached?.data && Date.now() - cached.timestamp < 240000) {
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

  return {
    getUsagePanelProvider,
    getUsagePanelSummary
  };
}

module.exports = {
  createUsagePanelManager
};
