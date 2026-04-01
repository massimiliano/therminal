import { dom } from "../dom.js";
import { state, workspaces } from "../state.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PROVIDER_ORDER = ["codex", "gemini", "claude"];

let refreshTimer = null;
let latestRefreshId = 0;

const PROVIDER_META = {
  codex: {
    icon: "bi bi-cpu",
    label: "Codex"
  },
  gemini: {
    icon: "bi bi-google",
    label: "Gemini"
  },
  claude: {
    icon: "bi bi-lightning-charge",
    label: "Claude"
  }
};

function getActiveUsageCwd() {
  const activeWorkspace = workspaces.get(state.activeView);
  const activeClient = activeWorkspace?.clients?.find((client) => client.cwd);
  return activeClient?.cwd || dom.cwdInput?.value?.trim() || ".";
}

function formatTimestamp(value) {
  if (!value) return "n/d";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/d";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderUpdatedAtLoadingState() {
  if (!dom.usageSummaryUpdatedAt) return;
  dom.usageSummaryUpdatedAt.innerHTML =
    '<span class="th-skeleton th-skeleton-line inline-flex h-[12px] w-32 align-middle"></span>';
}

function createMetricRow(metric) {
  const row = document.createElement("div");
  row.className = "grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[12px]";

  const labelWrap = document.createElement("div");
  labelWrap.className = "min-w-0";

  const label = document.createElement("p");
  label.className = "text-zinc-300 truncate";
  label.textContent = metric.label || "Voce";

  const meta = document.createElement("p");
  meta.className = "text-[11px] text-zinc-500 truncate";
  meta.textContent = metric.meta || "";

  const value = document.createElement("span");
  value.className = "text-right font-mono text-zinc-100 whitespace-nowrap";
  value.textContent = metric.value || "n/d";

  labelWrap.append(label, meta);
  row.append(labelWrap, value);
  return row;
}

function buildUsageCard(item) {
  const card = document.createElement("article");
  card.className = "rounded-2xl border border-zinc-800/70 bg-th-bg/70 p-4 h-full flex flex-col";
  card.dataset.usageProvider = item.id;

  const meta = PROVIDER_META[item.id] || PROVIDER_META.codex;
  const isLoading = item.status === "loading";
  const isError = item.status === "error";

  const head = document.createElement("div");
  head.className = "flex items-start justify-between gap-3";

  const titleWrap = document.createElement("div");
  titleWrap.className = "min-w-0 flex-1";

  const titleRow = document.createElement("div");
  titleRow.className = "flex items-center gap-2";

  const icon = document.createElement("i");
  icon.className = `${meta.icon} text-zinc-400`;

  const title = document.createElement("h3");
  title.className = "text-sm font-semibold text-white";
  title.textContent = item.name || meta.label;

  const summary = document.createElement("p");
  summary.className = "text-[11px] text-zinc-500 mt-1";
  summary.textContent = item.summary || item.sourceLabel || "CLI usage";

  titleRow.append(icon, title);
  titleWrap.append(titleRow, summary);

  const badge = document.createElement("span");
  badge.className = isLoading
    ? "inline-flex items-center rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300"
    : isError
      ? "inline-flex items-center rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300"
      : "inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300";
  badge.textContent = isLoading ? "Loading" : isError ? "Unavailable" : "Live";

  head.append(titleWrap, badge);
  card.append(head);

  if (isLoading) {
    const metrics = document.createElement("div");
    metrics.className = "mt-3 flex flex-col gap-2";

    for (let i = 0; i < 3; i++) {
      const row = document.createElement("div");
      row.className = "grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start";
      row.innerHTML = `
        <div class="min-w-0 space-y-2">
          <span class="th-skeleton th-skeleton-line h-[11px] w-24"></span>
          <span class="th-skeleton th-skeleton-line h-[10px] w-20"></span>
        </div>
        <span class="th-skeleton th-skeleton-line h-[11px] w-14"></span>
      `;
      metrics.append(row);
    }

    metrics.classList.add("flex-1");
    card.append(metrics);
  } else if (isError) {
    const error = document.createElement("p");
    error.className = "mt-3 text-sm text-zinc-300 flex-1";
    error.textContent = item.error || "Impossibile recuperare i dati.";
    card.append(error);
  } else {
    const metrics = document.createElement("div");
    metrics.className = "mt-3 flex flex-col gap-2 flex-1";
    for (const metric of item.metrics || []) {
      metrics.append(createMetricRow(metric));
    }
    card.append(metrics);
  }

  const foot = document.createElement("div");
  foot.className = "mt-3 pt-3 border-t border-zinc-800/70 flex items-center justify-between gap-3 text-[11px] text-zinc-500";

  const source = document.createElement("span");
  source.textContent = item.sourceLabel || "CLI usage";

  const checkedAt = document.createElement("span");
  checkedAt.textContent = `Check ${formatTimestamp(item.checkedAt)}`;

  foot.append(source, checkedAt);
  card.append(foot);

  return card;
}

function replaceProviderCard(item) {
  if (!dom.usageSummaryList) {
    return;
  }

  const nextCard = buildUsageCard(item);
  const current = dom.usageSummaryList.querySelector(`[data-usage-provider="${item.id}"]`);

  if (current) {
    current.replaceWith(nextCard);
    return;
  }

  dom.usageSummaryList.append(nextCard);
}

function renderInitialState() {
  if (!dom.usageSummaryList) {
    return;
  }

  dom.usageSummaryList.innerHTML = "";
  renderUpdatedAtLoadingState();
  for (const provider of PROVIDER_ORDER) {
    replaceProviderCard({
      id: provider,
      name: PROVIDER_META[provider]?.label,
      status: "loading",
      sourceLabel: "CLI usage",
      checkedAt: null
    });
  }
}

async function refreshUsageSummary({ force = false } = {}) {
  if (!window.launcherAPI?.getUsagePanelProvider) {
    return;
  }

  const refreshId = latestRefreshId + 1;
  latestRefreshId = refreshId;

  if (dom.usageSummaryRefreshBtn) {
    dom.usageSummaryRefreshBtn.disabled = true;
    dom.usageSummaryRefreshBtn.classList.add("opacity-70");
  }

  renderInitialState();

  const cwd = getActiveUsageCwd();

  const requests = PROVIDER_ORDER.map((provider) =>
    window.launcherAPI
      .getUsagePanelProvider({ provider, cwd, force })
      .then((item) => {
        if (refreshId === latestRefreshId) {
          replaceProviderCard(item);
        }
        return item;
      })
      .catch((error) => {
        const fallbackItem = {
          id: provider,
          name: PROVIDER_META[provider]?.label,
          status: "error",
          sourceLabel: `CLI /${provider === "codex" ? "status" : provider === "gemini" ? "stats" : "usage"}`,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Richiesta fallita."
        };

        if (refreshId === latestRefreshId) {
          replaceProviderCard(fallbackItem);
        }

        return fallbackItem;
      })
  );

  const settled = await Promise.allSettled(requests);

  if (refreshId === latestRefreshId) {
    if (dom.usageSummaryUpdatedAt) {
      dom.usageSummaryUpdatedAt.textContent = formatTimestamp(new Date().toISOString());
    }
    if (dom.usageSummaryRefreshBtn) {
      dom.usageSummaryRefreshBtn.disabled = false;
      dom.usageSummaryRefreshBtn.classList.remove("opacity-70");
    }
  }

  return settled;
}

export function initUsagePanel() {
  if (!dom.usageSummaryList || !dom.usageSummaryRefreshBtn || !dom.usageSummaryUpdatedAt) {
    return;
  }

  dom.usageSummaryRefreshBtn.addEventListener("click", () => {
    refreshUsageSummary({ force: true });
  });

  refreshUsageSummary();

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    refreshUsageSummary();
  }, REFRESH_INTERVAL_MS);
}
