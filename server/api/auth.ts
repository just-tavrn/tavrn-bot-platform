// SPDX-License-Identifier: Apache-2.0
/**
 * Registration with e-mail confirmation, login, logout, password reset and the account (e-mail change, password
 * change, deletion). Answers never tell whether an address is registered (no enumeration).
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { DUMMY_HASH, RateLimit, SESSION_DAYS, createSession, createToken, endAllSessions, endSession, hashPassword, takeToken, verifyPassword } from "../auth";
import { HttpError, body, clientIp, requireUser, type Deps, type Env } from "../app";

const email = z.string().trim().toLowerCase().max(254).email();
const password = z.string().min(10, "at least 10 characters").max(200);
const HOUR = 3_600_000;

export function authRoutes({ config, db, mailer, platform }: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const perIp = new RateLimit(20, 15 * 60_000);
  const perEmail = new RateLimit(10, 15 * 60_000);
  const limit = (c: Context, key?: string) => {
    if (!perIp.take(`${c.req.path}|${clientIp(c, config.trustProxy)}`) || (key && !perEmail.take(`${c.req.path}|${key}`))) throw new HttpError(429, "rate_limited", "Too many attempts, try again later");
  };
  const link = (path: string, token: string) => `${config.baseUrl}${path}?token=${encodeURIComponent(token)}`;
  const login = (c: Context, userId: number) =>
    setCookie(c, "sid", createSession(db, config.sessionSecret, userId), { httpOnly: true, sameSite: "Lax", secure: config.baseUrl.startsWith("https://"), path: "/", maxAge: SESSION_DAYS * 86_400 });
  const send = (to: string, subject: string, text: string) => mailer.send(to, subject, text).catch((e: unknown) => platform.log.error("mail failed", { error: e }));
  const userBy = (e: string) => db.get<{ id: number; password: string; verified: number }>("SELECT id, password, verified FROM users WHERE email = ?", e);
  const checkPassword = async (userId: number, pw: string) => {
    const row = db.get<{ password: string }>("SELECT password FROM users WHERE id = ?", userId);
    if (!row || !(await verifyPassword(pw, row.password))) throw new HttpError(403, "wrong_password", "The password is not correct");
  };

  r.post("/auth/register", async (c) => {
    const b = await body(c, z.object({ email, password }));
    limit(c, b.email);
    if (!config.registrationOpen) throw new HttpError(403, "registration_closed", "Registration is closed");
    const existing = userBy(b.email);
    if (existing) {
      await hashPassword(b.password); // the same work as a new account: the answer time tells nothing
      await send(b.email, "Your tavrn bot account", `Somebody tried to register this address again. If it was you, log in or reset your password: ${config.baseUrl}/reset`);
    } else {
      const id = db.run("INSERT INTO users (email, password, created_at) VALUES (?, ?, ?)", b.email, await hashPassword(b.password), Date.now()).id;
      const token = createToken(db, config.sessionSecret, id, "confirm", 24 * HOUR);
      await send(b.email, "Confirm your tavrn bot account", `Confirm your address to finish the registration: ${link("/confirm", token)}\n\nThe link is valid for 24 hours.`);
    }
    return c.json({ ok: true, mailConfigured: mailer.configured });
  });

  r.post("/auth/confirm", async (c) => {
    const { token } = await body(c, z.object({ token: z.string().min(10).max(100) }));
    limit(c);
    const confirm = takeToken(db, config.sessionSecret, token, "confirm");
    if (confirm) {
      db.run("UPDATE users SET verified = 1 WHERE id = ?", confirm.userId);
      login(c, confirm.userId);
      return c.json({ ok: true, kind: "confirm" });
    }
    const change = takeToken(db, config.sessionSecret, token, "email");
    if (change) {
      if (userBy(change.data)) throw new HttpError(409, "email_taken", "This address is used by another account");
      db.run("UPDATE users SET email = ?, verified = 1 WHERE id = ?", change.data, change.userId);
      return c.json({ ok: true, kind: "email" });
    }
    throw new HttpError(400, "token_invalid", "This link is invalid or expired");
  });

  r.post("/auth/login", async (c) => {
    const b = await body(c, z.object({ email, password: z.string().max(200) }));
    limit(c, b.email);
    const u = userBy(b.email);
    const ok = await verifyPassword(b.password, u?.password ?? DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, "invalid_login", "E-mail or password is not correct");
    if (!u.verified) throw new HttpError(403, "unverified", "Confirm your e-mail address first (see the mail we sent)");
    login(c, u.id);
    return c.json({ ok: true });
  });

  // The confirmation mail again (the first one failed or got lost): only with the password, so nobody can make the
  // server mail a stranger, and the answer is the same whether the address exists, is verified or not.
  r.post("/auth/resend", async (c) => {
    const b = await body(c, z.object({ email, password: z.string().max(200) }));
    limit(c, b.email);
    const u = userBy(b.email);
    const ok = await verifyPassword(b.password, u?.password ?? DUMMY_HASH);
    if (u && ok && !u.verified) {
      const token = createToken(db, config.sessionSecret, u.id, "confirm", 24 * HOUR);
      await send(b.email, "Confirm your tavrn bot account", `Confirm your address to finish the registration: ${link("/confirm", token)}\n\nThe link is valid for 24 hours.`);
    }
    return c.json({ ok: true, mailConfigured: mailer.configured });
  });

  r.post("/auth/logout", (c) => {
    const sid = getCookie(c, "sid");
    if (sid) endSession(db, config.sessionSecret, sid);
    deleteCookie(c, "sid", { path: "/" });
    return c.json({ ok: true });
  });

  r.post("/auth/reset-request", async (c) => {
    const b = await body(c, z.object({ email }));
    limit(c, b.email);
    const u = userBy(b.email);
    if (u) await send(b.email, "Reset your tavrn bot password", `Set a new password: ${link("/reset", createToken(db, config.sessionSecret, u.id, "reset", HOUR))}\n\nThe link is valid for one hour.`);
    return c.json({ ok: true });
  });

  r.post("/auth/reset", async (c) => {
    const b = await body(c, z.object({ token: z.string().min(10).max(100), password }));
    limit(c);
    const t = takeToken(db, config.sessionSecret, b.token, "reset");
    if (!t) throw new HttpError(400, "token_invalid", "This link is invalid or expired");
    db.run("UPDATE users SET password = ?, verified = 1 WHERE id = ?", await hashPassword(b.password), t.userId);
    endAllSessions(db, t.userId);
    return c.json({ ok: true });
  });

  r.get("/me", (c) => {
    const u = requireUser(c);
    return c.json({ email: u.email, admin: config.adminEmails.includes(u.email) });
  });

  r.post("/me/email", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ email, password: z.string().max(200) }));
    limit(c, String(u.id));
    await checkPassword(u.id, b.password);
    if (!userBy(b.email)) {
      const token = createToken(db, config.sessionSecret, u.id, "email", 24 * HOUR, b.email);
      await send(b.email, "Confirm your new address", `Confirm this address for your tavrn bot account: ${link("/confirm", token)}`);
    }
    return c.json({ ok: true });
  });

  r.post("/me/password", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ current: z.string().max(200), password }));
    limit(c, String(u.id));
    await checkPassword(u.id, b.current);
    db.run("UPDATE users SET password = ? WHERE id = ?", await hashPassword(b.password), u.id);
    endAllSessions(db, u.id);
    login(c, u.id);
    return c.json({ ok: true });
  });

  r.post("/me/delete", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ password: z.string().max(200) }));
    limit(c, String(u.id));
    await checkPassword(u.id, b.password);
    db.run("DELETE FROM users WHERE id = ?", u.id);
    deleteCookie(c, "sid", { path: "/" });
    return c.json({ ok: true });
  });
  return r;
}
