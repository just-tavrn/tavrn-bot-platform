// SPDX-License-Identifier: Apache-2.0
/**
 * Levels: experience per message (with a cooldown), level-up messages, roles at levels, /rank, a paged
 * /leaderboard with buttons and an opt-in public leaderboard page.
 */
import { button, row, withComponents } from "@tavrn/bot";
import type { Db } from "../../db";
import { defineModule, type ModuleCtx, type Room, type Settings } from "../types";
import { at, fill, post } from "../util";

interface LevelRole {
  id: string;
  level: number;
  role: string;
}
interface S extends Settings {
  cooldownSeconds: number;
  minXp: number;
  maxXp: number;
  ignoredChannels: string[];
  ignoredRoles: string[];
  announce: "channel" | "same" | "dm" | "off";
  announceChannel: string;
  message: string;
  levelRoles: LevelRole[];
  stackRoles: boolean;
  publicLeaderboard: boolean;
}

/** Experience from level n to n + 1 (the curve most communities know). */
export const stepXp = (n: number) => 5 * n * n + 50 * n + 100;

/** The level of a total, the experience into it and the experience the next level needs. */
export function levelOf(total: number): { level: number; into: number; need: number } {
  let level = 0;
  let rest = total;
  while (rest >= stepXp(level)) rest -= stepXp(level++);
  return { level, into: rest, need: stepXp(level) };
}

/** The roles a member should hold at `level` (stacked or only the highest) and the level roles to remove. */
export function rolesFor(levelRoles: LevelRole[], level: number, stack: boolean): { add: string[]; remove: string[] } {
  const reached = levelRoles.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const add = stack ? reached.map((r) => r.role) : reached.slice(-1).map((r) => r.role);
  return { add, remove: levelRoles.map((r) => r.role).filter((r) => !add.includes(r)) };
}

const PAGE = 10;
export function leaderboard(db: Db, room: Room, page: number) {
  const total = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM xp WHERE room_id = ?", room.id)!.n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const rows = db.all<{ address: string; xp: number; messages: number }>("SELECT address, xp, messages FROM xp WHERE room_id = ? ORDER BY xp DESC, address LIMIT ? OFFSET ?", room.id, PAGE, p * PAGE);
  return { page: p, pages, entries: rows.map((r, i) => ({ rank: p * PAGE + i + 1, address: r.address, xp: r.xp, messages: r.messages, level: levelOf(r.xp).level })) };
}

function bar(into: number, need: number): string {
  const full = Math.round((into / need) * 10);
  return "█".repeat(full) + "░".repeat(10 - full);
}

function board(db: Db, room: Room, page: number) {
  const lb = leaderboard(db, room, page);
  const lines = lb.entries.map((e) => `${e.rank}. ${e.address} · level ${e.level} · ${e.xp} XP`);
  return withComponents(
    [`🏆 Leaderboard of ${room.name} (page ${lb.page + 1}/${lb.pages})`, ...(lines.length ? lines : ["Nobody has experience yet."])].join("\n"),
    row(button({ label: "Previous", customId: `levels:lb:${lb.page - 1}`, disabled: lb.page === 0 }), button({ label: "Next", customId: `levels:lb:${lb.page + 1}`, disabled: lb.page >= lb.pages - 1 })),
  );
}

async function levelUp(ctx: ModuleCtx<S>, room: Room, s: S, userId: string, address: string, level: number, channelId: string) {
  const text = fill(s.message, { user: at(address), level });
  if (s.announce === "dm") await ctx.bot.dm(address, text).catch(() => undefined);
  else if (s.announce !== "off") await post(ctx, room, s.announce === "channel" ? s.announceChannel : channelId, text, [address]);
  if (s.levelRoles.length) {
    const { add, remove } = rolesFor(s.levelRoles, level, s.stackRoles);
    await ctx.cache.changeRoles(room.ref, userId, add, remove).catch((e: unknown) => ctx.log.warn("level roles failed", { room: room.ref, error: e }));
  }
}

export default defineModule<S>({
  id: "levels",
  title: "Levels",
  description: "Experience for activity, level-up messages, level roles and a leaderboard.",
  defaults: { cooldownSeconds: 60, minXp: 15, maxXp: 25, ignoredChannels: [], ignoredRoles: [], announce: "same", announceChannel: "", message: "🎉 {user} reached level {level}!", levelRoles: [], stackRoles: true, publicLeaderboard: false },
  schema: [
    { key: "minXp", type: "number", label: "Experience per message: at least", min: 1, max: 1000 },
    { key: "maxXp", type: "number", label: "Experience per message: at most", min: 1, max: 1000 },
    { key: "cooldownSeconds", type: "number", label: "Cooldown (seconds)", help: "Only one message counts in this time.", min: 0, max: 3600 },
    { key: "ignoredChannels", type: "channels", label: "Channels without experience", max: 50 },
    { key: "ignoredRoles", type: "roles", label: "Roles without experience", max: 20 },
    { key: "announce", type: "select", label: "Level-up message", section: "Level-up", options: [{ value: "same", label: "In the same channel" }, { value: "channel", label: "In one channel" }, { value: "dm", label: "As a direct message" }, { value: "off", label: "Off" }] },
    { key: "announceChannel", type: "channel", label: "Level-up channel" },
    { key: "message", type: "text", label: "Message", help: "Placeholders: {user}, {level}.", max: 500 },
    { key: "levelRoles", type: "items", label: "Roles at levels", section: "Level roles", itemLabel: "level", max: 25, fields: [{ key: "level", type: "number", label: "Level", min: 1, max: 1000 }, { key: "role", type: "role", label: "Role", required: true }] },
    { key: "stackRoles", type: "boolean", label: "Keep the roles of lower levels" },
    { key: "publicLeaderboard", type: "boolean", label: "Public leaderboard page", section: "Leaderboard", help: "Anyone with the link sees the ranking (addresses, levels)." },
  ],
  commands: [
    { name: "rank", description: "Your level and rank", args: [{ name: "user", description: "Another member", type: "user", required: false }], default_permissions: null, dm_allowed: false },
    { name: "leaderboard", description: "The room's leaderboard", args: [], default_permissions: null, dm_allowed: false },
  ],
  register(ctx) {
    ctx.on("message", async (m, room, s) => {
      if (m.authorKind !== "user" || s.ignoredChannels.includes(m.conversationId)) return;
      if (s.ignoredRoles.length && (await ctx.cache.member(room.ref, m.authorId).catch(() => null))?.roles.some((r) => s.ignoredRoles.includes(r))) return;
      const now = Date.now();
      const row = ctx.db.get<{ xp: number; last_at: number }>("SELECT xp, last_at FROM xp WHERE room_id = ? AND user_id = ?", room.id, m.authorId);
      if (row && now - row.last_at < s.cooldownSeconds * 1000) return;
      const lo = Math.min(s.minXp, s.maxXp);
      const gain = lo + Math.floor(Math.random() * (Math.max(s.minXp, s.maxXp) - lo + 1));
      ctx.db.run(
        "INSERT INTO xp (room_id, user_id, address, xp, messages, last_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT DO UPDATE SET xp = xp + excluded.xp, messages = messages + 1, last_at = excluded.last_at, address = excluded.address",
        room.id, m.authorId, m.author.toLowerCase(), gain, now,
      );
      const before = levelOf(row?.xp ?? 0).level;
      const after = levelOf((row?.xp ?? 0) + gain).level;
      if (after > before) await levelUp(ctx, room, s, m.authorId, m.author, after, m.conversationId);
    });

    ctx.command("rank", async (i, room) => {
      const who = String(i.args.user ?? i.user).toLowerCase().replace(/^@/, "");
      const row = ctx.db.get<{ xp: number; messages: number }>("SELECT xp, messages FROM xp WHERE room_id = ? AND address = ?", room.id, who);
      if (!row) return i.ephemeral(`${who} has no experience yet.`);
      const rank = ctx.db.get<{ n: number }>("SELECT COUNT(*) + 1 AS n FROM xp WHERE room_id = ? AND xp > ?", room.id, row.xp)!.n;
      const l = levelOf(row.xp);
      return i.reply(`🏅 ${who} · level ${l.level} · rank #${rank}\n${bar(l.into, l.need)} ${l.into} / ${l.need} XP · ${row.messages} messages`);
    });
    ctx.command("leaderboard", (i, room) => i.reply(board(ctx.db, room, 0)));
    ctx.component(/^levels:lb:-?\d{1,6}$/, (i, room) => i.update(board(ctx.db, room, Number(i.customId!.split(":")[2]))));
  },
});
