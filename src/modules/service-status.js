import { dom } from "./dom.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let refreshTimer = null;
let refreshInFlight = null;
let latestRefreshId = 0;

const SERVICE_META = {
  openai: {
    icon: "bi bi-cpu",
    fallbackLabel: "status.openai.com"
  },
  claude: {
    icon: "bi bi-lightning-charge",
    fallbackLabel: "status.claude.com"
  },
  aistudio: {
    icon: "bi bi-google",
    fallbackLabel: "aistudio.google.com"
  }
};

function getSeverityClasses(severity) {
  switch (severity) {
    case "degraded":
      return {
        dot: "bg-amber-400",
        badge: "text-amber-300 border-amber-500/30 bg-amber-500/10"
      };
    case "major":
      return {
        dot: "bg-red-400",
        badge: "text-red-300 border-red-500/30 bg-red-500/10"
      };
    case "unknown":
      return {
        dot: "bg-zinc-500",
        badge: "text-zinc-300 border-zinc-700/60 bg-zinc-800/60"
      };
    default:
      return {
        dot: "bg-emerald-400",
        badge: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      };
  }
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
  if (!dom.serviceStatusUpdatedAt) return;
  dom.serviceStatusUpdatedAt.innerHTML =
    '<span class="th-skeleton th-skeleton-line inline-flex h-[12px] w-28 align-middle"></span>';
}

function renderLoadingState() {
  if (!dom.serviceStatusList) return;
  renderUpdatedAtLoadingState();
  dom.serviceStatusList.innerHTML = Array.from({ length: 3 }, () => `
    <article class="rounded-2xl border border-zinc-800/70 bg-th-bg/70 p-4" aria-hidden="true">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="th-skeleton rounded-full h-4 w-4 shrink-0"></span>
            <span class="th-skeleton th-skeleton-line h-[13px] w-28"></span>
          </div>
          <span class="th-skeleton th-skeleton-line mt-2 h-[10px] w-24"></span>
        </div>
        <span class="th-skeleton th-skeleton-line h-6 w-28 rounded-full shrink-0"></span>
      </div>
      <div class="mt-3 space-y-2">
        <span class="th-skeleton th-skeleton-line h-[11px] w-full"></span>
        <span class="th-skeleton th-skeleton-line h-[11px] w-4/5"></span>
      </div>
      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="th-skeleton th-skeleton-line h-[10px] w-24"></span>
      </div>
    </article>
  `).join("");
}

function renderErrorState(message) {
  if (!dom.serviceStatusList) return;
  if (dom.serviceStatusUpdatedAt) {
    dom.serviceStatusUpdatedAt.textContent = "n/d";
  }
  dom.serviceStatusList.innerHTML = `
    <div class="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-5 text-sm text-red-200">
      ${message}
    </div>
  `;
}

function buildServiceCard(service) {
  const card = document.createElement("article");
  card.className = "rounded-2xl border border-zinc-800/70 bg-th-bg/70 p-4";

  const meta = SERVICE_META[service.id] || SERVICE_META.openai;
  const severity = getSeverityClasses(service.severity);

  const head = document.createElement("div");
  head.className = "flex items-start justify-between gap-3";

  const titleWrap = document.createElement("div");
  titleWrap.className = "min-w-0";

  const titleRow = document.createElement("div");
  titleRow.className = "flex items-center gap-2 min-w-0";

  const icon = document.createElement("i");
  icon.className = `${meta.icon} text-zinc-400`;

  const title = document.createElement("button");
  title.type = "button";
  title.className = "text-left text-sm font-semibold text-white truncate hover:text-emerald-300 transition-colors";
  title.textContent = service.name || meta.fallbackLabel;
  title.title = service.url || meta.fallbackLabel;
  title.addEventListener("click", () => {
    if (service.url) {
      window.launcherAPI.openExternal(service.url);
    }
  });

  const host = document.createElement("p");
  host.className = "text-[11px] text-zinc-500 mt-1 truncate";
  host.textContent = service.host || meta.fallbackLabel;

  titleRow.append(icon, title);
  titleWrap.append(titleRow, host);

  const badge = document.createElement("span");
  badge.className =
    `inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${severity.badge}`;
  const dot = document.createElement("span");
  dot.className = `inline-block w-1.5 h-1.5 rounded-full ${severity.dot}`;
  badge.append(dot, document.createTextNode(service.label || "Unknown"));

  head.append(titleWrap, badge);

  const detail = document.createElement("p");
  detail.className = "mt-3 text-sm text-zinc-300 leading-5";
  detail.textContent = service.detail || "Nessun dettaglio disponibile.";

  const foot = document.createElement("div");
  foot.className = "mt-3 flex items-center justify-end gap-3 text-[11px] text-zinc-500";

  const checkedAt = document.createElement("span");
  checkedAt.textContent = `Check ${formatTimestamp(service.checkedAt)}`;

  foot.append(checkedAt);
  card.append(head, detail, foot);

  return card;
}

function renderServiceStatuses(payload) {
  if (!dom.serviceStatusList || !dom.serviceStatusUpdatedAt) return;

  const services = Array.isArray(payload?.services) ? payload.services : [];
  dom.serviceStatusUpdatedAt.textContent = formatTimestamp(payload?.refreshedAt);
  dom.serviceStatusList.innerHTML = "";

  if (!services.length) {
    renderErrorState("Nessuno stato disponibile.");
    return;
  }

  for (const service of services) {
    dom.serviceStatusList.append(buildServiceCard(service));
  }
}

async function refreshServiceStatuses({ force = false } = {}) {
  if (!window.launcherAPI?.getServiceStatuses) return null;

  if (refreshInFlight && !force) {
    return refreshInFlight;
  }

  const refreshId = latestRefreshId + 1;
  latestRefreshId = refreshId;

  if (dom.serviceStatusRefreshBtn) {
    dom.serviceStatusRefreshBtn.disabled = true;
    dom.serviceStatusRefreshBtn.classList.add("opacity-70");
  }

  renderLoadingState();

  refreshInFlight = window.launcherAPI
    .getServiceStatuses(force)
    .then((payload) => {
      if (refreshId === latestRefreshId) {
        renderServiceStatuses(payload);
      }
      return payload;
    })
    .catch((error) => {
      console.error("Unable to refresh service statuses:", error);
      if (refreshId === latestRefreshId) {
        renderErrorState("Impossibile recuperare lo stato servizi.");
      }
      return null;
    })
    .finally(() => {
      if (refreshId === latestRefreshId) {
        refreshInFlight = null;
      }
      if (dom.serviceStatusRefreshBtn && refreshId === latestRefreshId) {
        dom.serviceStatusRefreshBtn.disabled = false;
        dom.serviceStatusRefreshBtn.classList.remove("opacity-70");
      }
    });

  return refreshInFlight;
}

export function initServiceStatusPanel() {
  if (!dom.serviceStatusList || !dom.serviceStatusRefreshBtn || !dom.serviceStatusUpdatedAt) {
    return;
  }

  dom.serviceStatusRefreshBtn.addEventListener("click", () => {
    refreshServiceStatuses({ force: true });
  });

  refreshServiceStatuses();

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    refreshServiceStatuses();
  }, REFRESH_INTERVAL_MS);
}
