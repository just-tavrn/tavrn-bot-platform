// SPDX-License-Identifier: Apache-2.0
/**
 * Polls are tavrn's own (PROTOCOL.md §7g): members create them with the client's `/poll`, every client shows them with
 * its own voting UI (encrypted where the channel is). This module creates native polls from the dashboard, now or at
 * a set time, posts a summary of the results when a timed poll of the bot closes, and lists the results of the polls
 * it created or saw votes for.
 */
import { qualify, split } from "../../tavrn";
import { ValidationError } from "../../schema";
import { defineModule, type ModuleCtx, type Room, type Settings } from "../types";
import { formatTime, list, wallToUtc } from "../util";

interface S extends Settings {
  summary: boolean;
}
interface PollRow {
  id: number;
  room_id: number;
  conversation: string;
  message_id: string;
  question: string;
  closes_at: number;
  done: number;
  json: string;
  posts_at: number;
  own: number;
  tally: string;
}
interface Tally {
  voters: number;
  closed?: boolean;
  options: { id?: string; label: string; count: number }[];
  best?: string[];
}
export interface PollInput {
  channel: string;
  question: string;
  options: string[];
  maxChoices: number;
  minutes: number | null;
}

/** The form as a poll: 2–10 options, 1–10 choices, an optional duration (1 minute to 30 days). */
export function parsePoll(f: Record<string, unknown>): PollInput | string {
  const question = String(f.question ?? "").trim();
  const options = [...new Set(list(String(f.options ?? "")))];
  if (!question) return "The question is missing.";
  if (options.length < 2 || options.length > 10) return "Give 2 to 10 options, one per line.";
  if (options.some((o) => o.length > 100)) return "An option has at most 100 characters.";
  const minutes = Number(f.minutes) || null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200)) return "The duration is 1 to 43200 minutes.";
  const maxChoices = Number(f.choices) || 1;
  if (!Number.isInteger(maxChoices) || maxChoices < 1 || maxChoices > options.length) return "Choices per member: 1 up to the number of options.";
  return { channel: String(f.channel ?? ""), question, options, maxChoices, minutes };
}

/** The summary posted when a poll closes. */
export function summary(question: string, t: Tally): string {
  if (!t.voters) return `📊 "${question}" closed without votes.`;
  const lines = t.options.map((o) => `${o.label}: ${o.count} (${Math.round((o.count / t.voters) * 100)}%)${o.id && t.best?.includes(o.id) ? " 🏆" : ""}`);
  return [`📊 Results of "${question}" (${t.voters} ${t.voters === 1 ? "vote" : "votes"}):`, ...lines].join("\n");
}

const brief = (t: Tally) => ({ voters: t.voters, closed: t.closed, options: (t.options ?? []).map((o) => ({ label: o.label, count: o.count })) });

export default defineModule<S>({
  id: "polls",
  title: "Polls",
  description: "Native tavrn polls from the dashboard, now or scheduled, with results and a summary when they close.",
  defaults: { summary: true },
  schema: [{ key: "summary", type: "boolean", label: "Post a summary when a timed poll of the bot closes" }],
  collections: (ctx) => ({
    polls: {
      title: "Polls",
      noEdit: true,
      fields: [
        { key: "channel", type: "channel", label: "Channel", required: true },
        { key: "question", type: "string", label: "Question", max: 300, required: true },
        { key: "options", type: "text", label: "Options (one per line, 2 to 10)", max: 1100, required: true },
        { key: "choices", type: "number", label: "Choices per member", min: 1, max: 10 },
        { key: "minutes", type: "number", label: "Close after minutes (0: stays open)", min: 0, max: 43200 },
        { key: "postAt", type: "datetime", label: "Post at (the room's time zone; empty: now)" },
      ],
      columns: ["question", "results", "status"],
      list: async (room) => {
        await refresh(ctx, room);
        const now = Date.now();
        return ctx.db.all<PollRow>("SELECT * FROM polls WHERE room_id = ? ORDER BY id DESC LIMIT 100", room.id).map((p) => {
          const t = p.tally ? (JSON.parse(p.tally) as Tally) : null;
          const status = !p.message_id ? (p.done ? "not posted" : `scheduled ${formatTime(p.posts_at, room.timezone)}`) : t?.closed || (p.closes_at && p.closes_at <= now) ? "closed" : "open";
          const results = t ? `${t.options.map((o) => `${o.label}: ${o.count}`).join(" · ")} (${t.voters} ${t.voters === 1 ? "vote" : "votes"})` : "";
          return { id: p.id, question: p.question || "…", results, status };
        });
      },
      save: async (room, item) => {
        const p = parsePoll(item);
        if (typeof p === "string") throw new ValidationError("poll", p);
        const at = item.postAt ? wallToUtc(String(item.postAt), room.timezone) : 0;
        const id = ctx.db.run("INSERT INTO polls (room_id, conversation, message_id, question, closes_at, json, posts_at) VALUES (?, ?, '', ?, 0, ?, ?)", room.id, qualify(room.node, p.channel), p.question, JSON.stringify(p), at).id;
        if (at <= Date.now()) await publish(ctx, ctx.db.get<PollRow>("SELECT * FROM polls WHERE id = ?", id)!, true);
        return { id, question: p.question };
      },
      // A posted poll stays in tavrn (close it there); a scheduled one is not posted.
      remove: (room, id) => void ctx.db.run("DELETE FROM polls WHERE room_id = ? AND id = ?", room.id, Number(id)),
    },
  }),
  register(ctx) {
    // Votes mark the poll for a fresh count when the dashboard lists it; a poll of somebody else is added to the list.
    ctx.bot.on("pollVote", async (e) => {
      if (ctx.db.run("UPDATE polls SET dirty = 1 WHERE conversation = ? AND message_id = ?", e.conversation, e.messageId).changes) return;
      const channel = split(e.conversation).id;
      for (const room of ctx.enabledRooms().filter((r) => r.node === e.node)) {
        if (!(await ctx.cache.channels(room.ref).catch(() => [])).some((c) => c.id === channel)) continue;
        ctx.db.run("INSERT INTO polls (room_id, conversation, message_id, question, closes_at, own, dirty) VALUES (?, ?, ?, '', 0, 0, 1)", room.id, e.conversation, e.messageId);
        return;
      }
    });
    ctx.every(30_000, async () => {
      const now = Date.now();
      for (const p of ctx.db.all<PollRow>("SELECT * FROM polls WHERE message_id = '' AND done = 0 AND posts_at <= ?", now)) await publish(ctx, p, false);
      for (const p of ctx.db.all<PollRow>("SELECT * FROM polls WHERE own = 1 AND done = 0 AND message_id != '' AND closes_at > 0 AND closes_at <= ?", now)) {
        ctx.db.run("UPDATE polls SET done = 1 WHERE id = ?", p.id);
        const room = ctx.room(p.room_id);
        if (!room || !ctx.settings(room).enabled) continue;
        try {
          const { tally } = await ctx.bot.votes(p.conversation, p.message_id);
          ctx.db.run("UPDATE polls SET tally = ?, dirty = 0 WHERE id = ?", JSON.stringify(brief(tally as Tally)), p.id);
          if (ctx.settings(room).summary) await ctx.bot.send(p.conversation, summary(p.question, tally as Tally), { replyTo: p.message_id });
        } catch (e) {
          ctx.log.warn("poll summary failed", { room: room.ref, error: e });
        }
      }
    });
  },
});

/** Posts a stored poll; a failure marks it as not posted (from the dashboard: the error is shown). */
async function publish(ctx: ModuleCtx<S>, p: PollRow, fromForm: boolean): Promise<void> {
  const room = ctx.room(p.room_id);
  if (!room || (!fromForm && !ctx.settings(room).enabled)) return;
  const input = JSON.parse(p.json) as PollInput;
  const closesAt = input.minutes ? new Date(Date.now() + input.minutes * 60_000) : null;
  try {
    const message = await ctx.bot.createPoll(p.conversation, { kind: "choice", question: input.question, options: input.options, maxChoices: input.maxChoices }, { closesAt });
    ctx.db.run("UPDATE polls SET message_id = ?, closes_at = ? WHERE id = ?", message.id, closesAt?.getTime() ?? 0, p.id);
  } catch (e) {
    ctx.db.run(fromForm ? "DELETE FROM polls WHERE id = ?" : "UPDATE polls SET done = 1 WHERE id = ?", p.id);
    ctx.log.warn("poll could not be posted", { room: room.ref, error: e });
    if (fromForm) throw new ValidationError("channel", `the poll could not be posted: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Counts the votes of the room's polls that got votes since the last look (at most 10 per look). */
async function refresh(ctx: ModuleCtx<S>, room: Room): Promise<void> {
  for (const p of ctx.db.all<PollRow>("SELECT * FROM polls WHERE room_id = ? AND dirty = 1 ORDER BY id DESC LIMIT 10", room.id)) {
    try {
      const r = await ctx.bot.votes(p.conversation, p.message_id);
      const closes = r.closesAt ? Date.parse(r.closesAt) : p.closes_at;
      ctx.db.run("UPDATE polls SET tally = ?, question = ?, closes_at = ?, dirty = 0 WHERE id = ?", JSON.stringify(brief(r.tally as Tally)), r.poll.question, closes, p.id);
    } catch (e) {
      ctx.log.debug("poll votes could not be read", { room: room.ref, error: e });
    }
  }
}
