export function createTerminalOutputBuffer(terminal) {
  return {
    terminal,
    chunks: [],
    frameId: null,
    refreshFrameId: null,
  };
}

function scheduleTerminalRefresh(buffer) {
  if (buffer.refreshFrameId) {
    return;
  }

  buffer.refreshFrameId = requestAnimationFrame(() => {
    buffer.refreshFrameId = null;
    const rows = buffer.terminal?.rows;
    if (!Number.isInteger(rows) || rows <= 0) {
      return;
    }

    try {
      buffer.terminal.refresh(0, rows - 1);
    } catch {
      // Ignore refreshes against a terminal that is tearing down.
    }
  });
}

function flushTerminalOutputBuffer(buffer) {
  buffer.frameId = null;
  if (!Array.isArray(buffer?.chunks) || buffer.chunks.length === 0) {
    return;
  }

  const output = buffer.chunks.join("");
  buffer.chunks = [];

  try {
    buffer.terminal.write(output, () => {
      scheduleTerminalRefresh(buffer);
    });
  } catch {
    // Ignore writes against a terminal that is tearing down.
  }
}

export function enqueueTerminalOutput(buffer, data) {
  if (!buffer || typeof data !== "string" || data.length === 0) {
    return;
  }

  buffer.chunks.push(data);
  if (buffer.frameId) {
    return;
  }

  buffer.frameId = requestAnimationFrame(() => flushTerminalOutputBuffer(buffer));
}

export function flushTerminalOutput(buffer) {
  if (!buffer) {
    return;
  }

  if (buffer.frameId) {
    cancelAnimationFrame(buffer.frameId);
  }

  flushTerminalOutputBuffer(buffer);
}

export function disposeTerminalOutputBuffer(buffer, { flush = false } = {}) {
  if (!buffer) {
    return;
  }

  if (flush) {
    flushTerminalOutput(buffer);
    return;
  }

  if (buffer.frameId) {
    cancelAnimationFrame(buffer.frameId);
  }

  if (buffer.refreshFrameId) {
    cancelAnimationFrame(buffer.refreshFrameId);
  }

  buffer.frameId = null;
  buffer.refreshFrameId = null;
  buffer.chunks = [];
}
