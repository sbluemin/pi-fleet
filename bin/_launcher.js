const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function launch({ mode, dev, experimental }) {
  const args = [];

  if (dev) {
    const extensionArgs = getDevExtensionArgs();
    args.push(...extensionArgs);
  }

  args.push(...process.argv.slice(2));

  const env = { ...process.env };

  if (mode === "grand") {
    env.PI_GRAND_FLEET_ROLE = "admiralty";
  }

  if (experimental) {
    env.PI_EXPERIMENTAL = "1";
  }

  const child = spawn("pi", args, {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error("Failed to start pi process:", err);
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function getDevExtensionArgs() {
  const extensionsDir = path.join(process.cwd(), "extensions");

  if (!fs.existsSync(extensionsDir)) {
    console.error("extensions/ directory not found.");
    process.exit(1);
  }

  const extensionEntryPaths = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("extensions", entry.name, "index.ts"))
    .filter((entryPath) => fs.existsSync(path.join(process.cwd(), entryPath)))
    .sort();

  return ["-ne", ...extensionEntryPaths.flatMap((entryPath) => ["-e", entryPath])];
}

module.exports = {
  launch,
};
