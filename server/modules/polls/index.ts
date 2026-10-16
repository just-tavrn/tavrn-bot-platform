// SPDX-License-Identifier: Apache-2.0
/**
 * The bot's own polls (the node also has native polls; these show off components): `/poll` with options as
 * buttons, or without arguments a form; live counts in the message, a close button for the author and moderators,
 * an optional duration and a summary when closed.
 */
import { button, modal, row, textInput, withComponents, type Interaction } from "@tavrn/bot";
import { Permission, can } from "../../tavrn";
import { defineModule, type ModuleCtx, type Room, type Settings } from "../types";
import { formatTime, list } from "../util";

interface S extends Settings {
  liveResults: boolean;
}
interface Poll {
  id: number;
  room_id: number;
  conversation: string;
  message_id: string;
  author: string;
  question: string;
  options: string;
  multiple: number;
  closes_at: number | null;
  closed: number;
}

const MAX_OPTIONS = 10;
const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/** Votes per option and the number of voters. */
export function tally(options: number, votes: { user: string; choice: number }[]): { counts: number[]; voters: number } {
  const counts = Array.from({ length: options }, () => 0);
  for (const v of votes) if (v.choice >= 0 && v.choice < options) counts[v.choice]!++;
  return { counts, voters: new Set(votes.map((v) => v.user)).size };
}

/** Parses the inputs of /poll or its form: 2–10 options, an optional duration (1 minute to 30 days). */
export function parsePoll(question: string, options: string, minutes: unknown): { question: string; options: string[]; minutes: number | null } | string {
  const q = question.trim().slice(0, 300);
  const opts = [...new Set(list(options).map((o) => o.slice(0, 80)))];
  if (!q) return "The question is missing.";
  if (opts.length < 2 || opts.length > MAX_OPTIONS) return `Give 2 to ${MAX_OPTIONS} options, separated by ; or new lines.`;
  const m = minutes === undefined || minutes === null || minutes === "" ? null : Math.floor(Number(minutes));
  if (m !== null && (!Number.isFinite(m) || m < 1 || m > 43200)) return "The duration is 1 to 43200 minutes.";
  return { question: q, options: opts, minutes: m };
}

function card(ctx: ModuleCtx<S>, p: Poll, s: S, tz: string): Record<string, unknown> {
  const options = JSON.parse(p.options) as string[];
  const { counts, voters } = tally(options.length, ctx.db.all("SELECT user, choice FROM poll_votes WHERE poll_id = ?", p.id));
  const show = s.liveResults || p.closed;
  const best = Math.max(...counts);
  const lines = options.map((o, i) => {
    const pct = voters ? Math.round((counts[i]! / voters) * 100) : 0;
    const mark = p.closed && best > 0 && counts[i] === best ? " 🏆" : "";
    return show ? `${NUMBERS[i]} ${o} — ${counts[i]} (${pct}%)${mark}` : `${NUMBERS[i]} ${o}`;
  });
  const footer = p.closed ? `Closed · ${voters} voters` : `${voters} voters · ${p.multiple ? "several choices" : "one choice"}${p.closes_at ? ` · closes ${formatTime(p.closes_at, tz)}` : ""}`;
  const body = [`📊 **${p.question}**`, ...lines, footer].join("\n");
  if (p.closed) return { type: "text", body };
  const buttons = options.map((o, i) => button({ label: o, emoji: NUMBERS[i], customId: `poll:v:${p.id}:${i}` }));
  return withComponents(body, row(...buttons.slice(0, 5)), ...(buttons.length > 5 ? [row(...buttons.slice(5))] : []), row(button({ label: "Close poll", style: "danger", customId: `poll:close:${p.id}` })));
}

export default defineModule<S>({
  id: "polls",
  title: "Polls",
  description: "Polls with buttons, live results and an optional end time.",
  defaults: { liveResults: true },
  schema: [{ key: "liveResults", type: "boolean", label: "Show results while the poll is open" }],
  commands: [
    {
      name: "poll",
      description: "Start a poll (without arguments: a form)",
      args: [
        { name: "question", description: "The question", type: "string", required: false, max_length: 300 },
        { name: "options", description: "Options separated by ;", type: "string", required: false, max_length: 900 },
        { name: "minutes", description: "Closes after this many minutes", type: "integer", required: false, min: 1, max: 43200 },
        { name: "multiple", description: "Allow several choices", type: "boolean", required: false },
      ],
      default_permissions: null,
      dm_allowed: false,
    },
  ],
  register(ctx) {
    const byId = (id: string | undefined, room: Room) => ctx.db.get<Poll>("SELECT * FROM polls WHERE id = ? AND room_id = ?", Number(id), room.id);
    const create = async (i: Interaction, room: Room, s: S, question: string, options: string, minutes: unknown, multiple: boolean) => {
      const parsed = parsePoll(question, options, minutes);
      if (typeof parsed === "string") return i.ephemeral(parsed);
      const closes = parsed.minutes ? Date.now() + parsed.minutes * 60_000 : null;
      const id = ctx.db.run("INSERT INTO polls (room_id, conversation, author, question, options, multiple, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?)", room.id, i.conversation, i.user, parsed.question, JSON.stringify(parsed.options), multiple ? 1 : 0, closes).id;
      const p = ctx.db.get<Poll>("SELECT * FROM polls WHERE id = ?", id)!;
      const sent = await ctx.bot.send(i.conversation, card(ctx, p, s, room.timezone), { threadId: i.threadId });
      ctx.db.run("UPDATE polls SET message_id = ? WHERE id = ?", sent.id, id);
      return i.ephemeral("Your poll is up.");
    };
    const close = async (p: Poll, room: Room, s: S) => {
      ctx.db.run("UPDATE polls SET closed = 1 WHERE id = ?", p.id);
      return card(ctx, { ...p, closed: 1 }, s, room.timezone);
    };

    ctx.command("poll", (i, room, s) => {
      if (!i.args.question) return i.modal(modal("poll:create", "New poll", textInput("question", "Question", { maxLength: 300 }), textInput("options", "Options (one per line)", { style: "paragraph", maxLength: 900 }), textInput("minutes", "Close after minutes (optional)", { required: false, maxLength: 5 })));
      return create(i, room, s, String(i.args.question), String(i.args.options ?? ""), i.args.minutes, i.args.multiple === true);
    });
    ctx.modal("poll:create", (i, room, s) => create(i, room, s, i.fields.question ?? "", i.fields.options ?? "", i.fields.minutes, false));

    ctx.component(/^poll:v:\d{1,10}:\d$/, (i, room, s) => {
      const [, , id, choice] = i.customId!.split(":");
      const p = byId(id, room);
      const n = Number(choice);
      if (!p || p.message_id !== i.messageId) return i.ephemeral("This poll does not exist.");
      if (p.closed) return i.ephemeral("This poll is closed.");
      if (n >= (JSON.parse(p.options) as string[]).length) return i.ephemeral("That option does not exist.");
      ctx.db.tx(() => {
        const had = !!ctx.db.get("SELECT 1 FROM poll_votes WHERE poll_id = ? AND user = ? AND choice = ?", p.id, i.user, n);
        if (!p.multiple) ctx.db.run("DELETE FROM poll_votes WHERE poll_id = ? AND user = ?", p.id, i.user);
        if (had) ctx.db.run("DELETE FROM poll_votes WHERE poll_id = ? AND user = ? AND choice = ?", p.id, i.user, n);
        else ctx.db.run("INSERT INTO poll_votes (poll_id, user, choice) VALUES (?, ?, ?)", p.id, i.user, n);
      });
      return i.update(card(ctx, p, s, room.timezone));
    });

    ctx.component(/^poll:close:\d{1,10}$/, async (i, room, s) => {
      const p = byId(i.customId!.split(":")[2], room);
      if (!p || p.message_id !== i.messageId) return i.ephemeral("This poll does not exist.");
      if (p.author !== i.user && !can(i.permissions, Permission.MANAGE_MESSAGES)) return i.ephemeral("Only the author or a moderator can close this poll.");
      return i.update(await close(p, room, s));
    });

    ctx.every(30_000, async () => {
      for (const p of ctx.db.all<Poll>("SELECT * FROM polls WHERE closed = 0 AND closes_at IS NOT NULL AND closes_at <= ?", Date.now())) {
        const room = ctx.room(p.room_id);
        if (!room) continue;
        await ctx.bot.edit(p.conversation, p.message_id, await close(p, room, ctx.settings(room))).catch((e: unknown) => ctx.log.warn("poll could not be closed", { error: e }));
      }
    });
  },
});
