import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function readEnvironmentFile(path) {
  const result = {};
  let content = "";

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return result;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
    );

    if (!match) continue;

    let value = match[2].trim();

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
       (value.startsWith("'") && value.endsWith("'")))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);

      if (quote === '"') {
        value = value.replace(/\\(["\\])/g, "$1");
      }
    }

    result[match[1]] = value;
  }

  return result;
}

const runtime = readEnvironmentFile("/etc/hirbod/hirbod-runtime.env");

const publishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  runtime.VITE_SUPABASE_PUBLISHABLE_KEY ||
  runtime.SUPABASE_PUBLISHABLE_KEY;

if (!publishableKey) {
  console.error("Build متوقف شد: کلید عمومی Supabase پیدا نشد.");
  process.exit(1);
}

process.env.VITE_SUPABASE_PUBLISHABLE_KEY = publishableKey;

let mode;
const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--mode" && args[i + 1]) {
    mode = args[++i];
  } else if (args[i].startsWith("--mode=")) {
    mode = args[i].slice("--mode=".length);
  } else {
    console.error("Build argument پشتیبانی نمی‌شود:", args[i]);
    process.exit(1);
  }
}

const viteCli = resolve("node_modules/vite/bin/vite.js");

if (!existsSync(viteCli)) {
  console.error("Vite CLI was not found:", viteCli);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [viteCli, "build", ...(mode ? ["--mode", mode] : [])],
  {
    cwd: process.cwd(),
    env: { ...process.env, NITRO_PRESET: "node-server" },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error("Vite CLI execution failed:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (
  !existsSync(resolve(".output/server/index.mjs")) ||
  !existsSync(resolve(".output/public"))
) {
  console.error("Build incomplete: server or public output is missing.");
  process.exit(1);
}

console.log("Complete Node.js production build verified.");
