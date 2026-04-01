(function bootstrapGuard() {
  let pendingState = null;

  function normalizeMessage(value) {
    if (!value) {
      return "Errore durante l'avvio dell'applicazione.";
    }

    const text = String(value).trim();
    return text || "Errore durante l'avvio dell'applicazione.";
  }

  function applyState() {
    const overlay = document.getElementById("appBootOverlay");
    if (!overlay || !pendingState) {
      return;
    }

    const title = document.getElementById("appBootOverlayTitle");
    const status = document.getElementById("appBootOverlayStatus");
    const panel = overlay.querySelector(".app-boot-overlay__panel");
    const spinner = overlay.querySelector(".app-boot-overlay__spinner");

    overlay.dataset.state = pendingState.state;
    overlay.setAttribute("aria-busy", pendingState.state === "loading" ? "true" : "false");

    if (title && pendingState.title) {
      title.textContent = pendingState.title;
      title.style.color = pendingState.state === "error" ? "#fecaca" : "";
    }

    if (status && pendingState.message) {
      status.textContent = pendingState.message;
      status.style.color = pendingState.state === "error" ? "#fca5a5" : "";
    }

    if (panel) {
      panel.style.borderColor =
        pendingState.state === "error" ? "rgba(248, 113, 113, 0.35)" : "";
    }

    if (spinner) {
      spinner.hidden = pendingState.state === "error";
    }
  }

  function setBootError(message) {
    pendingState = {
      state: "error",
      title: "Avvio interrotto",
      message: normalizeMessage(message)
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyState, { once: true });
      return;
    }

    applyState();
  }

  window.__therminalBootGuard = {
    setBootError
  };

  window.addEventListener(
    "error",
    (event) => {
      const message = event?.error?.message || event?.message;
      if (!message) {
        return;
      }

      setBootError(message);
    },
    true
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      const reason = event?.reason;
      const message =
        reason?.message ||
        (typeof reason === "string" ? reason : "");

      if (!message) {
        return;
      }

      setBootError(message);
    },
    true
  );
})();
