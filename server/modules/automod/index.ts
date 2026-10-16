// SPDX-License-Identifier: Apache-2.0
/**
 * Auto-moderation on the bot's side, next to the node's own automod (MODERATION.md): blocked words, links and
 * invites, capitals, mention spam, floods, repeated messages and new accounts, each with its own action. Moderators
 * (Manage messages), exempt roles and channels are skipped. The log names the rule, never the message's content (it
 * may come from an encrypted channel).
 */
import type { BotMessage } from "@tavrn/bot";
import { Permission, can } from "../../tavrn";
import { defineModule, type ModuleCtx, type Room, type Settings } from "../types";
import { at, post } from "../util";
import { History, check, compileWord, type Action, type RuleSettings } from "./rules";
import type { Field } from "../../schema";

interface S extends Settings, RuleSettings {
  logChannel: string;
  exemptRoles: string[];
  exemptChannels: string[];
  exemptModerators: boolean;
  timeoutMinutes: number;
  ageOn: boolean;
  ageDays: number;
  ageAction: Action;
}

const ACTIONS = [
  { value: "delete", label: "Delete the message" },
  { value: "warn", label: "Delete and warn" },
  { value: "timeout", label: "Delete and time out" },
  { value: "kick", label: "Delete and kick" },
  { value: "ban", label: "Delete and ban" },
];
const action = (key: string): Field => ({ key, type: "select", label: "Action", options: ACTIONS });
const on = (key: string, label: string, section: string): Field => ({ key, type: "boolean", label, section });

export default defineModule<S>({
  id: "automod",
  title: "Auto-moderation",
  description: "Removes spam, blocked words, unwanted links, floods and more, and acts on the author.",
  defaults: {
    logChannel: "", exemptRoles: [], exemptChannels: [], exemptModerators: true, timeoutMinutes: 10,
    wordsOn: false, words: [], wordsAction: "warn",
    linksOn: false, allowedDomains: [], invitesOn: false, linksAction: "delete",
    capsOn: false, capsPercent: 70, capsMinLength: 10, capsAction: "delete",
    mentionsOn: false, mentionsMax: 5, mentionsAction: "timeout",
    floodOn: false, floodCount: 5, floodSeconds: 5, floodAction: "timeout",
    dupOn: false, dupCount: 3, dupSeconds: 30, dupAction: "delete",
    ageOn: false, ageDays: 3, ageAction: "kick",
  },
  schema: [
    { key: "logChannel", type: "channel", label: "Log channel", help: "Every action is noted here." },
    { key: "timeoutMinutes", type: "number", label: "Timeout length (minutes)", min: 1, max: 40320 },
    { key: "exemptModerators", type: "boolean", label: "Skip moderators (Manage messages)" },
    { key: "exemptRoles", type: "roles", label: "Exempt roles", max: 20 },
    { key: "exemptChannels", type: "strings", label: "Exempt channel ids", help: "Channel ids, one per entry.", max: 50 },
    on("wordsOn", "Block words", "Blocked words"),
    { key: "words", type: "strings", label: "Words", help: "Whole words, case-insensitive; /regex/ for patterns (no nested quantifiers).", max: 200 },
    action("wordsAction"),
    on("linksOn", "Block links outside the allow-list", "Links and invites"),
    { key: "allowedDomains", type: "strings", label: "Allowed domains", help: "Subdomains are allowed too.", max: 100 },
    { key: "invitesOn", type: "boolean", label: "Block invite links" },
    action("linksAction"),
    on("capsOn", "Limit capital letters", "Capital letters"),
    { key: "capsPercent", type: "number", label: "Maximum share of capitals (%)", min: 50, max: 100 },
    { key: "capsMinLength", type: "number", label: "Only for messages with at least this many letters", min: 1, max: 1000 },
    action("capsAction"),
    on("mentionsOn", "Limit mentions", "Mention spam"),
    { key: "mentionsMax", type: "number", label: "Maximum mentions per message", min: 1, max: 50 },
    action("mentionsAction"),
    on("floodOn", "Limit message rate", "Flood"),
    { key: "floodCount", type: "number", label: "Messages", min: 2, max: 50 },
    { key: "floodSeconds", type: "number", label: "Within seconds", min: 1, max: 600 },
    action("floodAction"),
    on("dupOn", "Limit repeated messages", "Repeated messages"),
    { key: "dupCount", type: "number", label: "Same message this many times", min: 2, max: 20 },
    { key: "dupSeconds", type: "number", label: "Within seconds", min: 5, max: 3600 },
    action("dupAction"),
    on("ageOn", "Act on new accounts when they join", "New accounts"),
    { key: "ageDays", type: "number", label: "Accounts younger than days", min: 1, max: 365 },
    { key: "ageAction", type: "select", label: "Action", options: [{ value: "warn", label: "Only log" }, { value: "timeout", label: "Time out" }, { value: "kick", label: "Kick" }, { value: "ban", label: "Ban" }] },
  ],
  register(ctx) {
    const histories = new Map<string, History>();
    ctx.every(10 * 60_000, () => histories.clear());

    ctx.on("message", async (m, room, s) => {
      if (m.authorKind !== "user" || s.exemptChannels.includes(m.conversationId)) return;
      const member = await ctx.cache.member(room.ref, m.authorId).catch(() => null);
      if (member?.roles.some((r) => s.exemptRoles.includes(r))) return;
      if (s.exemptModerators && can(await ctx.cache.permissions(room.ref, m.authorId).catch(() => 0n), Permission.MANAGE_MESSAGES)) return;
      const key = `${room.id}:${m.authorId}`;
      const h = histories.get(key) ?? new History();
      histories.set(key, h);
      const msg = { text: m.text, mentions: m.mentions.length, at: Date.now() };
      h.push(msg, 3_600_000);
      const v = check(s, msg, h);
      if (v) await act(ctx, room, s, m, v.action, v.reason);
    });

    ctx.on("memberJoin", async (e, room, s) => {
      const created = Date.parse(e.profile?.created_at ?? "");
      if (!s.ageOn || !e.user || Number.isNaN(created) || Date.now() - created > s.ageDays * 86_400_000) return;
      await act(ctx, room, s, { author: e.user, authorId: e.userId }, s.ageAction, `account younger than ${s.ageDays} days`);
    });
  },
  async onSave(_ctx, _room, s) {
    return s.words.flatMap((w) => {
      const r = compileWord(w);
      return typeof r === "string" ? [`Blocked word "${w}" is ignored: ${r}`] : [];
    });
  },
});

/** Deletes the message (if any), applies the action, records a case and writes the log line. */
async function act(ctx: ModuleCtx<S>, room: Room, s: S, m: Pick<BotMessage, "author" | "authorId"> & Partial<BotMessage>, action: Action, reason: string) {
  const fail = (what: string) => (e: unknown) => ctx.log.warn(`automod could not ${what}`, { room: room.ref, error: e });
  if (m.id && m.conversation) await ctx.bot.deleteMessage(m.conversation, m.id).catch(fail("delete"));
  const why = `automod: ${reason}`;
  if (action === "warn" && m.conversationId) await post(ctx, room, m.conversationId, `${at(m.author)}, please keep to the rules (${reason}).`, [m.author]);
  if (action === "timeout") await ctx.bot.timeout(room.ref, m.authorId, s.timeoutMinutes, { reason: why }).catch(fail("time out"));
  if (action === "kick") await ctx.bot.kick(room.ref, m.authorId, { reason: why }).catch(fail("kick"));
  if (action === "ban") await ctx.bot.ban(room.ref, m.author, { reason: why }).catch(fail("ban"));
  const n = action === "delete" ? null : ctx.addCase(room, action, m.author, "automod", reason);
  await post(ctx, room, s.logChannel, `🛡️ Automod${n ? ` · case #${n}` : ""}: ${action} ${at(m.author)} (${reason})`);
}
