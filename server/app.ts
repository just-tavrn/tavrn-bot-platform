// SPDX-License-Identifier: Apache-2.0
/**
 * The HTTP side: the JSON API under /api, /healthz and the built web UI (server/public, a single-page app).
 * Security: secure headers with a strict CSP, an Origin check on every state-changing request (CSRF), session
 * cookies (HttpOnly, SameSite=Lax, Secure behind HTTPS), rate limits on the auth routes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import type { ZodType } from "zod";
import { authRoutes } from "./api/auth";
import { adminRoutes } from "./api/admin";
import { roomRoutes } from "./api/rooms";
import { sessionUser, type User } from "./auth";
import type { Config } from "./config";
import type { Db } from "./db";
import { FakeBot, OWNER } from "./fake-bot";
import type { Mailer } from "./mail";
import type { Platform } from "./platform";
import { ValidationError } from "./schema";

export interface Deps {
  config: Config;
  db: Db;
  platform: Platform;
  mailer: Mailer;
  /** Set when FAKE_BOT=1: enables the test hook routes. */
  fake?: FakeBot;
}

export type Env = { Variables: { user: User | null } };

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/** Parses a JSON body with a zod schema (400 with the first offending path). */
export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => {
    throw new HttpError(400, "invalid_json", "The body must be JSON");
  });
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, "invalid", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }
  return r.data;
}

export function requireUser(c: Context<Env>): User {
  const u = c.get("user");
  if (!u) throw new HttpError(401, "unauthenticated", "Please log in");
  return u;
}

/** The client's address: X-Forwarded-For only behind a trusted reverse proxy (TRUST_PROXY=1). */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createApp(deps: Deps): Hono<Env> {
  const { config, db, platform } = deps;
  const app = new Hono<Env>();
  const origin = new URL(config.baseUrl).origin;

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      strictTransportSecurity: config.baseUrl.startsWith("https://") ? "max-age=31536000; includeSubDomains" : false,
      referrerPolicy: "same-origin",
    }),
  );

  app.use("/api/*", async (c, next) => {
    // CSRF: state-changing requests must come from the dashboard's own origin.
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("origin") !== origin) throw new HttpError(403, "bad_origin", "Cross-origin request refused");
    c.set("user", sessionUser(db, config.sessionSecret, getCookie(c, "sid")));
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.code, message: e.message }, e.status);
    if (e instanceof ValidationError) return c.json({ error: "invalid", message: e.message, path: e.path }, 400);
    platform.log.error("request failed", { path: c.req.path, error: e });
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, bot: platform.status.online }));
  app.get("/api/config", (c) =>
    c.json({ addLink: platform.addLink, mailConfigured: deps.mailer.configured, registrationOpen: config.registrationOpen, bot: { online: platform.status.online, address: platform.status.address }, testHooks: !!deps.fake }),
  );
  app.route("/api", authRoutes(deps));
  app.route("/api", roomRoutes(deps));
  app.route("/api", adminRoutes(deps));

  if (deps.fake) {
    const fake = deps.fake;
    // Test hook (FAKE_BOT=1 only): runs `/connect <code>` in the fake room as its owner, as the node would.
    app.post("/api/test/connect", async (c) => {
      const { code } = (await c.req.json()) as { code: string };
      const i = await fake.invoke("connect", { code }, OWNER);
      return c.json({ answer: i.text });
    });
  }
  app.all("/api/*", (c) => c.json({ error: "not_found", message: "Unknown route" }, 404));

  const root = join(import.meta.dirname, "public");
  app.use("/assets/*", serveStatic({ root, onFound: (_p, c) => void c.header("Cache-Control", "public, max-age=31536000, immutable") }));
  app.use("*", serveStatic({ root }));
  const index = join(root, "index.html");
  app.get("*", (c) => (existsSync(index) ? c.html(readFileSync(index, "utf8")) : c.text("The web UI is not built: run pnpm build (or use pnpm dev).", 503)));
  return app;
}
