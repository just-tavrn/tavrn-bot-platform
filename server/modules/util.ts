// SPDX-License-Identifier: Apache-2.0
/** Helpers shared by the modules: templates, sending to a room's channel, time zones. */
import { qualify } from "../tavrn";
import type { ModuleCtx, Room } from "./types";

/** Replaces `{name}` placeholders; unknown ones stay as they are. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-z_.]+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}

/** Sends to a channel of the room; failures are logged, not thrown (a missing channel must not stop the module). */
export async function post(ctx: ModuleCtx<any>, room: Room, channelId: string, content: string | Record<string, unknown>, mentions: string[] = []): Promise<string | null> {
  if (!channelId) return null;
  try {
    const m = await ctx.bot.send(qualify(room.node, channelId), content, { mentions: mentions.length ? mentions : undefined });
    return m.id;
  } catch (e) {
    ctx.log.warn("could not post", { room: room.ref, channel: channelId, error: e });
    return null;
  }
}

/** The member's handle in a text: `@alice@node.example`. */
export const at = (address: string) => `@${address}`;

/** Wall-clock parts of an instant in a time zone. */
function parts(ms: number, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === "weekday") out.weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.value);
    else if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** "YYYY-MM-DDTHH:mm" in `tz` → epoch milliseconds (DST gaps resolve forward). */
export function wallToUtc(wall: string, tz: string): number {
  const guess = Date.parse(`${wall}:00Z`);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const p = parts(t, tz);
    const shown = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    t += guess - shown;
  }
  return t;
}

/** Epoch milliseconds → "YYYY-MM-DDTHH:mm" in `tz` (the value of a datetime field). */
export function utcToWall(ms: number, tz: string): string {
  const p = parts(ms, tz);
  const z = (n: number | undefined) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

export const weekdayIn = (ms: number, tz: string) => parts(ms, tz).weekday!;

/** "Fri, 20 Nov 2026, 20:00 (Europe/Berlin)" */
export function formatTime(ms: number, tz: string): string {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  return tz === "UTC" ? `${s} UTC` : `${s} (${tz})`;
}

/** Splits "a; b; c" or lines into trimmed, non-empty entries. */
export const list = (s: string) => s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
