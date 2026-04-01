import { sessionStore } from "../state.js";
import { queueFit } from "../helpers.js";

export function showSearch(sessionId) {
  const s = sessionStore.get(sessionId);
  if (!s || !s.searchAddon) return;

  let searchBar = s.cell.querySelector(".search-bar");
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
    const body = s.cell.querySelector(".terminal-cell-body");
    s.cell.insertBefore(searchBar, body);

    const input = searchBar.querySelector("input");
    input.addEventListener("input", () => {
      if (input.value) s.searchAddon.findNext(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          s.searchAddon.findPrevious(input.value);
        } else {
          s.searchAddon.findNext(input.value);
        }
      }
      if (e.key === "Escape") {
        hideSearch(sessionId);
      }
    });
    searchBar.querySelector('[data-action="prev"]').addEventListener("click", () => {
      s.searchAddon.findPrevious(input.value);
    });
    searchBar.querySelector('[data-action="next"]').addEventListener("click", () => {
      s.searchAddon.findNext(input.value);
    });
    searchBar.querySelector('[data-action="close"]').addEventListener("click", () => {
      hideSearch(sessionId);
    });
  }

  searchBar.classList.remove("hidden");
  searchBar.querySelector("input").focus();
  queueFit(sessionId);
}

export function hideSearch(sessionId) {
  const s = sessionStore.get(sessionId);
  if (!s) return;
  const searchBar = s.cell.querySelector(".search-bar");
  if (searchBar) {
    searchBar.classList.add("hidden");
    try {
      s.searchAddon.clearDecorations();
    } catch {}
  }
  s.terminal.focus();
  queueFit(sessionId);
}
