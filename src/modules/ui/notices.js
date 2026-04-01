import { dom } from "../dom.js";

let hideTimer = null;

const NOTICE_STYLE = {
  error: {
    wrapper: "border-red-500/25 bg-red-500/10 text-red-100",
    icon: "bi bi-exclamation-octagon text-red-300"
  },
  warning: {
    wrapper: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    icon: "bi bi-exclamation-triangle text-amber-300"
  },
  success: {
    wrapper: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
    icon: "bi bi-check2-circle text-emerald-300"
  },
  info: {
    wrapper: "border-zinc-700/70 bg-th-surface/95 text-zinc-100",
    icon: "bi bi-info-circle text-zinc-300"
  }
};

export function hideNotice() {
  if (!dom.appNotice) return;
  dom.appNotice.classList.add("hidden");
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function showNotice(message, { type = "error", timeoutMs = 7000 } = {}) {
  if (!dom.appNotice || !dom.appNoticeText || !dom.appNoticeIcon) {
    console.error(message);
    return;
  }

  const style = NOTICE_STYLE[type] || NOTICE_STYLE.info;
  dom.appNotice.className =
    `fixed top-12 right-4 z-[220] max-w-md rounded-xl border px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-md ${style.wrapper}`;
  dom.appNoticeIcon.className = `${style.icon} mt-0.5 text-sm`;
  dom.appNoticeText.textContent = message;
  dom.appNotice.classList.remove("hidden");

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (timeoutMs > 0) {
    hideTimer = setTimeout(() => {
      hideNotice();
    }, timeoutMs);
  }
}
