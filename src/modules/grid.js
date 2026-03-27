import { GUTTER_PX } from "./state.js";
import { refitWorkspace } from "./helpers.js";

export function handleVerticalDrag(e, workspace, rowIndex, gapIndex) {
  e.preventDefault();

  const row = workspace.rows[rowIndex];
  const sizes = workspace.colSizes[rowIndex];
  const startX = e.clientX;
  const rowWidth = row.clientWidth;
  const gutterCount = sizes.length - 1;
  const available = rowWidth - gutterCount * GUTTER_PX;
  const totalFr = sizes.reduce((a, b) => a + b, 0);
  const pxPerFr = available / totalFr;
  const minFr = 60 / pxPerFr;

  const startA = sizes[gapIndex];
  const startB = sizes[gapIndex + 1];

  const dividerEl = e.currentTarget;
  dividerEl.classList.add("active");
  document.body.classList.add("dragging");
  document.body.style.cursor = "col-resize";

  function onMove(ev) {
    const delta = ev.clientX - startX;
    const deltaFr = delta / pxPerFr;

    let newA = startA + deltaFr;
    let newB = startB - deltaFr;

    if (newA < minFr) {
      newA = minFr;
      newB = startA + startB - minFr;
    }
    if (newB < minFr) {
      newB = minFr;
      newA = startA + startB - minFr;
    }

    sizes[gapIndex] = newA;
    sizes[gapIndex + 1] = newB;
    applyRowColFlex(workspace, rowIndex);
    refitWorkspace(workspace, { backend: "debounced" });
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    dividerEl.classList.remove("active");
    document.body.classList.remove("dragging");
    document.body.style.cursor = "";
    refitWorkspace(workspace, { backend: "immediate" });
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

export function handleHorizontalDrag(e, workspace, gapIndex) {
  e.preventDefault();

  const grid = workspace.element;
  const sizes = workspace.rowSizes;
  const startY = e.clientY;
  const gridHeight = grid.clientHeight;
  const gutterCount = sizes.length - 1;
  const available = gridHeight - gutterCount * GUTTER_PX;
  const totalFr = sizes.reduce((a, b) => a + b, 0);
  const pxPerFr = available / totalFr;
  const minFr = 60 / pxPerFr;

  const startA = sizes[gapIndex];
  const startB = sizes[gapIndex + 1];

  const dividerEl = e.currentTarget;
  dividerEl.classList.add("active");
  document.body.classList.add("dragging");
  document.body.style.cursor = "row-resize";

  function onMove(ev) {
    const delta = ev.clientY - startY;
    const deltaFr = delta / pxPerFr;

    let newA = startA + deltaFr;
    let newB = startB - deltaFr;

    if (newA < minFr) {
      newA = minFr;
      newB = startA + startB - minFr;
    }
    if (newB < minFr) {
      newB = minFr;
      newA = startA + startB - minFr;
    }

    sizes[gapIndex] = newA;
    sizes[gapIndex + 1] = newB;
    applyRowHeights(workspace);
    refitWorkspace(workspace, { backend: "debounced" });
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    dividerEl.classList.remove("active");
    document.body.classList.remove("dragging");
    document.body.style.cursor = "";
    refitWorkspace(workspace, { backend: "immediate" });
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

export function applyRowColFlex(workspace, rowIndex) {
  const row = workspace.rows[rowIndex];
  const sizes = workspace.colSizes[rowIndex];
  const cells = row.querySelectorAll(":scope > .terminal-cell");
  cells.forEach((cell, i) => {
    if (i < sizes.length) cell.style.flex = String(sizes[i]);
  });
}

export function applyRowHeights(workspace) {
  workspace.rows.forEach((row, i) => {
    row.style.flex = String(workspace.rowSizes[i]);
  });
}
