// SPDX-License-Identifier: Apache-2.0
/**
 * Polls are tavrn's own (PROTOCOL.md §7g): `/poll` opens a form and the bot creates a native poll, which every
 * client shows with its own voting UI (encrypted where the channel is). The bot only adds a summary of the results
 * when a timed poll closes. By default only members who may send polls themselves (create_polls) can use /poll.
 */
import { modal, textInput } from "@tavrn/bot";
import { Permission, can } from "../../tavrn";
import { defineModule, type Settings } from "../types";
import { list } from "../util";

interface S extends Settings {
  summary: boolean;
  allowWithoutPermission: boolean;
}

/** The form's inputs as a poll: 2–10 options, 1–10 choices, an optional duration (1 minute to 30 days). */
export function parsePoll(f: Record<string, string>): { question: string; options: string[]; maxChoices: number; minutes: number | null } | string {
  const question = (f.question ?? "").trim();
  const options = [...new Set(list(f.options ?? ""))];
  if (!question) return "The question is missing.";
  if (options.length < 2 || options.length > 10) return "Give 2 to 10 options, one per line.";
  if (options.some((o) => o.length > 100)) return "An option has at most 100 characters.";
  const minutes = f.minutes?.trim() ? Number(f.minutes) : null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200)) return "The duration is 1 to 43200 minutes.";
  const maxChoices = f.choices?.trim() ? Number(f.choices) : 1;
  if (!Number.isInteger(maxChoices) || maxChoices < 1 || maxChoices > options.length) return "Choices per member: 1 up to the number of options.";
  return { question, options, maxChoices, minutes };
}

/** The summary posted when a poll closes. */
export function summary(question: string, t: { voters: number; options: { id: string; label: string; count: number }[]; best: string[] }): string {
  if (!t.voters) return `📊 "${question}" closed without votes.`;
  const lines = t.options.map((o) => `${o.label}: ${o.count} (${Math.round((o.count / t.voters) * 100)}%)${t.best.includes(o.id) ? " 🏆" : ""}`);
  return [`📊 Results of "${question}" (${t.voters} ${t.voters === 1 ? "vote" : "votes"}):`, ...lines].join("\n");
}

export default defineModule<S>({
  id: "polls",
  title: "Polls",
  description: "Native tavrn polls through a form, with a results summary when they close.",
  defaults: { summary: true, allowWithoutPermission: false },
  schema: [
    { key: "summary", type: "boolean", label: "Post a summary when a timed poll closes" },
    { key: "allowWithoutPermission", type: "boolean", label: "Members without “Send polls” may use /poll", help: "The bot then creates the poll for them (its role needs Send polls)." },
  ],
  commands: [{ name: "poll", description: "Start a poll", args: [], default_permissions: null, dm_allowed: false }],
  register(ctx) {
    ctx.command("poll", (i, _room, s) => {
      if (!s.allowWithoutPermission && !can(i.permissions, Permission.CREATE_POLLS)) return i.ephemeral("You may not send polls in this channel.");
      return i.modal(
        modal(
          "poll:create",
          "New poll",
          textInput("question", "Question", { maxLength: 300 }),
          textInput("options", "Options (one per line)", { style: "paragraph", maxLength: 1100 }),
          textInput("choices", "Choices per member (default 1)", { required: false, maxLength: 2 }),
          textInput("minutes", "Close after minutes (optional)", { required: false, maxLength: 5 }),
        ),
      );
    });
    ctx.modal("poll:create", async (i, room, s) => {
      if (!s.allowWithoutPermission && !can(i.permissions, Permission.CREATE_POLLS)) return i.ephemeral("You may not send polls in this channel.");
      const p = parsePoll(i.fields);
      if (typeof p === "string") return i.ephemeral(p);
      const closesAt = p.minutes ? new Date(Date.now() + p.minutes * 60_000) : null;
      const message = await ctx.bot.createPoll(i.conversation, { kind: "choice", question: p.question, options: p.options, maxChoices: p.maxChoices }, { closesAt, threadId: i.threadId });
      if (closesAt && s.summary) ctx.db.run("INSERT INTO polls (room_id, conversation, message_id, question, closes_at) VALUES (?, ?, ?, ?, ?)", room.id, i.conversation, message.id, p.question, closesAt.getTime());
      return i.ephemeral("Your poll is up.");
    });
    ctx.every(30_000, async () => {
      const due = ctx.db.all<{ id: number; room_id: number; conversation: string; message_id: string; question: string }>("SELECT * FROM polls WHERE done = 0 AND closes_at <= ?", Date.now());
      for (const p of due) {
        ctx.db.run("UPDATE polls SET done = 1 WHERE id = ?", p.id);
        const room = ctx.room(p.room_id);
        if (!room || !ctx.settings(room).enabled) continue;
        try {
          const { tally } = await ctx.bot.votes(p.conversation, p.message_id);
          await ctx.bot.send(p.conversation, summary(p.question, tally), { replyTo: p.message_id });
        } catch (e) {
          ctx.log.warn("poll summary failed", { room: room.ref, error: e });
        }
      }
    });
  },
});
