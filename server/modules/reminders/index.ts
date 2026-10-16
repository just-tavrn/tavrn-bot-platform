// SPDX-License-Identifier: Apache-2.0
/** Scheduled announcements: once, every day or every week at a time in the room's time zone. */
import { defineModule, type Settings } from "../types";
import { post, utcToWall, wallToUtc } from "../util";

interface Reminder {
  id: string;
  channel: string;
  message: string;
  repeat: "once" | "daily" | "weekly";
  at: string;
}
interface S extends Settings {
  reminders: Reminder[];
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The first run after `after` (epoch ms), or null when there is none. */
export function nextRun(r: Pick<Reminder, "repeat" | "at">, tz: string, after: number): number | null {
  if (!r.at) return null;
  const [startDate, time] = r.at.split("T") as [string, string];
  if (r.repeat === "once") {
    const t = wallToUtc(r.at, tz);
    return t > after ? t : null;
  }
  const today = utcToWall(after, tz).slice(0, 10);
  const from = today > startDate ? today : startDate;
  for (let i = 0; i <= 8; i++) {
    const d = addDays(from, i);
    if (r.repeat === "weekly" && weekday(d) !== weekday(startDate)) continue;
    const t = wallToUtc(`${d}T${time}`, tz);
    if (t > after) return t;
  }
  return null;
}

export default defineModule<S>({
  id: "reminders",
  title: "Announcements",
  description: "Scheduled messages: once, daily or weekly.",
  defaults: { reminders: [] },
  schema: [
    {
      key: "reminders",
      type: "items",
      label: "Scheduled messages",
      itemLabel: "message",
      max: 25,
      fields: [
        { key: "channel", type: "channel", label: "Channel", required: true },
        { key: "message", type: "text", label: "Message", max: 2000, required: true },
        { key: "repeat", type: "select", label: "Repeat", options: [{ value: "once", label: "Once" }, { value: "daily", label: "Every day" }, { value: "weekly", label: "Every week (on the date's weekday)" }] },
        { key: "at", type: "datetime", label: "Date and time (the room's time zone)", required: true },
      ],
    },
  ],
  register(ctx) {
    ctx.every(30_000, async () => {
      const now = Date.now();
      for (const room of ctx.enabledRooms()) {
        for (const r of ctx.settings(room).reminders) {
          const base = Number(ctx.state.get(room, `last:${r.id}`) ?? ctx.state.get(room, `since:${r.id}`) ?? now);
          if (!ctx.state.get(room, `since:${r.id}`)) ctx.state.set(room, `since:${r.id}`, String(base));
          const next = nextRun(r, room.timezone, base);
          if (next === null || next > now) continue;
          ctx.state.set(room, `last:${r.id}`, String(now));
          await post(ctx, room, r.channel, r.message);
        }
      }
    });
  },
  async onSave(ctx, room, s, previous) {
    // A new or changed reminder counts from now: a time already past is not sent at once.
    for (const r of s.reminders) {
      const old = previous.reminders.find((p) => p.id === r.id);
      if (!old || old.at !== r.at || old.repeat !== r.repeat) {
        ctx.state.set(room, `since:${r.id}`, String(Date.now()));
        ctx.state.del(room, `last:${r.id}`);
      }
    }
    return s.reminders.filter((r) => nextRun(r, room.timezone, Date.now()) === null).map((r) => `"${r.message.slice(0, 30)}" is in the past and will not be sent.`);
  },
});
