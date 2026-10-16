// SPDX-License-Identifier: Apache-2.0
// Development: the server (restarted on changes) and Vite's dev server with the API proxied to it.
//   pnpm dev                       (reads .env if present; FAKE_BOT=1 runs without a tavrn node)
// The UI is at http://127.0.0.1:$WEB_PORT (5173), the API at $API_PORT (8787).
import { spawn } from "node:child_process";

const apiPort = process.env.API_PORT ?? "8787";
const webPort = process.env.WEB_PORT ?? "5173";
const env = { ...process.env, PORT: apiPort, API_PORT: apiPort, WEB_PORT: webPort, BASE_URL: process.env.BASE_URL ?? `http://127.0.0.1:${webPort}` };
const run = (args) => spawn(process.execPath, args, { env, stdio: "inherit" });
const children = [
  run(["--env-file-if-exists=.env", "--import", "tsx", ...(process.env.CI || process.env.NO_WATCH ? [] : ["--watch"]), "server/main.ts"]),
  run(["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]),
];
const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => { stop(); process.exitCode = code ?? 0; });
