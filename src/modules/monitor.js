import { dom } from "./dom.js";

let metricsInterval = null;

function createBar(label, icon) {
  const wrap = document.createElement("div");
  wrap.className = "flex items-center gap-1.5 px-1.5";
  wrap.title = label;

  const ico = document.createElement("i");
  ico.className = `bi ${icon} text-[10px] text-zinc-600`;

  const barBg = document.createElement("div");
  barBg.className = "w-[40px] h-[5px] rounded-full bg-zinc-800 overflow-hidden";

  const barFill = document.createElement("div");
  barFill.className = "h-full rounded-full transition-all duration-500";
  barFill.style.width = "0%";

  const pct = document.createElement("span");
  pct.className = "text-[10px] font-mono text-zinc-600 w-[28px] text-right select-none";
  pct.textContent = "0%";

  barBg.append(barFill);
  wrap.append(ico, barBg, pct);

  return { el: wrap, fill: barFill, pct };
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

  container.append(cpu.el, ram.el);

  async function update() {
    try {
      const m = await window.launcherAPI.getSystemMetrics();

      cpu.fill.style.width = `${m.cpuPercent}%`;
      cpu.fill.className = `h-full rounded-full transition-all duration-500 ${barColor(m.cpuPercent)}`;
      cpu.pct.textContent = `${m.cpuPercent}%`;
      cpu.el.title = `CPU: ${m.cpuPercent}%`;

      ram.fill.style.width = `${m.memUsedPercent}%`;
      ram.fill.className = `h-full rounded-full transition-all duration-500 ${barColor(m.memUsedPercent)}`;
      ram.pct.textContent = `${m.memUsedPercent}%`;
      ram.el.title = `RAM: ${m.memUsedGB} / ${m.memTotalGB} GB (${m.memUsedPercent}%)`;
    } catch {}
  }

  update();
  metricsInterval = setInterval(update, 3000);
}

export function destroyMonitor() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}
