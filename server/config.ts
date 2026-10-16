// SPDX-License-Identifier: Apache-2.0
/** The platform's configuration, read once from the environment (README.md, "Configuration"). */
import { randomBytes } from "node:crypto";

export interface Config {
  baseUrl: string;
  port: number;
  dataDir: string;
  tavrnNode: string;
  botToken: string;
  /** The node's domain (from TAVRN_NODE), for the add link. */
  nodeDomain: string;
  sessionSecret: string;
  smtpUrl: string;
  mailFrom: string;
  adminEmails: string[];
  trustProxy: boolean;
  registrationOpen: boolean;
  twitch: { clientId: string; clientSecret: string } | null;
  /** Development and e2e only: an in-memory fake instead of the tavrn runtime, plus the test hook routes. */
  fakeBot: boolean;
  /** Feeds on private addresses (development only). */
  allowPrivateFeeds: boolean;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const baseUrl = (env.BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const tavrnNode = (env.TAVRN_NODE ?? "").replace(/\/+$/, "");
  let sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) {
    if (production) throw new Error("SESSION_SECRET must be set to at least 32 characters");
    sessionSecret = randomBytes(32).toString("hex");
  }
  const fakeBot = env.FAKE_BOT === "1";
  if (fakeBot && production) throw new Error("FAKE_BOT is for development and tests only");
  return {
    baseUrl,
    port: Number(env.PORT ?? 8787),
    dataDir: env.DATA_DIR ?? "./.data",
    tavrnNode,
    botToken: env.TAVRN_BOT_TOKEN ?? "",
    nodeDomain: tavrnNode.replace(/^https?:\/\//, "").split("/")[0] ?? "",
    sessionSecret,
    smtpUrl: env.SMTP_URL ?? "",
    mailFrom: env.MAIL_FROM ?? "tavrn bot <bot@localhost>",
    adminEmails: (env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === "1",
    registrationOpen: env.REGISTRATION !== "closed",
    twitch: env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET ? { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET } : null,
    fakeBot,
    allowPrivateFeeds: !production && env.ALLOW_PRIVATE_FEEDS === "1",
    production,
  };
}
