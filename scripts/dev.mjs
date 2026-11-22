// Starts `next dev` quietly and, once the server is ready, shows where to open it.
// Next's routine startup/request logs are hidden; errors and warnings still show.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const bold = (s) => `\u001b[1m${s}\u001b[22m`;
const green = (s) => `\u001b[32m${s}\u001b[39m`;
const dim = (s) => `\u001b[2m${s}\u001b[22m`;
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

function banner(url, footer = "To stop, press Ctrl + C") {
  const text = `Run ${url} in your browser`;
  const width = text.length + 6;
  const line = "═".repeat(width);
  const pad = " ".repeat(width);
  console.log(
    [
      "",
      green(`  ╔${line}╗`),
      green(`  ║${pad}║`),
      green("  ║   ") + bold(text) + green("   ║"),
      green(`  ║${pad}║`),
      green(`  ╚${line}╝`),
      "",
      dim(`  ${footer}`),
      "",
    ].join("\n"),
  );
}

// If a copy is already running from this folder, point at it instead of starting another.
async function runningUrl() {
  try {
    const lock = JSON.parse(readFileSync(".next/dev/lock", "utf8"));
    process.kill(lock.pid, 0); // throws if that process is gone
    await fetch(lock.appUrl, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return lock.appUrl;
  } catch {
    return null;
  }
}

const existingUrl = await runningUrl();
if (existingUrl) {
  console.log("\n  Cheap Escapes is already running in another Terminal window.");
  banner(existingUrl, "Use that window to stop it (Ctrl + C).");
  process.exit(0);
}

console.log("\n  Starting Cheap Escapes…");

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
});

// Split a stream into whole lines.
function onLines(stream, handle) {
  let rest = "";
  stream.on("data", (chunk) => {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop();
    lines.forEach(handle);
  });
  stream.on("end", () => rest && handle(rest));
}

let url = "http://localhost:3000";
let announced = false;
let alreadyRunning = false;

// Normal output: only used to find the address and when it's ready.
onLines(child.stdout, (raw) => {
  const line = stripAnsi(raw);
  const local = line.match(/Local:\s+(http:\/\/\S+)/);
  if (local) url = local[1];
  if (!announced && /Ready in/.test(line)) {
    announced = true;
    banner(url);
  }
});

// Errors and warnings: shown, minus noise that doesn't affect the app.
const NOISE = [/ignored package-lock\.json/, /set `turbopack\.root`/, /Port \d+ is in use/];
onLines(child.stderr, (raw) => {
  const line = stripAnsi(raw);
  if (/Another next dev server is already running/.test(line)) alreadyRunning = true;
  if (alreadyRunning) {
    const existing = line.match(/existing server at (http:\/\/\S+?),?$/);
    if (existing) {
      console.log("\n  Cheap Escapes is already running in another Terminal window.");
      banner(existing[1], "Use that window to stop it (Ctrl + C).");
    }
    return;
  }
  if (NOISE.some((re) => re.test(line))) return;
  process.stderr.write(raw + "\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(alreadyRunning ? 0 : (code ?? 0)));
