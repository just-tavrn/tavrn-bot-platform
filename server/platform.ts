// SPDX-License-Identifier: Apache-2.0
/**
 * The platform core: connected rooms, module settings, the gate that runs a module's handlers only in connected rooms
 * where it is on, the `/connect` and `/dashboard` commands, the announcement of all commands and the scheduler.
 */
import { appTokenClaims, type BotLogger, type Interaction } from "@tavrn/bot";
import { resolveNode } from "@tavrn/sdk";
import type { CommandDefinition } from "@tavrn/sdk";
import { normalizeCode, takeToken } from "./auth";
import type { Config } from "./config";
import type { Db } from "./db";
import type { Collection, Module, ModuleCtx, Room, Settings } from "./modules/types";
import { clean, type Field, type RoomChoices } from "./schema";
import { CLIENT_COMMANDS, Permission, RoomCache, can, qualify, split, type BotPort } from "./tavrn";

interface RoomRow {
  id: number;
  ref: string;
  name: string;
  timezone: string;
  installed: number;
  disabled: number;
}

/** `<origin>/add/<application id>` without a double slash. */
export const addLinkOf = (origin: string, app: string): string => `${origin.replace(/\/+$/, "")}/add/${app}`;

export const ENABLED_FIELD: Field = { key: "enabled", type: "boolean", label: "Enabled" };
const ANNOUNCE_DELAY_MS = 20_000;
const MAX_COMMANDS = 100;

const CORE_COMMANDS: CommandDefinition[] = [
  { name: "connect", description: "Connect this room to your dashboard account", args: [{ name: "code", description: "The code shown in the dashboard", type: "string", required: true, max_length: 20 }], default_permissions: String(Permission.MANAGE_ROOM), dm_allowed: false },
  { name: "dashboard", description: "Link to this room's dashboard", args: [], default_permissions: null, dm_allowed: false },
];

export class Platform {
  readonly cache: RoomCache;
  readonly status = { online: false, address: null as string | null, error: null as string | null };
  private readonly settingsCache = new Map<string, Settings>();
  private readonly ctxs = new Map<string, ModuleCtx>();
  private readonly collectionsOf = new Map<string, Record<string, Collection>>();
  private readonly jobs: [number, () => unknown][] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private announceTimer: NodeJS.Timeout | null = null;
  private announced = "";

  constructor(
    readonly config: Config,
    readonly db: Db,
    readonly bot: BotPort,
    readonly log: BotLogger,
    readonly modules: Module<any>[],
  ) {
    this.cache = new RoomCache(bot, log);
    this.cache.listen();
    this.registerCore();
    for (const m of modules) {
      const ctx = this.makeCtx(m);
      this.ctxs.set(m.id, ctx);
      m.register(ctx);
      this.collectionsOf.set(m.id, m.collections?.(ctx) ?? {});
    }
  }

  /** The origin of the home node's web client (discovery `web`), where the add link lives; null until discovered. */
  private webOrigin: string | null = null;

  /**
   * The add link of the bot (APPLICATIONS.md §4.1): `<web client>/add/<application id>`. The web client is where the
   * discovery document points (`tavrn.org` keeps its client on `app.tavrn.org`); until it is known, the domain.
   */
  get addLink(): string | null {
    if (this.config.fakeBot) return "https://fake.example/add/01FAKEAPP";
    try {
      const c = appTokenClaims(this.config.botToken);
      return addLinkOf(this.webOrigin ?? `https://${c.iss}`, c.app);
    } catch {
      return null;
    }
  }

  /** Discovers the home node's web client once (retried on the next start when the node was not reachable). */
  async discoverWeb(): Promise<void> {
    if (this.config.fakeBot || !this.config.botToken) return;
    try {
      const { web } = await resolveNode(appTokenClaims(this.config.botToken).iss);
      this.webOrigin = web;
    } catch (e) {
      this.log.warn("the home node's web client was not discovered; the add link uses the domain", { error: e });
    }
  }

  module(id: string): Module | null {
    return this.modules.find((m) => m.id === id) ?? null;
  }
  collections(id: string): Record<string, Collection> {
    return this.collectionsOf.get(id) ?? {};
  }

  // ---- Rooms -------------------------------------------------------------------------------------

  private toRoom(r: RoomRow): Room {
    const { node, id } = split(r.ref);
    return { id: r.id, ref: r.ref, node, roomId: id, name: r.name, timezone: r.timezone, installed: !!r.installed, disabled: !!r.disabled };
  }
  roomById(id: number): Room | null {
    const r = this.db.get<RoomRow>("SELECT * FROM rooms WHERE id = ?", id);
    return r ? this.toRoom(r) : null;
  }
  roomByRef(ref: string): Room | null {
    const r = this.db.get<RoomRow>("SELECT * FROM rooms WHERE ref = ?", ref);
    return r ? this.toRoom(r) : null;
  }
  rooms(): Room[] {
    return this.db.all<RoomRow>("SELECT * FROM rooms ORDER BY id").map((r) => this.toRoom(r));
  }

  /** What channel and role fields may name in this room (null when the bot cannot read the room right now). */
  async choices(room: Room): Promise<RoomChoices> {
    try {
      const d = await this.cache.detail(room.ref);
      return { channels: new Set(d.channels.map((c) => c.id)), roles: new Set(d.roles.filter((r) => !r.is_everyone).map((r) => r.id)) };
    } catch {
      return { channels: null, roles: null };
    }
  }

  // ---- Settings ----------------------------------------------------------------------------------

  settings<S extends Settings>(room: Room, m: Module<S>): S {
    const key = `${room.id}:${m.id}`;
    let s = this.settingsCache.get(key);
    if (!s) {
      const row = this.db.get<{ json: string }>("SELECT json FROM room_settings WHERE room_id = ? AND module = ?", room.id, m.id);
      s = { enabled: false, ...structuredClone(m.defaults), ...(row ? (JSON.parse(row.json) as object) : {}) } as Settings;
      this.settingsCache.set(key, s);
    }
    return s as S;
  }

  /** Checks, stores and applies a module's settings; returns them with the module's warnings. */
  async saveSettings(room: Room, m: Module, input: unknown): Promise<{ settings: Settings; warnings: string[] }> {
    const previous = this.settings(room, m);
    const settings = clean([ENABLED_FIELD, ...m.schema], input, { enabled: false, ...m.defaults }, await this.choices(room)) as Settings;
    this.db.run("INSERT INTO room_settings (room_id, module, json) VALUES (?, ?, ?) ON CONFLICT (room_id, module) DO UPDATE SET json = excluded.json", room.id, m.id, JSON.stringify(settings));
    this.settingsCache.set(`${room.id}:${m.id}`, settings);
    let warnings: string[] = [];
    if (m.onSave) warnings = await m.onSave(this.ctxs.get(m.id)!, room, settings, previous).catch((e: unknown) => [e instanceof Error ? e.message : String(e)]);
    if (m.dynamicCommands) this.scheduleAnnounce();
    return { settings, warnings };
  }

  /** Is the module on in this connected, enabled room? Else the notice for the member. */
  private gate(m: Module, node: string, roomId: string | null): { room: Room; settings: Settings } | { notice: string } {
    if (!roomId) return { notice: "This works in rooms only." };
    const room = this.roomByRef(qualify(node, roomId));
    if (!room) return { notice: `This room is not connected yet. A room manager connects it at ${this.config.baseUrl}.` };
    if (room.disabled) return { notice: "This room is disabled on the platform." };
    const settings = this.settings(room, m);
    if (!settings.enabled) return { notice: `${m.title} is switched off in this room.` };
    return { room, settings };
  }

  private makeCtx(m: Module): ModuleCtx {
    const run = (i: Interaction, fn: (room: Room, s: Settings) => unknown) => {
      const g = this.gate(m, i.node, i.roomId);
      return "notice" in g ? i.ephemeral(g.notice) : fn(g.room, g.settings);
    };
    const key = (room: Room, k: string) => [room.id, m.id, k] as const;
    return {
      bot: this.bot,
      db: this.db,
      log: this.log,
      config: this.config,
      cache: this.cache,
      settings: (room) => this.settings(room, m),
      enabledRooms: () => this.rooms().filter((r) => r.installed && !r.disabled && this.settings(r, m).enabled),
      room: (id) => this.roomById(id),
      command: (name, h) => void this.bot.command(name, (i) => run(i, (room, s) => h(i, room, s))),
      component: (id, h) => void this.bot.component(id, (i) => run(i, (room, s) => h(i, room, s))),
      modal: (id, h) => void this.bot.modal(id, (i) => run(i, (room, s) => h(i, room, s))),
      on: (event, h) =>
        void this.bot.on(event, ((e: { node: string; roomId: string | null }) => {
          const g = this.gate(m, e.node, e.roomId);
          if (!("notice" in g)) return h(e as never, g.room, g.settings);
        }) as never),
      every: (ms, fn) => void this.jobs.push([ms, fn]),
      state: {
        get: (room, k) => this.db.get<{ value: string }>("SELECT value FROM module_state WHERE room_id = ? AND module = ? AND key = ?", ...key(room, k))?.value ?? null,
        set: (room, k, v) =>
          void this.db.run("INSERT INTO module_state (room_id, module, key, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", ...key(room, k), v, Date.now()),
        del: (room, k) => void this.db.run("DELETE FROM module_state WHERE room_id = ? AND module = ? AND key = ?", ...key(room, k)),
      },
      addCase: (room, action, target, moderator, reason) =>
        this.db.run("INSERT INTO cases (room_id, action, target, moderator, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)", room.id, action, target, moderator, reason, Date.now()).id,
      url: (path) => `${this.config.baseUrl}${path}`,
    };
  }

  // ---- Core commands and installations -----------------------------------------------------------

  private registerCore(): void {
    this.bot.command("connect", (i) => this.connect(i));
    this.bot.command("dashboard", (i) => {
      const room = i.roomId ? this.roomByRef(qualify(i.node, i.roomId)) : null;
      return i.ephemeral(room ? `Dashboard of this room: ${this.config.baseUrl}/rooms/${room.id}` : `Connect this room at ${this.config.baseUrl}/dashboard`);
    });
    this.bot.on("install", (e) => {
      this.db.run("UPDATE rooms SET installed = 1, name = ? WHERE ref = ?", e.roomName, qualify(e.node, e.roomId));
    });
    this.bot.on("uninstall", (e) => {
      const ref = qualify(e.node, e.roomId);
      this.db.run("UPDATE rooms SET installed = 0 WHERE ref = ?", ref);
      this.cache.drop(ref);
    });
    this.bot.on("error", (e) => {
      const code = (e as { code?: string }).code;
      if (code === "token_refused" || code === "replaced") Object.assign(this.status, { online: false, error: code });
    });
  }

  /** `/connect <code>`: the invoker must manage the room (checked here, whatever the palette showed). */
  async connect(i: Interaction): Promise<unknown> {
    if (!i.roomId) return i.ephemeral("Run /connect in the room you want to connect.");
    if (!can(i.permissions, Permission.MANAGE_ROOM)) return i.ephemeral("You need the permission Manage room to connect this room.");
    const code = normalizeCode(String(i.args.code ?? ""));
    const token = code.length === 8 ? takeToken(this.db, this.config.sessionSecret, code, "connect") : null;
    if (!token) return i.ephemeral("This code is unknown or expired. Create a new one in the dashboard.");
    const ref = qualify(i.node, i.roomId);
    const name = await this.bot.room(ref).then((r) => r.name, () => "");
    const roomId = this.db.tx(() => {
      this.db.run("INSERT INTO rooms (ref, name, created_at) VALUES (?, ?, ?) ON CONFLICT (ref) DO UPDATE SET installed = 1, name = CASE WHEN excluded.name = '' THEN rooms.name ELSE excluded.name END", ref, name, Date.now());
      const id = this.db.get<{ id: number }>("SELECT id FROM rooms WHERE ref = ?", ref)!.id;
      this.db.run("INSERT INTO room_managers (room_id, user_id, address, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET address = excluded.address", id, token.userId, i.user.toLowerCase(), Date.now());
      return id;
    });
    this.log.info("room connected", { room: ref, user: token.userId });
    return i.ephemeral(`Connected. Manage this room at ${this.config.baseUrl}/rooms/${roomId}`);
  }

  /** Still a manager of the room in tavrn (owner, administrator or Manage room)? Unknown (room unreadable): true. */
  async stillManages(room: Room, address: string): Promise<boolean> {
    try {
      const m = await this.cache.memberByAddress(room.ref, address);
      if (!m) return false;
      return can(await this.cache.permissions(room.ref, m.id), Permission.MANAGE_ROOM);
    } catch {
      return true;
    }
  }

  // ---- Commands ----------------------------------------------------------------------------------

  /**
   * All definitions: core, modules, then the dynamic ones that do not collide (at most 100, APPLICATIONS.md §5.1);
   * never a name of the client's own commands.
   */
  commandSet(): CommandDefinition[] {
    const out = new Map<string, CommandDefinition>();
    const free = (name: string) => !out.has(name) && !CLIENT_COMMANDS.has(name);
    for (const d of [...CORE_COMMANDS, ...this.modules.flatMap((m) => m.commands ?? [])]) if (free(d.name)) out.set(d.name, d);
    for (const m of this.modules) {
      if (!m.dynamicCommands) continue;
      const ctx = this.ctxs.get(m.id)!;
      for (const { definition, handler } of m.dynamicCommands(ctx)) {
        if (!free(definition.name) || out.size >= MAX_COMMANDS) continue;
        out.set(definition.name, definition);
        ctx.command(definition.name, handler);
      }
    }
    return [...out.values()];
  }

  async announce(): Promise<void> {
    const set = this.commandSet();
    const json = JSON.stringify(set);
    if (json === this.announced || !this.status.online) return;
    await this.bot.setCommands(set);
    this.announced = json;
    this.log.info("commands announced", { count: set.length });
  }

  /** Announces after a quiet period: the node allows 10 announcements per hour. */
  scheduleAnnounce(): void {
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => void this.announce().catch((e: unknown) => this.log.warn("commands could not be announced", { error: e })), ANNOUNCE_DELAY_MS);
    this.announceTimer.unref?.();
  }

  // ---- Lifecycle ---------------------------------------------------------------------------------

  async start(): Promise<void> {
    for (const [ms, fn] of this.jobs) {
      const t = setInterval(() => {
        if (!this.status.online) return;
        Promise.resolve()
          .then(fn)
          .catch((e: unknown) => this.log.warn("scheduled job failed", { error: e }));
      }, ms);
      t.unref?.();
      this.timers.push(t);
    }
    await this.connectBot();
  }

  /** Starts the bot; a failed start rejects (a stopped runtime cannot start again: main.ts restarts the process). */
  private async connectBot(): Promise<void> {
    try {
      await this.bot.start();
      Object.assign(this.status, { online: true, error: null, address: this.bot.info.address });
      await this.announce().catch((e: unknown) => this.log.warn("commands could not be announced", { error: e }));
    } catch (e) {
      Object.assign(this.status, { online: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    if (this.announceTimer) clearTimeout(this.announceTimer);
    if (this.status.online) await this.bot.stop().catch(() => undefined);
    this.status.online = false;
  }
}
