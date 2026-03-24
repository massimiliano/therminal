import { dom } from "./dom.js";
import { toggleBroadcast } from "./broadcast.js";

export function toggleShortcutsModal() {
  dom.shortcutsModal.classList.toggle("hidden");
}

export function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+Shift+B: toggle broadcast
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
      e.preventDefault();
      toggleBroadcast();
      return;
    }

    // Ctrl+/: toggle shortcuts modal
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      toggleShortcutsModal();
      return;
    }

    // Escape: close shortcuts modal
    if (e.key === "Escape") {
      if (!dom.shortcutsModal.classList.contains("hidden")) {
        toggleShortcutsModal();
        return;
      }
    }
  });
}
