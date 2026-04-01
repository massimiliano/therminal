const fs = require("fs");
const path = require("path");

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSortedFiles(rootPath, matcher = () => true, recursive = false) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const stack = [rootPath];

  while (stack.length) {
    const currentPath = stack.pop();
    let entries = [];

    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !matcher(fullPath, entry.name)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          mtimeMs: stat.mtimeMs
        });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTailUtf8(filePath, maxBytes = 131072) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");

    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }

    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function stripAnsiOutput(text) {
  return text
    .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

module.exports = {
  getSortedFiles,
  numberOrZero,
  readJsonFile,
  readTailUtf8,
  stripAnsiOutput
};
