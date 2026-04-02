import { state, sessionStore } from "../state.js";
import { dom } from "../dom.js";
import { setTerminalControllerFontSize } from "../terminal/controller.js";
import { fitNewTerminal } from "../terminal/resize-policy.js";

export function updateFontSizeLabel() {
  dom.fontSizeLabel.textContent = String(state.currentFontSize);
}

export function changeFontSize(delta) {
  state.currentFontSize = Math.max(8, Math.min(32, state.currentFontSize + delta));
  localStorage.setItem("therminal-font-size", String(state.currentFontSize));
  updateFontSizeLabel();
  for (const [id, session] of sessionStore) {
    setTerminalControllerFontSize(session.controller, state.currentFontSize);
    fitNewTerminal(id);
  }
}
