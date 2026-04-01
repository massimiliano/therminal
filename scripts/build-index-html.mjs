import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const templateDir = path.join(rootDir, "src", "templates", "index");
const outputPath = path.join(rootDir, "src", "index.html");

const sections = [
  "head.html",
  "topbar-home.html",
  "workspace.html",
  "modals-and-scripts.html"
];

const parts = await Promise.all(
  sections.map(async (name) => {
    return await readFile(path.join(templateDir, name), "utf8");
  })
);

const output = parts.join("\n");
await writeFile(outputPath, output, "utf8");
