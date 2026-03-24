const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.projectDir;
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
  );
  const productName = context.packager.appInfo.productName || packageJson.name;
  const productFilename = context.packager.appInfo.productFilename || productName;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(projectDir, "logo.ico");
  const rceditPath = path.join(
    projectDir,
    "node_modules",
    "electron-winstaller",
    "vendor",
    "rcedit.exe",
  );

  if (!fs.existsSync(exePath)) {
    throw new Error(`Executable non trovato: ${exePath}`);
  }

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Icona non trovata: ${iconPath}`);
  }

  if (!fs.existsSync(rceditPath)) {
    throw new Error(`rcedit non trovato: ${rceditPath}`);
  }

  const version = packageJson.version;
  const description = packageJson.description || productName;
  const companyName =
    (typeof packageJson.author === "string" && packageJson.author.trim()) ||
    (packageJson.author && packageJson.author.name) ||
    productName;
  const copyright =
    context.packager.appInfo.copyright ||
    `Copyright ${new Date().getFullYear()} ${productName}`;
  const originalFilename = `${productFilename}.exe`;

  const args = [
    exePath,
    "--set-version-string",
    "FileDescription",
    description,
    "--set-version-string",
    "ProductName",
    productName,
    "--set-version-string",
    "InternalName",
    productFilename,
    "--set-version-string",
    "OriginalFilename",
    originalFilename,
    "--set-version-string",
    "CompanyName",
    companyName,
    "--set-version-string",
    "LegalCopyright",
    copyright,
    "--set-file-version",
    version,
    "--set-product-version",
    version,
    "--set-icon",
    iconPath,
  ];

  const result = spawnSync(rceditPath, args, {
    cwd: projectDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `rcedit fallito (${result.status}): ${result.stderr || result.stdout || "errore sconosciuto"}`,
    );
  }
};
