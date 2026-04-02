import { queueFit } from "../helpers.js";

export function createTerminalResizeObserver(sessionId, ...elements) {
  const resizeObserver = new ResizeObserver(() => queueFit(sessionId));

  for (const element of elements) {
    if (element) {
      resizeObserver.observe(element);
    }
  }

  return resizeObserver;
}

export function fitNewTerminal(sessionId) {
  queueFit(sessionId, { backend: "immediate", force: true });
}

export function fitStructuralTerminalChange(sessionId) {
  queueFit(sessionId, { backend: "immediate", force: true });
}
