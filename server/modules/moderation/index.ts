// SPDX-License-Identifier: Apache-2.0
/**
 * Moderation commands with a case log: /warn /warnings /timeout /kick /ban /unban /purge /slowmode. Every command
 * checks the invoker's permission in the channel and the role hierarchy itself (the palette's filter is only a
 * convenience); /ban and /purge ask for confirmation with buttons that only the invoker may press.
 */
import { randomBytes } from "node:crypto";
import { button, row, withComponents, type Interaction } from "@tavrn/bot";
import { Permission, can } from "../../tavrn";
import { defineModule, type Room, type Settings } from "../types";
import { at, post } from "../util";

interface S extends Settings {
  logChannel: string;
  dmOnAction: boolean;
  confirmBan: boolean;
}

const user = { name: "user", description: "The member (address)", type: "user", required: true } as const;
const reason = { name: "reason", description: "Reason", type: "string", required: false, max_length: 500 } as const;
const perm = (bit: bigint) => String(bit);
const MAX_REASON = 500;

interface Pending {
  run: () => Promise<string>;
  invoker: string;
  expires: number;
}

export default defineModule<S>({
  id: "moderation",
  title: "Moderation",
  description: "Commands for moderators with a case log and a mod-log channel.",
  defaults: { logChannel: "", dmOnAction: true, confirmBan: true },
  schema: [
    { key: "logChannel", type: "channel", label: "Mod-log channel", help: "Every case is posted here." },
    { key: "dmOnAction", type: "boolean", label: "Tell the member by direct message" },
    { key: "confirmBan", type: "boolean", label: "Ask before banning" },
  ],
  commands: [
    { name: "warn", description: "Warn a member", args: [user, { ...reason, required: true }], default_permissions: perm(Permission.MODERATE_MEMBERS), dm_allowed: false },
    { name: "warnings", description: "List the cases of a member", args: [user], default_permissions: perm(Permission.MODERATE_MEMBERS), dm_allowed: false },
    { name: "timeout", description: "Time a member out", args: [user, { name: "minutes", description: "Minutes (0 lifts it)", type: "integer", required: true, min: 0, max: 40320 }, reason], default_permissions: perm(Permission.MODERATE_MEMBERS), dm_allowed: false },
    { name: "kick", description: "Remove a member from the room", args: [user, reason], default_permissions: perm(Permission.KICK_MEMBERS), dm_allowed: false },
    { name: "ban", description: "Ban a member", args: [user, reason], default_permissions: perm(Permission.BAN_MEMBERS), dm_allowed: false },
    { name: "unban", description: "Lift a ban", args: [user], default_permissions: perm(Permission.BAN_MEMBERS), dm_allowed: false },
    { name: "purge", description: "Delete the latest messages of this channel", args: [{ name: "count", description: "How many (1–100)", type: "integer", required: true, min: 1, max: 100 }, { ...user, required: false, description: "Only messages of this member" }], default_permissions: perm(Permission.PURGE), dm_allowed: false },
    { name: "slowmode", description: "Set the slowmode of a channel", args: [{ name: "seconds", description: "Seconds between messages (0 = off)", type: "integer", required: true, min: 0, max: 21600 }, { name: "channel", description: "Channel (default: this one)", type: "channel", required: false }], default_permissions: perm(Permission.MANAGE_CHANNELS), dm_allowed: false },
  ],
  collections: (ctx) => ({
    cases: {
      title: "Cases",
      readonly: true,
      fields: [],
      columns: ["id", "created", "action", "target", "moderator", "reason"],
      list: (room) =>
        ctx.db.all<{ id: number; created_at: number }>("SELECT id, action, target, moderator, reason, created_at FROM cases WHERE room_id = ? ORDER BY id DESC LIMIT 500", room.id).map(({ created_at, ...c }) => ({ ...c, created: new Date(created_at).toISOString().slice(0, 16).replace("T", " ") })),
    },
  }),
  register(ctx) {
    const pending = new Map<string, Pending>();
    const text = (v: unknown) => String(v ?? "").slice(0, MAX_REASON).trim();
    const address = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/^@/, "");

    /** The permission check of every command; null when allowed, else the refusal was sent. */
    const allowed = (i: Interaction, bit: bigint) => (can(i.permissions, bit) ? null : i.ephemeral("You do not have the permission for this."));

    /** The target as a member below the invoker (kick, timeout, warn), or the refusal. */
    const target = async (i: Interaction, room: Room, needMember: boolean) => {
      const a = address(i.args.user);
      if (!a || a === i.user.toLowerCase()) return { refusal: "Choose another member." };
      const m = await ctx.cache.memberByAddress(room.ref, a);
      if (!m) return needMember ? { refusal: `${a} is not a member of this room.` } : { address: a, id: null };
      if (m.address === ctx.bot.info.address.toLowerCase()) return { refusal: "I will not act on myself." };
      if (!(await ctx.cache.outranks(room.ref, i.userId, m.id))) return { refusal: "You can only act on members below your highest role." };
      return { address: a, id: m.id };
    };

    const record = async (room: Room, s: S, action: string, who: string, by: string, why: string) => {
      const n = ctx.addCase(room, action, who, by, why);
      await post(ctx, room, s.logChannel, `🔨 Case #${n}: ${action} ${at(who)} by ${at(by)}${why ? ` (${why})` : ""}`);
      return n;
    };
    const tell = (s: S, room: Room, who: string, what: string, why: string) =>
      s.dmOnAction ? ctx.bot.dm(who, `${what} in ${room.name}${why ? `: ${why}` : "."}`).catch((e: unknown) => ctx.log.warn("moderation DM failed", { error: e })) : undefined;

    const confirm = (i: Interaction, question: string, run: () => Promise<string>) => {
      const token = randomBytes(9).toString("base64url");
      pending.set(token, { run, invoker: i.user, expires: Date.now() + 120_000 });
      return i.reply(withComponents(question, row(button({ label: "Confirm", style: "danger", customId: `mod:yes:${token}` }), button({ label: "Cancel", customId: `mod:no:${token}` }))));
    };
    ctx.every(60_000, () => {
      for (const [k, p] of pending) if (p.expires < Date.now()) pending.delete(k);
    });
    ctx.component(/^mod:(yes|no):[\w-]{12}$/, async (i) => {
      const [, answer, token] = (i.customId ?? "").split(":");
      const p = pending.get(token!);
      if (!p || p.expires < Date.now()) return i.update("This confirmation expired.");
      if (p.invoker !== i.user) return i.ephemeral("Only the moderator who asked can confirm this.");
      pending.delete(token!);
      return i.update(answer === "yes" ? await p.run() : "Cancelled.");
    });

    ctx.command("warn", async (i, room, s) => {
      if (allowed(i, Permission.MODERATE_MEMBERS)) return;
      const t = await target(i, room, true);
      if ("refusal" in t) return i.ephemeral(t.refusal!);
      const why = text(i.args.reason);
      await tell(s, room, t.address, "You were warned", why);
      const n = await record(room, s, "warn", t.address, i.user, why);
      return i.reply(`⚠️ ${at(t.address)} was warned (case #${n}): ${why}`, { mentions: [t.address] });
    });

    ctx.command("warnings", async (i, room) => {
      if (allowed(i, Permission.MODERATE_MEMBERS)) return;
      const a = address(i.args.user);
      const rows = ctx.db.all<{ id: number; action: string; reason: string; created_at: number }>("SELECT id, action, reason, created_at FROM cases WHERE room_id = ? AND target = ? ORDER BY id DESC LIMIT 15", room.id, a);
      if (!rows.length) return i.ephemeral(`${a} has no cases.`);
      return i.ephemeral([`Cases of ${a}:`, ...rows.map((r) => `#${r.id} ${new Date(r.created_at).toISOString().slice(0, 10)} ${r.action}${r.reason ? `: ${r.reason}` : ""}`)].join("\n"));
    });

    ctx.command("timeout", async (i, room, s) => {
      if (allowed(i, Permission.MODERATE_MEMBERS)) return;
      const t = await target(i, room, true);
      if ("refusal" in t) return i.ephemeral(t.refusal!);
      const minutes = Math.max(0, Math.min(40320, Math.floor(Number(i.args.minutes) || 0)));
      const why = text(i.args.reason);
      await ctx.bot.timeout(room.ref, t.id!, minutes, { reason: why || undefined });
      if (minutes) await tell(s, room, t.address, `You were timed out for ${minutes} minutes`, why);
      const n = await record(room, s, minutes ? `timeout ${minutes} min` : "timeout lifted", t.address, i.user, why);
      return i.reply(minutes ? `⏳ ${at(t.address)} is timed out for ${minutes} minutes (case #${n}).` : `${at(t.address)} may write again (case #${n}).`);
    });

    ctx.command("kick", async (i, room, s) => {
      if (allowed(i, Permission.KICK_MEMBERS)) return;
      const t = await target(i, room, true);
      if ("refusal" in t) return i.ephemeral(t.refusal!);
      const why = text(i.args.reason);
      await tell(s, room, t.address, "You were removed", why);
      await ctx.bot.kick(room.ref, t.id!, { reason: why || undefined });
      const n = await record(room, s, "kick", t.address, i.user, why);
      return i.reply(`👢 ${at(t.address)} was removed (case #${n}).`);
    });

    ctx.command("ban", async (i, room, s) => {
      if (allowed(i, Permission.BAN_MEMBERS)) return;
      const t = await target(i, room, false);
      if ("refusal" in t) return i.ephemeral(t.refusal!);
      const why = text(i.args.reason);
      const run = async () => {
        await tell(s, room, t.address, "You were banned", why);
        await ctx.bot.ban(room.ref, t.address, { reason: why || undefined });
        return `🔨 ${at(t.address)} was banned (case #${await record(room, s, "ban", t.address, i.user, why)}).`;
      };
      return s.confirmBan ? confirm(i, `Ban ${at(t.address)}${why ? ` (${why})` : ""}?`, run) : i.reply(await run());
    });

    ctx.command("unban", async (i, room, s) => {
      if (allowed(i, Permission.BAN_MEMBERS)) return;
      const a = address(i.args.user);
      await ctx.bot.unban(room.ref, a);
      return i.reply(`${at(a)} is no longer banned (case #${await record(room, s, "unban", a, i.user, "")}).`);
    });

    ctx.command("purge", async (i, room, s) => {
      if (allowed(i, Permission.PURGE) || !i.channelId) return;
      const count = Math.max(1, Math.min(100, Math.floor(Number(i.args.count) || 1)));
      const only = i.args.user ? await ctx.cache.memberByAddress(room.ref, address(i.args.user)) : null;
      if (i.args.user && !only) return i.ephemeral("That member is not in this room.");
      const recent = (await ctx.bot.messages(i.conversation, { limit: 100 })).filter((m) => !only || m.authorId === only.id).slice(0, count);
      if (!recent.length) return i.ephemeral("There is nothing to delete.");
      const from = recent.map((m) => m.createdAt).sort()[0]!;
      const api = ctx.bot.api(room.node).moderation;
      const req = { channel_ids: [i.channelId], from, to: new Date().toISOString(), author_id: only?.id ?? null };
      const preview = await api.purge(room.roomId, req);
      if (!preview.messages || !preview.confirm_token) return i.ephemeral("There is nothing to delete.");
      return confirm(i, `Delete ${preview.messages} messages${only ? ` of ${at(only.address)}` : ""}?`, async () => {
        const done = await api.purge(room.roomId, { ...req, confirm_token: preview.confirm_token });
        await record(room, s, `purge ${done.messages}`, only?.address ?? `#${i.channelId}`, i.user, "");
        return `🧹 Deleted ${done.messages} messages.`;
      });
    });

    ctx.command("slowmode", async (i, room) => {
      if (allowed(i, Permission.MANAGE_CHANNELS)) return;
      const channel = String(i.args.channel ?? i.channelId ?? "");
      const seconds = Math.max(0, Math.min(21600, Math.floor(Number(i.args.seconds) || 0)));
      await ctx.bot.api(room.node).channels.update(room.roomId, channel, { slowmode_secs: seconds });
      return i.ephemeral(seconds ? `Slowmode: one message per ${seconds} seconds.` : "Slowmode is off.");
    });
  },
});

