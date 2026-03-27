export const TASK_STATUS_ORDER = ["todo", "running", "blocked", "done"];

export const TASK_STATUS_META = {
  todo: {
    label: "Todo",
    shortLabel: "TODO",
    chip: "border-zinc-700/70 bg-zinc-800/70 text-zinc-300",
    dot: "bg-zinc-400"
  },
  running: {
    label: "Running",
    shortLabel: "RUN",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    dot: "bg-blue-400"
  },
  blocked: {
    label: "Blocked",
    shortLabel: "BLOCK",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400"
  },
  done: {
    label: "Done",
    shortLabel: "DONE",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400"
  }
};

export function normalizeTaskStatus(value) {
  return TASK_STATUS_META[value] ? value : "todo";
}

export function getTaskStatusMeta(value) {
  return TASK_STATUS_META[normalizeTaskStatus(value)];
}

export function getNextTaskStatus(value) {
  const normalized = normalizeTaskStatus(value);
  const index = TASK_STATUS_ORDER.indexOf(normalized);
  return TASK_STATUS_ORDER[(index + 1) % TASK_STATUS_ORDER.length];
}
