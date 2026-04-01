const crypto = require("crypto");
const { BrowserWindow } = require("electron");

function createServiceStatusManager() {
  let serviceStatusCache = null;
  const SERVICE_STATUS_CACHE_TTL_MS = 240000;
  const STATUS_PAGE_RENDER_TIMEOUT_MS = 12000;
  const STATUS_PAGE_RENDER_SETTLE_MS = 2500;

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

  async function getGitHubServiceStatus() {
    const name = "GitHub";
    const host = "www.githubstatus.com";
    const url = "https://www.githubstatus.com";

    try {
      const payload = await fetchJsonWithTimeout(`${url}/api/v2/summary.json`);
      return buildStatuspageStatus({ id: "github", name, host, url, payload });
    } catch (error) {
      try {
        const html = await fetchTextWithTimeout(url);
        return buildHtmlFallbackStatus({ id: "github", name, host, url, html });
      } catch (fallbackError) {
        return buildServiceStatusError({
          id: "github",
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
      getGitHubServiceStatus(),
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

  return {
    getServiceStatuses
  };
}

module.exports = {
  createServiceStatusManager
};
