import { dom } from "../dom.js";

let metricsInterval = null;
let metricsPending = false;

function createBar(label, icon) {
  const wrap = document.createElement("div");
  wrap.className =
    "flex h-[28px] items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-th-body px-2";
  wrap.title = label;

  const ico = document.createElement("i");
  ico.className = `bi ${icon} text-[11px] text-zinc-500`;

  const pct = document.createElement("span");
  pct.className = "min-w-[30px] text-[10px] font-mono text-zinc-400 text-right select-none";
  pct.textContent = "0%";

  wrap.append(ico, pct);

  return { el: wrap, pct };
}

function barColor(percent) {
  if (percent >= 85) return "bg-red-500";
  if (percent >= 60) return "bg-amber-500";
  return "bg-emerald-500";
}

export function initMonitor() {
  const container = dom.monitorWidget;
  if (!container) return;

  const cpu = createBar("CPU", "bi-cpu");
  const ram = createBar("RAM", "bi-memory");

  container.replaceChildren(cpu.el, ram.el);

  async function updateMetrics() {
    if (metricsPending) return;
    metricsPending = true;

    try {
      const m = await window.launcherAPI.getSystemMetrics();

      cpu.pct.textContent = `${m.cpuPercent}%`;
      cpu.pct.className = `min-w-[30px] text-[10px] font-mono text-right select-none ${barColor(m.cpuPercent).replace("bg-", "text-")}`;
      cpu.el.title = `CPU: ${m.cpuPercent}%`;

      ram.pct.textContent = `${m.memUsedPercent}%`;
      ram.pct.className =
        `min-w-[30px] text-[10px] font-mono text-right select-none ${barColor(m.memUsedPercent).replace("bg-", "text-")}`;
      ram.el.title = `RAM: ${m.memUsedGB} / ${m.memTotalGB} GB (${m.memUsedPercent}%)`;
    } catch {
      // Ignore monitor update failures.
    } finally {
      metricsPending = false;
    }
  }

  updateMetrics();
  metricsInterval = setInterval(updateMetrics, 3000);
}

export function destroyMonitor() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }

  metricsPending = false;
}
