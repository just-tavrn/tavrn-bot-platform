// SPDX-License-Identifier: Apache-2.0
/**
 * Moderation with a case log. Kicks, bans, timeouts and purges are tavrn's own (the client's `/kick`, `/ban`, …): the
 * module reads the room's audit log every minute and turns them into cases with the mod-log line and the DM to the
 * member. It adds what tavrn has not: `/warn`, `/warnings` and `/case`, and the dashboard's forms to time out, kick,
 * ban and unban, which check the platform user's own permissions and rank in tavrn first.
 */
import type { AuditEntry } from "@tavrn/sdk";
import { Permission, can } from "../../tavrn";
import { ValidationError, type Field } from "../../schema";
import { defineModule, type Collection, type ModuleCtx, type Room, type Settings } from "../types";
import { at, post } from "../util";

interface S extends Settings {
  logChannel: string;
  dmOnAction: boolean;
}

const user = { name: "user", description: "The member (address)", type: "user", required: true } as const;
const perm = (bit: bigint) => String(bit);
const MAX_REASON = 500;
const AUDIT_PAGE = 100;
const ADDRESS = /^[^@\s]+@[^@\s]+$/;
/** `@alice@node` for an address, anything else (a domain, "member in #channel") as it is. */
const handle = (x: string) => (ADDRESS.test(x) ? at(x) : x);

/** A case read from an audit entry; `authorId` and `channels` only for purges. */
export interface AuditCase {
  action: string;
  target: string;
  actorId: string;
  reason: string;
  authorId: string | null;
  channels: string[];
  /** The DM to the member, or null. */
  tell: string | null;
}

/** The node's audit entries that are moderation cases (kick, ban, unban, timeout, purge); null for the others. */
export function auditCase(e: AuditEntry): AuditCase | null {
  const meta = e.meta ?? {};
  const base = { target: e.target.toLowerCase(), actorId: e.actor_id ?? "", reason: (e.reason ?? "").slice(0, MAX_REASON), authorId: null, channels: [] as string[] };
  const minutes = Number(meta.minutes) || 0;
  switch (e.action) {
    case "member.kick":
      return { ...base, action: "kick", tell: "You were removed" };
    case "member.ban":
      return { ...base, action: "ban", tell: ADDRESS.test(base.target) ? "You were banned" : null };
    case "member.unban":
      return { ...base, action: "unban", tell: null };
    case "member.timeout":
      return { ...base, action: `timeout ${minutes} min`, tell: `You were timed out for ${minutes} minutes` };
    case "member.timeout_clear":
      return { ...base, action: "timeout lifted", tell: null };
    case "moderation.purge": {
      const channels = Array.isArray(meta.channels) ? meta.channels.filter((c): c is string => typeof c === "string") : [];
      return { ...base, action: `purge ${Number(meta.deleted) || 0}`, target: "", authorId: typeof meta.author_id === "string" ? meta.author_id : null, channels, tell: null };
    }
    default:
      return null;
  }
}

const member: Field = { key: "member", type: "string", label: "Member", help: "The address, e.g. alice@node.example", max: 200, required: true };
const reasonField: Field = { key: "reason", type: "string", label: "Reason", max: MAX_REASON };
type Kind = "timeout" | "kick" | "ban" | "unban";
const BITS: Record<Kind, bigint> = { timeout: Permission.MODERATE_MEMBERS, kick: Permission.KICK_MEMBERS, ban: Permission.BAN_MEMBERS, unban: Permission.BAN_MEMBERS };

export default defineModule<S>({
  id: "moderation",
  title: "Moderation",
  description: "A case log for tavrn's own kicks, bans, timeouts and purges, warnings, and member actions on the web.",
  defaults: { logChannel: "", dmOnAction: true },
  schema: [
    { key: "logChannel", type: "channel", label: "Mod-log channel", help: "Every case is posted here, also those of the client's own /kick, /ban, /timeout and /purge (the bot needs View audit log)." },
    { key: "dmOnAction", type: "boolean", label: "Tell the member by direct message" },
  ],
  commands: [
    { name: "warn", description: "Warn a member", args: [user, { name: "reason", description: "Reason", type: "string", required: true, max_length: MAX_REASON }], default_permissions: perm(Permission.MODERATE_MEMBERS), dm_allowed: false },
    { name: "warnings", description: "List the cases of a member", args: [user], default_permissions: perm(Permission.MODERATE_MEMBERS), dm_allowed: false },
    { name: "case", description: "Show one moderation case", args: [{ name: "id", description: "The case number", type: "integer", required: true, min: 1 }], default_permissions: perm(Permission.MODERATE_MEMBERS), dm_allowed: false },
  ],
  collections: (ctx) => {
    const form = (kind: Kind, title: string, fields: Field[]): Collection => ({ title, fields, columns: [], save: async (room, item, _id, actor) => ({ id: 0, message: await act(ctx, room, kind, actor, item) }) });
    return {
      cases: {
        title: "Cases",
        readonly: true,
        fields: [],
        columns: ["id", "created", "action", "target", "moderator", "reason"],
        list: (room) =>
          ctx.db.all<{ id: number; created_at: number }>("SELECT id, action, target, moderator, reason, created_at FROM cases WHERE room_id = ? ORDER BY id DESC LIMIT 500", room.id).map(({ created_at, ...c }) => ({ ...c, created: new Date(created_at).toISOString().slice(0, 16).replace("T", " ") })),
      },
      timeout: form("timeout", "Time out a member", [member, { key: "minutes", type: "number", label: "Minutes (0 lifts the timeout)", min: 0, max: 40320 }, reasonField]),
      kick: form("kick", "Kick a member", [member, reasonField]),
      ban: form("ban", "Ban a member", [member, reasonField]),
      unban: form("unban", "Lift a ban", [member]),
    };
  },
  register(ctx) {
    const address = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/^@/, "");

    ctx.command("warn", async (i, room, s) => {
      if (!can(i.permissions, Permission.MODERATE_MEMBERS)) return i.ephemeral("You do not have the permission for this.");
      const a = address(i.args.user);
      if (!a || a === i.user.toLowerCase()) return i.ephemeral("Choose another member.");
      const m = await ctx.cache.memberByAddress(room.ref, a);
      if (!m) return i.ephemeral(`${a} is not a member of this room.`);
      if (!(await ctx.cache.outranks(room.ref, i.userId, m.id))) return i.ephemeral("You can only act on members below your highest role.");
      const why = String(i.args.reason ?? "").slice(0, MAX_REASON).trim();
      const n = await record(ctx, room, s, { action: "warn", target: a, by: i.user, reason: why, tell: "You were warned" });
      return i.reply(`⚠️ ${at(a)} was warned (case #${n}): ${why}`, { mentions: [a] });
    });

    ctx.command("warnings", async (i, room) => {
      if (!can(i.permissions, Permission.MODERATE_MEMBERS)) return i.ephemeral("You do not have the permission for this.");
      const a = address(i.args.user);
      const rows = ctx.db.all<CaseRow>("SELECT * FROM cases WHERE room_id = ? AND target = ? ORDER BY id DESC LIMIT 15", room.id, a);
      if (!rows.length) return i.ephemeral(`${a} has no cases.`);
      return i.ephemeral([`Cases of ${a}:`, ...rows.map((r) => `#${r.id} ${new Date(r.created_at).toISOString().slice(0, 10)} ${r.action}${r.reason ? `: ${r.reason}` : ""}`)].join("\n"));
    });

    ctx.command("case", async (i, room) => {
      if (!can(i.permissions, Permission.MODERATE_MEMBERS)) return i.ephemeral("You do not have the permission for this.");
      const c = ctx.db.get<CaseRow>("SELECT * FROM cases WHERE room_id = ? AND id = ?", room.id, Math.floor(Number(i.args.id) || 0));
      if (!c) return i.ephemeral("There is no such case in this room.");
      return i.ephemeral(`Case #${c.id} · ${new Date(c.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC\n${c.action} ${c.target ? at(c.target) : ""} by ${c.moderator}${c.reason ? `\nReason: ${c.reason}` : ""}`);
    });

    const quiet = new Set<number>();
    ctx.every(60_000, async () => {
      for (const room of ctx.enabledRooms()) {
        try {
          await syncAudit(ctx, room);
          quiet.delete(room.id);
        } catch (e) {
          // Logged once per room: a room that did not grant View audit log would fill the log every minute.
          if (!quiet.has(room.id)) ctx.log.warn("audit log could not be read", { room: room.ref, error: e });
          quiet.add(room.id);
        }
      }
    });
  },
  async onSave(ctx, room, s, previous) {
    // Switched on (again): the audit log counts from now, older entries do not become cases.
    if (s.enabled && !previous.enabled) ctx.state.del(room, "audit");
    return [];
  },
});

interface CaseRow {
  id: number;
  action: string;
  target: string;
  moderator: string;
  reason: string;
  created_at: number;
}

/** Records a case, tells the member (if the room wants it) and posts the mod-log line; returns the case number. */
async function record(ctx: ModuleCtx<S>, room: Room, s: S, c: { action: string; target: string; by: string; reason: string; tell: string | null }): Promise<number> {
  if (c.tell && s.dmOnAction && ADDRESS.test(c.target)) {
    await ctx.bot.dm(c.target, `${c.tell} in ${room.name}${c.reason ? `: ${c.reason}` : "."}`).catch((e: unknown) => ctx.log.warn("moderation DM failed", { error: e }));
  }
  const n = ctx.addCase(room, c.action, c.target, c.by, c.reason);
  await post(ctx, room, s.logChannel, `🔨 Case #${n}: ${c.action} ${handle(c.target)} by ${handle(c.by)}${c.reason ? ` (${c.reason})` : ""}`);
  return n;
}

/**
 * Reads the room's audit log since the last seen entry (one request of up to 100 entries) and records its moderation
 * entries as cases. Entries of the bot itself are skipped: the bot recorded those cases when it acted.
 */
export async function syncAudit(ctx: ModuleCtx<S>, room: Room): Promise<void> {
  const last = ctx.state.get(room, "audit");
  const entries = await ctx.bot.auditLog(room.ref, { limit: AUDIT_PAGE });
  if (!entries.length) return;
  ctx.state.set(room, "audit", entries[0]!.id);
  if (last === null) return;
  const s = ctx.settings(room);
  const self = new Set([ctx.bot.info.userId, (await ctx.cache.memberByAddress(room.ref, ctx.bot.info.address).catch(() => null))?.id]);
  const name = async (id: string) => (await ctx.cache.member(room.ref, id).catch(() => null))?.address ?? id;
  for (const e of entries.filter((x) => x.id > last).reverse()) {
    const c = auditCase(e);
    if (!c || self.has(c.actorId)) continue;
    let target = c.target;
    if (c.action.startsWith("purge")) {
      const channels = await ctx.cache.channels(room.ref).catch(() => []);
      const where = c.channels.length ? c.channels.map((id) => `#${channels.find((ch) => ch.id === id)?.name ?? id}`).join(" ") : "all channels";
      target = c.authorId ? `${await name(c.authorId)} in ${where}` : where;
    }
    await record(ctx, room, s, { action: c.action, target, by: c.actorId ? await name(c.actorId) : "tavrn", reason: c.reason, tell: c.tell });
  }
}

/**
 * A member action from the dashboard. The platform user (`actor`: their address in the room) must still hold the
 * permission in tavrn and rank above the member; the node checks the bot's own permission and rank again.
 */
async function act(ctx: ModuleCtx<S>, room: Room, kind: Kind, actor: string, item: Record<string, unknown>): Promise<string> {
  const refuse = (m: string): never => {
    throw new ValidationError("member", m);
  };
  const a = String(item.member ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!ADDRESS.test(a)) refuse("give the member's address (alice@node.example)");
  const me = await ctx.cache.memberByAddress(room.ref, actor).catch(() => null);
  if (!me || !can(await ctx.cache.permissions(room.ref, me.id), BITS[kind])) refuse(`you may not ${kind} members in this room`);
  if (a === actor) refuse("choose another member");
  const m = await ctx.cache.memberByAddress(room.ref, a).catch(() => null);
  if (!m && (kind === "timeout" || kind === "kick")) refuse(`${a} is not a member of this room`);
  if (m && m.address === ctx.bot.info.address.toLowerCase()) refuse("the bot will not act on itself");
  if (m && kind !== "unban" && !(await ctx.cache.outranks(room.ref, me!.id, m.id))) refuse("you can only act on members below your highest role");

  const s = ctx.settings(room);
  const why = String(item.reason ?? "").slice(0, MAX_REASON).trim();
  const opts = { reason: why || undefined };
  const minutes = Math.max(0, Math.min(40320, Math.floor(Number(item.minutes) || 0)));
  const tavrn = (p: Promise<unknown>) => p.catch((e: unknown) => refuse(`tavrn refused: ${e instanceof Error ? e.message : String(e)}`));
  const tell = { timeout: minutes ? `You were timed out for ${minutes} minutes` : null, kick: "You were removed", ban: "You were banned", unban: null }[kind];
  // The member hears of a kick or ban before it happens: afterwards the bot may not reach them any more.
  if (tell && s.dmOnAction && kind !== "timeout") await ctx.bot.dm(a, `${tell} in ${room.name}${why ? `: ${why}` : "."}`).catch(() => undefined);
  if (kind === "timeout") await tavrn(ctx.bot.timeout(room.ref, m!.id, minutes, opts));
  if (kind === "kick") await tavrn(ctx.bot.kick(room.ref, m!.id, opts));
  if (kind === "ban") await tavrn(ctx.bot.ban(room.ref, a, opts));
  if (kind === "unban") await tavrn(ctx.bot.unban(room.ref, a));
  const action = kind === "timeout" ? (minutes ? `timeout ${minutes} min` : "timeout lifted") : kind;
  const n = await record(ctx, room, s, { action, target: a, by: actor, reason: why, tell: kind === "timeout" ? tell : null });
  return `Done: ${action} ${a} (case #${n}).`;
}
