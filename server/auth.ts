// SPDX-License-Identifier: Apache-2.0
/**
 * Accounts: scrypt password hashes (node:crypto, no native module), sessions and one-time tokens (e-mail
 * confirmation, password reset, e-mail change, room connect codes). Only HMACs of tokens are stored, keyed with
 * SESSION_SECRET, so a copy of the database alone opens nothing.
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual, type BinaryLike, type ScryptOptions } from "node:crypto";
import type { Db } from "./db";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = 30;
const DAY = 86_400_000;

function scryptAsync(password: BinaryLike, salt: BinaryLike, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, keylen, opts, (e, key) => (e ? reject(e) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

/** A password hash to compare against when the account does not exist (same timing as a real check). */
export const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

export const tokenHash = (secret: string, token: string) => createHmac("sha256", secret).update(token).digest("base64url");
export const newToken = () => randomBytes(32).toString("base64url");

/** Connect codes are typed by people: 8 characters without look-alikes, shown as XXXX-XXXX. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type TokenKind = "confirm" | "reset" | "email" | "connect";

export function createToken(db: Db, secret: string, userId: number, kind: TokenKind, ttlMs: number, data = "", token = newToken()): string {
  db.run("DELETE FROM tokens WHERE expires_at < ?", Date.now());
  db.run("INSERT INTO tokens (hash, user_id, kind, data, expires_at) VALUES (?, ?, ?, ?, ?)", tokenHash(secret, token), userId, kind, data, Date.now() + ttlMs);
  return token;
}

/** Consumes a token: returns its user and data once, null when unknown, used or expired. */
export function takeToken(db: Db, secret: string, token: string, kind: TokenKind): { userId: number; data: string } | null {
  const hash = tokenHash(secret, token);
  const row = db.get<{ user_id: number; data: string; expires_at: number }>("SELECT user_id, data, expires_at FROM tokens WHERE hash = ? AND kind = ?", hash, kind);
  if (!row) return null;
  db.run("DELETE FROM tokens WHERE hash = ?", hash);
  return row.expires_at < Date.now() ? null : { userId: row.user_id, data: row.data };
}

export function createSession(db: Db, secret: string, userId: number): string {
  const token = newToken();
  db.run("DELETE FROM sessions WHERE expires_at < ?", Date.now());
  db.run("INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)", tokenHash(secret, token), userId, Date.now() + SESSION_DAYS * DAY);
  return token;
}

export interface User {
  id: number;
  email: string;
  verified: number;
}

export function sessionUser(db: Db, secret: string, token: string | undefined): User | null {
  if (!token) return null;
  return db.get<User>("SELECT u.id, u.email, u.verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ?", tokenHash(secret, token), Date.now()) ?? null;
}

export const endSession = (db: Db, secret: string, token: string) => db.run("DELETE FROM sessions WHERE hash = ?", tokenHash(secret, token));
export const endAllSessions = (db: Db, userId: number) => db.run("DELETE FROM sessions WHERE user_id = ?", userId);

/** A fixed-window counter per key (login, registration, mail). */
export class RateLimit {
  private readonly hits = new Map<string, { n: number; until: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  /** Counts a hit; false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until < now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.until < now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
}
