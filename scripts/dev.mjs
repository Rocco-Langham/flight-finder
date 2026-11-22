// Starts `next dev` and, once the server is ready, tells the user where to open it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
});

let url = "http://localhost:3000";
let announced = false;
let buffer = "";

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (announced) return;
  buffer += chunk.toString();
  const local = buffer.match(/Local:\s+(http:\/\/\S+)/);
  if (local) url = local[1].replace(/\u001b\[[0-9;]*m/g, "");
  if (/Ready in/.test(buffer)) {
    announced = true;
    buffer = "";
    process.stdout.write(`\n  \u001b[1m\u001b[32m➜  Run ${url} in your browser\u001b[0m\n\n`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
