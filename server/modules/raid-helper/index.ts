// SPDX-License-Identifier: Apache-2.0
/**
 * Raid helper: events with sign-ups through components. Members pick class and spec in the card's menus and land in
 * the role the spec implies (or on the bench when it is full); Tentative, Bench and Decline are buttons; leaders and
 * moderators bench, move or remove members, close sign-ups or cancel through the Manage form. The card updates in
 * place; reminders go out 24 hours and 1 hour before. Games are data: shipped JSON files plus the room's own games.
 */
import { button, modal, row, select, textInput, withComponents, type ComponentInteraction, type Interaction } from "@tavrn/bot";
import type { Field } from "../../schema";
import { Permission, can, qualify } from "../../tavrn";
import { defineModule, type Item, type ModuleCtx, type Room, type Settings } from "../types";
import { at, formatTime, post, utcToWall, wallToUtc } from "../util";
import ff14 from "./games/ff14.json";
import wow from "./games/wow.json";
import { ROLES, parseSizes, roster, signUp, specMenus, specOf, type Game, type Role, type Signup, type Status } from "./roster";

export const SHIPPED: Game[] = [wow as Game, ff14 as Game];

interface S extends Settings {
  channel: string;
  leaderRoles: string[];
  defaultGame: string;
}
interface EventData {
  title: string;
  description: string;
  game: string;
  start: string;
  channel: string;
  leader: string;
  tanks: number;
  healers: number;
  dps: number;
  max: number;
  deadlineHours: number;
  remind24: boolean;
  remind1: boolean;
  remindDm: boolean;
}
interface EventRow {
  id: number;
  room_id: number;
  json: string;
  starts_at: number;
  status: "open" | "closed" | "cancelled";
  conversation: string;
  message_id: string;
  reminded: string;
}
type Ev = EventRow & { data: EventData };

const ICON: Record<Role, string> = { tank: "🛡️", healer: "💚", dps: "⚔️" };
const LABEL: Record<Role, string> = { tank: "Tanks", healer: "Healers", dps: "DPS" };
const HOUR = 3_600_000;

export default defineModule<S>({
  id: "raid-helper",
  title: "Raid helper",
  description: "Raid events with sign-ups by class and spec, roles, bench and reminders.",
  defaults: { channel: "", leaderRoles: [], defaultGame: "wow" },
  schema: [
    { key: "channel", type: "channel", label: "Default channel for events" },
    { key: "leaderRoles", type: "roles", label: "Raid leader roles", help: "May create and manage events (moderators always may).", max: 10 },
    { key: "defaultGame", type: "string", label: "Default game", help: "wow, ff14 or the name of one of the room's games.", max: 60 },
  ],
  commands: [
    { name: "raid", description: "Create a raid event", args: [], default_permissions: null, dm_allowed: false },
    { name: "raids", description: "Upcoming raid events", args: [], default_permissions: null, dm_allowed: false },
  ],
  collections: (ctx) => ({
    events: {
      title: "Events",
      columns: ["start", "title", "game", "signed", "status"],
      fields: (room) => eventFields(games(ctx, room)),
      list: (room) =>
        ctx.db.all<EventRow>("SELECT * FROM raid_events WHERE room_id = ? ORDER BY starts_at DESC LIMIT 200", room.id).map((r) => {
          const ev = parse(r);
          const n = signups(ctx, ev.id).filter((s) => s.status === "signed").length;
          return { ...ev.data, id: ev.id, status: ev.status, signed: ev.data.max ? `${n}/${ev.data.max}` : String(n), start: utcToWall(ev.starts_at, room.timezone) } as Item;
        }),
      save: async (room, item, id, actor) => {
        const { status, ...rest } = item as unknown as EventData & { status: EventRow["status"] };
        const data: EventData = { ...rest, channel: rest.channel || ctx.settings(room).channel, leader: rest.leader.toLowerCase() || actor };
        const startsAt = wallToUtc(data.start, room.timezone);
        let ev: Ev;
        if (id) {
          const old = byId(ctx, room, id);
          if (!old) throw new Error("This event does not exist");
          ctx.db.run("UPDATE raid_events SET json = ?, starts_at = ?, status = ? WHERE id = ?", JSON.stringify(data), startsAt, status, old.id);
          if (old.message_id && old.data.channel !== data.channel) {
            await ctx.bot.deleteMessage(old.conversation, old.message_id).catch(() => undefined);
            ctx.db.run("UPDATE raid_events SET message_id = '' WHERE id = ?", old.id);
          }
          ev = byId(ctx, room, old.id)!;
        } else {
          ev = byId(ctx, room, ctx.db.run("INSERT INTO raid_events (room_id, json, starts_at, status) VALUES (?, ?, ?, ?)", room.id, JSON.stringify(data), startsAt, status).id)!;
        }
        await publish(ctx, room, ev);
        return { id: ev.id, ...data, status };
      },
      remove: async (room, id) => {
        const ev = byId(ctx, room, id);
        if (ev?.message_id) await ctx.bot.deleteMessage(ev.conversation, ev.message_id).catch(() => undefined);
        ctx.db.run("DELETE FROM raid_events WHERE id = ? AND room_id = ?", Number(id), room.id);
      },
    },
    games: {
      title: "Games",
      columns: ["name"],
      fields: [
        { key: "name", type: "string", label: "Name", max: 60, required: true },
        {
          key: "classes",
          type: "items",
          label: "Classes",
          itemLabel: "name",
          max: 40,
          fields: [
            { key: "name", type: "string", label: "Class", max: 40, required: true },
            { key: "specs", type: "items", label: "Specs", itemLabel: "name", max: 10, fields: [{ key: "name", type: "string", label: "Spec", max: 40, required: true }, { key: "role", type: "select", label: "Role", options: ROLES.map((r) => ({ value: r, label: LABEL[r] })) }] },
          ],
        },
      ],
      list: (room) => ctx.db.all<{ id: number; json: string }>("SELECT id, json FROM raid_games WHERE room_id = ? ORDER BY id", room.id).map((g) => ({ ...JSON.parse(g.json), id: g.id })),
      save: async (room, item, id) => {
        const json = JSON.stringify({ name: item.name, classes: item.classes });
        if (id) ctx.db.run("UPDATE raid_games SET json = ? WHERE id = ? AND room_id = ?", json, Number(id), room.id);
        else id = String(ctx.db.run("INSERT INTO raid_games (room_id, json) VALUES (?, ?)", room.id, json).id);
        return { id: Number(id), ...item };
      },
      remove: (room, id) => void ctx.db.run("DELETE FROM raid_games WHERE id = ? AND room_id = ?", Number(id), room.id),
    },
  }),
  register(ctx) {
    const lead = async (i: Interaction, room: Room, s: S, ev?: Ev) => {
      if (ev && ev.data.leader === i.user.toLowerCase()) return true;
      if (can(i.permissions, Permission.MANAGE_MESSAGES)) return true;
      const m = await ctx.cache.member(room.ref, i.userId).catch(() => null);
      return !!m?.roles.some((r) => s.leaderRoles.includes(r));
    };
    /** The event of a card interaction (the card must be the event's own message). */
    const eventOf = (i: ComponentInteraction, room: Room) => {
      const ev = byId(ctx, room, (i.modalCustomId ?? i.customId ?? "").split(":")[2] ?? "");
      return ev && ev.message_id === i.messageId ? ev : null;
    };
    const open = (ev: Ev) => ev.status === "open" && Date.now() < ev.starts_at - ev.data.deadlineHours * HOUR && Date.now() < ev.starts_at;
    const save = (ev: Ev, s: Signup) =>
      ctx.db.run("INSERT INTO raid_signups (event_id, user, status, class, spec, role, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET status = excluded.status, class = excluded.class, spec = excluded.spec, role = excluded.role, at = excluded.at", ev.id, s.user, s.status, s.class, s.spec, s.role, s.at);
    const self = async (i: ComponentInteraction, room: Room, status: Status | "signup") => {
      const ev = eventOf(i, room);
      if (!ev) return i.ephemeral("This event does not exist any more.");
      if (!open(ev)) return i.ephemeral("Sign-ups for this event are closed.");
      const list = signups(ctx, ev.id);
      const mine = list.find((x) => x.user === i.user);
      if (status === "signup") {
        const last = mine?.spec ? mine : lastSpec(ctx, room, i.user, ev.data.game);
        if (!last?.spec) return i.ephemeral("Pick your class and spec in the menu of the event.");
        save(ev, signUp(list, caps(ev), i.user, last.class, last.spec, last.role as Role, mine?.status === "signed" ? mine.at : Date.now()));
      } else {
        save(ev, { user: i.user, status, class: mine?.class ?? "", spec: mine?.spec ?? "", role: mine?.role ?? "", at: Date.now() });
      }
      return i.update(card(ctx, room, ev));
    };
    ctx.component(/^raid:s:\d{1,10}$/, (i, room) => self(i, room, "signup"));
    ctx.component(/^raid:t:\d{1,10}$/, (i, room) => self(i, room, "tentative"));
    ctx.component(/^raid:b:\d{1,10}$/, (i, room) => self(i, room, "bench"));
    ctx.component(/^raid:d:\d{1,10}$/, (i, room) => self(i, room, "declined"));

    ctx.component(/^raid:spec:\d{1,10}:\d$/, (i, room) => {
      const ev = eventOf(i, room);
      if (!ev) return i.ephemeral("This event does not exist any more.");
      if (!open(ev)) return i.ephemeral("Sign-ups for this event are closed.");
      const choice = i.values?.length === 1 ? specOf(gameOf(ctx, room, ev.data.game), i.values[0]!) : null;
      if (!choice) return i.ephemeral("Pick one class and spec of the menu.");
      const list = signups(ctx, ev.id);
      const s = signUp(list, caps(ev), i.user, choice.cls, choice.spec, choice.role, Date.now());
      save(ev, s);
      return i.update(card(ctx, room, ev));
    });

    ctx.component(/^raid:m:\d{1,10}$/, async (i, room, s) => {
      const ev = eventOf(i, room);
      if (!ev) return i.ephemeral("This event does not exist any more.");
      if (!(await lead(i, room, s, ev))) return i.ephemeral("Only the raid leader and moderators can manage this event.");
      return i.modal(modal(`raid:mm:${ev.id}`, "Manage the event", textInput("member", "Member (address), empty for the event", { required: false, maxLength: 200 }), textInput("action", "bench, unbench, tank, healer, dps, remove", { maxLength: 20, placeholder: "or for the event: close, open, cancel" })));
    });
    ctx.modal(/^raid:mm:\d{1,10}$/, async (i, room, s) => {
      const ev = eventOf(i, room);
      if (!ev) return i.ephemeral("This event does not exist any more.");
      if (!(await lead(i, room, s, ev))) return i.ephemeral("Only the raid leader and moderators can manage this event.");
      const action = (i.fields.action ?? "").trim().toLowerCase();
      const who = (i.fields.member ?? "").trim().toLowerCase().replace(/^@/, "");
      if (["close", "open", "cancel"].includes(action)) {
        ctx.db.run("UPDATE raid_events SET status = ? WHERE id = ?", action === "cancel" ? "cancelled" : action === "close" ? "closed" : "open", ev.id);
        return i.update(card(ctx, room, byId(ctx, room, ev.id)!));
      }
      const target = signups(ctx, ev.id).find((x) => x.user === who);
      if (!target) return i.ephemeral(`${who || "Nobody"} has not signed up for this event.`);
      if (action === "remove") ctx.db.run("DELETE FROM raid_signups WHERE event_id = ? AND user = ?", ev.id, who);
      else if (action === "bench") save(ev, { ...target, status: "bench" });
      else if (action === "unbench") save(ev, { ...target, status: "signed" });
      else if ((ROLES as string[]).includes(action)) save(ev, { ...target, status: "signed", role: action as Role });
      else return i.ephemeral("Unknown action: use bench, unbench, tank, healer, dps, remove, close, open or cancel.");
      return i.update(card(ctx, room, ev));
    });

    ctx.command("raid", async (i, room, s) => {
      if (!(await lead(i, room, s))) return i.ephemeral("Only raid leaders and moderators can create events.");
      return i.modal(modal("raid:new", "New raid event", textInput("title", "Title", { maxLength: 100 }), textInput("when", `Date and time (${room.timezone})`, { placeholder: "2026-11-20 20:00", maxLength: 16 }), textInput("sizes", "Size: tanks/healers/dps or a total", { required: false, placeholder: "2/4/14", maxLength: 20 }), textInput("game", "Game", { required: false, value: s.defaultGame, maxLength: 60 }), textInput("description", "Description", { style: "paragraph", required: false, maxLength: 1000 })));
    });
    ctx.modal("raid:new", async (i, room, s) => {
      if (!(await lead(i, room, s))) return i.ephemeral("Only raid leaders and moderators can create events.");
      const when = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec((i.fields.when ?? "").trim());
      const sizes = parseSizes(i.fields.sizes ?? "");
      if (!when || Number.isNaN(Date.parse(`${when[1]}T${when[2]}:00Z`))) return i.ephemeral("Write the date as 2026-11-20 20:00.");
      if (!sizes) return i.ephemeral("Write the size as tanks/healers/dps (2/4/14) or as one number.");
      const game = findGame(ctx, room, i.fields.game?.trim() || s.defaultGame);
      if (!game) return i.ephemeral("Unknown game: use wow, ff14 or a game of the room's Games list.");
      const data: EventData = { title: (i.fields.title ?? "").trim().slice(0, 100) || "Raid", description: (i.fields.description ?? "").slice(0, 1000), game: game.key, start: `${when[1]}T${when[2]}`, channel: i.channelId ?? s.channel, leader: i.user.toLowerCase(), tanks: sizes.tank, healers: sizes.healer, dps: sizes.dps, max: sizes.max, deadlineHours: 0, remind24: true, remind1: true, remindDm: false };
      const id = ctx.db.run("INSERT INTO raid_events (room_id, json, starts_at) VALUES (?, ?, ?)", room.id, JSON.stringify(data), wallToUtc(data.start, room.timezone)).id;
      await publish(ctx, room, byId(ctx, room, id)!);
      return i.ephemeral(`Event created. Edit it in the dashboard: ${ctx.url(`/rooms/${room.id}/raid-helper`)}`);
    });

    ctx.command("raids", (i, room) => {
      const rows = ctx.db.all<EventRow>("SELECT * FROM raid_events WHERE room_id = ? AND status != 'cancelled' AND starts_at > ? ORDER BY starts_at LIMIT 10", room.id, Date.now()).map(parse);
      return i.ephemeral(rows.length ? rows.map((e) => `• ${e.data.title}: ${formatTime(e.starts_at, room.timezone)}`).join("\n") : "No upcoming events.");
    });

    // Reminders 24 hours and 1 hour before the start, to the channel and optionally as direct messages.
    ctx.every(60_000, async () => {
      for (const room of ctx.enabledRooms()) {
        const rows = ctx.db.all<EventRow>("SELECT * FROM raid_events WHERE room_id = ? AND status != 'cancelled' AND starts_at BETWEEN ? AND ?", room.id, Date.now(), Date.now() + 24 * HOUR).map(parse);
        for (const ev of rows) {
          for (const [key, hours, on] of [["24", 24, ev.data.remind24], ["1", 1, ev.data.remind1]] as const) {
            const done = ev.reminded.split(",");
            if (!on || done.includes(key) || Date.now() < ev.starts_at - hours * HOUR) continue;
            ctx.db.run("UPDATE raid_events SET reminded = ? WHERE id = ?", [...done.filter(Boolean), key].join(","), ev.id);
            const signed = signups(ctx, ev.id).filter((x) => x.status === "signed").map((x) => x.user);
            const text = `⏰ ${ev.data.title} starts in ${hours === 24 ? "24 hours" : "one hour"} (${formatTime(ev.starts_at, room.timezone)}).`;
            await post(ctx, room, ev.data.channel, signed.length ? `${text}\n${signed.map(at).join(" ")}` : text, signed);
            if (ev.data.remindDm) for (const u of signed) await ctx.bot.dm(u, `${text} (${room.name})`).catch(() => undefined);
          }
        }
      }
    });
  },
});

function parse(r: EventRow): Ev {
  return { ...r, data: JSON.parse(r.json) as EventData };
}
function byId(ctx: ModuleCtx<any>, room: Room, id: string | number): Ev | null {
  const r = ctx.db.get<EventRow>("SELECT * FROM raid_events WHERE id = ? AND room_id = ?", Number(id), room.id);
  return r ? parse(r) : null;
}
function signups(ctx: ModuleCtx<any>, eventId: number): Signup[] {
  return ctx.db.all<Signup>("SELECT user, status, class, spec, role, at FROM raid_signups WHERE event_id = ?", eventId);
}
const caps = (ev: Ev) => ({ max: ev.data.max, tank: ev.data.tanks, healer: ev.data.healers, dps: ev.data.dps });

/** The member's latest class and spec in this game in the room (the Sign up button reuses it). */
function lastSpec(ctx: ModuleCtx<any>, room: Room, user: string, game: string): Signup | undefined {
  return ctx.db
    .all<Signup & { json: string }>("SELECT s.user, s.status, s.class, s.spec, s.role, s.at, e.json FROM raid_signups s JOIN raid_events e ON e.id = s.event_id WHERE e.room_id = ? AND s.user = ? AND s.spec != '' ORDER BY s.at DESC LIMIT 20", room.id, user)
    .find((s) => (JSON.parse(s.json) as EventData).game === game);
}

export function games(ctx: ModuleCtx<any>, room: Room): Game[] {
  const own = ctx.db.all<{ id: number; json: string }>("SELECT id, json FROM raid_games WHERE room_id = ? ORDER BY id", room.id).map((g) => ({ ...(JSON.parse(g.json) as Omit<Game, "key">), key: `g${g.id}` }));
  return [...SHIPPED, ...own];
}
function findGame(ctx: ModuleCtx<any>, room: Room, name: string): Game | null {
  const n = name.toLowerCase();
  return games(ctx, room).find((g) => g.key === n || g.name.toLowerCase() === n) ?? null;
}
const gameOf = (ctx: ModuleCtx<any>, room: Room, key: string) => findGame(ctx, room, key) ?? SHIPPED[0]!;

function eventFields(list: Game[]): Field[] {
  const n = (key: string, label: string, max = 100): Field => ({ key, type: "number", label, min: 0, max });
  return [
    { key: "title", type: "string", label: "Title", max: 100, required: true },
    { key: "game", type: "select", label: "Game", options: list.map((g) => ({ value: g.key, label: g.name })) },
    { key: "start", type: "datetime", label: "Start (the room's time zone)", required: true },
    { key: "channel", type: "channel", label: "Channel (empty: the default)" },
    { key: "leader", type: "string", label: "Leader (address; empty: you)", max: 200 },
    { key: "description", type: "text", label: "Description", max: 1000 },
    n("tanks", "Tanks (0 = any)"),
    n("healers", "Healers (0 = any)"),
    n("dps", "DPS (0 = any)"),
    n("max", "Raid size (0 = any)"),
    n("deadlineHours", "Sign-ups close hours before the start", 168),
    { key: "remind24", type: "boolean", label: "Reminder 24 hours before" },
    { key: "remind1", type: "boolean", label: "Reminder 1 hour before" },
    { key: "remindDm", type: "boolean", label: "Reminders also as direct messages" },
    { key: "status", type: "select", label: "Status", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Sign-ups closed" }, { value: "cancelled", label: "Cancelled" }] },
  ];
}

/** The event card: the roster grouped by role with counts and caps, and the controls while it is not cancelled. */
export function card(ctx: ModuleCtx<any>, room: Room, ev: Ev): Record<string, unknown> {
  const d = ev.data;
  const game = gameOf(ctx, room, d.game);
  const r = roster(signups(ctx, ev.id));
  const who = (list: Signup[], spec = true) => (list.length ? list.map((s) => `${s.user}${spec && s.spec ? ` (${s.class} ${s.spec})` : ""}`).join(", ") : "–");
  const cap = (n: number) => (n ? `/${n}` : "");
  const signed = r.tank.length + r.healer.length + r.dps.length;
  const state = ev.status === "cancelled" ? "❌ Cancelled" : ev.status === "closed" ? "🔒 Sign-ups closed" : d.deadlineHours ? `Sign-ups close ${formatTime(ev.starts_at - d.deadlineHours * HOUR, room.timezone)}` : "Sign-ups open";
  const body = [
    `⚔️ **${d.title}** · ${game.name}`,
    `🗓️ ${formatTime(ev.starts_at, room.timezone)} · leader ${at(d.leader)}`,
    d.description,
    ...ROLES.map((role) => `${ICON[role]} ${LABEL[role]} ${r[role].length}${cap(d[role === "tank" ? "tanks" : role === "healer" ? "healers" : "dps"])}: ${who(r[role])}`),
    `🪑 Bench: ${who(r.bench)}`,
    `❔ Tentative: ${who(r.tentative)} · 🚫 Declined: ${who(r.declined, false)}`,
    `Signed up ${signed}${cap(d.max)} · ${state}`,
  ].filter(Boolean).join("\n");
  if (ev.status === "cancelled") return { type: "text", body };
  const id = ev.id;
  const rows = [];
  if (ev.status === "open") {
    rows.push(row(button({ label: "Sign up", style: "success", emoji: "✅", customId: `raid:s:${id}` }), button({ label: "Tentative", emoji: "❔", customId: `raid:t:${id}` }), button({ label: "Bench", emoji: "🪑", customId: `raid:b:${id}` }), button({ label: "Decline", style: "danger", customId: `raid:d:${id}` })));
    const menus = specMenus(game).slice(0, 3);
    menus.forEach((m, n) => rows.push(row(select(`raid:spec:${id}:${n}`, m.map((o) => ({ label: o.label, value: o.value, emoji: ICON[o.role] })), { placeholder: menus.length > 1 ? `Class and spec (${m[0]!.label.split(" – ")[0]} – ${m.at(-1)!.label.split(" – ")[0]})` : "Class and spec" }))));
  }
  rows.push(row(button({ label: "Manage", emoji: "⚙️", customId: `raid:m:${id}` })));
  return withComponents(body, ...rows);
}

/** Posts the card (first time) or edits it in place. */
async function publish(ctx: ModuleCtx<any>, room: Room, ev: Ev): Promise<void> {
  const content = card(ctx, room, ev);
  if (ev.message_id) {
    await ctx.bot.edit(ev.conversation, ev.message_id, content).catch((e: unknown) => ctx.log.warn("raid card could not be edited", { error: e }));
    return;
  }
  if (!ev.data.channel) return;
  const id = await post(ctx, room, ev.data.channel, content);
  if (id) ctx.db.run("UPDATE raid_events SET conversation = ?, message_id = ? WHERE id = ?", qualify(room.node, ev.data.channel), id, ev.id);
}
