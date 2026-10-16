// SPDX-License-Identifier: Apache-2.0
/** Entry point: configuration, database, bot runtime, modules and the HTTP server in one process. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { appTokenClaims, consoleLogger, createBot } from "@tavrn/bot";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { Db } from "./db";
import { FakeBot } from "./fake-bot";
import { createMailer, memoryMailer } from "./mail";
import { MODULES } from "./modules";
import { Platform } from "./platform";

const config = loadConfig();
const log = consoleLogger();
mkdirSync(config.dataDir, { recursive: true });
const db = new Db(join(config.dataDir, "platform.db"));

const fake = config.fakeBot ? new FakeBot() : undefined;
const bot = fake
  ? fake.asBot()
  : config.botToken
    ? createBot({
        node: config.tavrnNode || `https://${appTokenClaims(config.botToken).iss}`,
        token: config.botToken,
        keyFile: process.env.TAVRN_BOT_KEY_FILE ?? join(config.dataDir, "tavrn-key.txt"),
        stateDir: process.env.TAVRN_BOT_STATE_DIR ?? join(config.dataDir, "tavrn-state"),
        logger: log,
      })
    : new FakeBot().asBot(); // no token: the dashboard runs, the bot stays offline

// In the fake mode the mails are kept for the e2e test hook as well as logged.
const mailer = fake ? Object.assign(memoryMailer(), { configured: false }) : createMailer(config, log);
const platform = new Platform(config, db, bot, log, MODULES);
const app = createApp({ config, db, platform, mailer, fake });

const server = serve({ fetch: app.fetch, port: config.port, hostname: process.env.HOST ?? "0.0.0.0" }, (info) => log.info("listening", { port: info.port, baseUrl: config.baseUrl, fakeBot: !!fake }));
if (!config.botToken && !fake) {
  platform.status.error = "TAVRN_BOT_TOKEN is not set";
  log.warn("TAVRN_BOT_TOKEN is not set: the dashboard runs, the bot stays offline");
} else {
  void platform.start();
}

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info("stopping", { signal });
  server.close();
  await platform.stop();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
