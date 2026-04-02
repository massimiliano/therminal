import { sessionStore } from "../state.js";
import {
  clearTerminalControllerSearch,
  findNextInTerminalController,
  findPreviousInTerminalController,
  focusTerminalController,
} from "../terminal/controller.js";
import { fitStructuralTerminalChange } from "../terminal/resize-policy.js";

export function showSearch(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session?.controller?.searchAddon) return;

  let searchBar = session.cell.querySelector(".search-bar");
  if (!searchBar) {
    searchBar = document.createElement("div");
    searchBar.className =
      "search-bar flex items-center gap-1 px-2 py-[3px] bg-th-hover border-b border-th-border-lt shrink-0";
    searchBar.innerHTML = `
      <input type="text" class="flex-1 bg-th-body border border-th-border-lt rounded px-2 py-[3px] text-xs font-mono text-th-fg outline-none min-w-[80px] focus:border-emerald-400/35" placeholder="Cerca...">
      <button class="search-nav-btn w-[22px] h-[22px] flex items-center justify-center bg-transparent text-zinc-500 cursor-pointer rounded text-xs transition-all duration-150 hover:text-zinc-300 hover:bg-zinc-800" data-action="prev" title="Precedente (Shift+Invio)"><i class="bi bi-chevron-up"></i></button>
      <button class="search-nav-btn w-[22px] h-[22px] flex items-center justify-center bg-transparent text-zinc-500 cursor-pointer rounded text-xs transition-all duration-150 hover:text-zinc-300 hover:bg-zinc-800" data-action="next" title="Successivo (Invio)"><i class="bi bi-chevron-down"></i></button>
      <button class="search-nav-btn w-[22px] h-[22px] flex items-center justify-center bg-transparent text-zinc-500 cursor-pointer rounded text-xs transition-all duration-150 hover:text-zinc-300 hover:bg-zinc-800" data-action="close" title="Chiudi (Esc)"><i class="bi bi-x"></i></button>
    `;
    const body = session.cell.querySelector(".terminal-cell-body");
    session.cell.insertBefore(searchBar, body);

    const input = searchBar.querySelector("input");
    input.addEventListener("input", () => {
      if (input.value) findNextInTerminalController(session.controller, input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          findPreviousInTerminalController(session.controller, input.value);
        } else {
          findNextInTerminalController(session.controller, input.value);
        }
      }
      if (event.key === "Escape") {
        hideSearch(sessionId);
      }
    });
    searchBar.querySelector('[data-action="prev"]').addEventListener("click", () => {
      findPreviousInTerminalController(session.controller, input.value);
    });
    searchBar.querySelector('[data-action="next"]').addEventListener("click", () => {
      findNextInTerminalController(session.controller, input.value);
    });
    searchBar.querySelector('[data-action="close"]').addEventListener("click", () => {
      hideSearch(sessionId);
    });
  }

  searchBar.classList.remove("hidden");
  searchBar.querySelector("input").focus();
  fitStructuralTerminalChange(sessionId);
}

export function hideSearch(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) return;

  const searchBar = session.cell.querySelector(".search-bar");
  if (searchBar) {
    searchBar.classList.add("hidden");
    clearTerminalControllerSearch(session.controller);
  }

  focusTerminalController(session.controller);
  fitStructuralTerminalChange(sessionId);
}
