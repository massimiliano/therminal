import { state, sessionStore } from "./state.js";
import { dom } from "./dom.js";
import { queueFit } from "./helpers.js";

export function updateFontSizeLabel() {
  dom.fontSizeLabel.textContent = String(state.currentFontSize);
}

export function changeFontSize(delta) {
  state.currentFontSize = Math.max(8, Math.min(32, state.currentFontSize + delta));
  localStorage.setItem("therminal-font-size", String(state.currentFontSize));
  updateFontSizeLabel();
  for (const [id, s] of sessionStore) {
    s.terminal.options.fontSize = state.currentFontSize;
    queueFit(id);
  }
}
