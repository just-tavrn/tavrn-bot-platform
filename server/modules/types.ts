// SPDX-License-Identifier: Apache-2.0
/**
 * The extension point: a module is `{ id, title, description, defaults, schema, register(ctx) }` in
 * `server/modules/<id>/index.ts`, listed in `server/modules/index.ts`. Its settings are stored per room as JSON and
 * edited in the web UI through the generic form that `schema` describes; `enabled` is added for every module.
 */
import type { BotEvents, BotLogger, ComponentInteraction, Interaction } from "@tavrn/bot";
import type { CommandDefinition } from "@tavrn/sdk";
import type { Config } from "../config";
import type { Db } from "../db";
import type { Field } from "../schema";
import type { BotPort, RoomCache } from "../tavrn";

export interface Room {
  id: number;
  /** `<node>/<room id>` */
  ref: string;
  node: string;
  roomId: string;
  name: string;
  timezone: string;
  installed: boolean;
  disabled: boolean;
}

export type Settings = Record<string, unknown> & { enabled: boolean };
export type Item = Record<string, unknown> & { id: string | number };

/** A list of records a module keeps in its own tables (raid events, games, cases), edited with the generic form. */
export interface Collection {
  title: string;
  /** The form of one item; a function when the choices depend on the room (the raid helper's games). */
  fields: Field[] | ((room: Room) => Field[]);
  /** Keys shown as columns of the list. */
  columns: string[];
  readonly?: boolean;
  list(room: Room): Item[] | Promise<Item[]>;
  /** Creates (`id` absent) or updates an item; `actor` is the platform user's tavrn address in that room. */
  save?(room: Room, item: Record<string, unknown>, id: string | null, actor: string): Promise<Item>;
  remove?(room: Room, id: string): void | Promise<void>;
}

export type CommandHandler<S> = (i: Interaction, room: Room, settings: S) => unknown;
export type ComponentHandler<S> = (i: ComponentInteraction, room: Room, settings: S) => unknown;
type EventPayload<K extends keyof BotEvents> = BotEvents[K][0];

export interface ModuleCtx<S extends Settings = Settings> {
  readonly bot: BotPort;
  readonly db: Db;
  readonly log: BotLogger;
  readonly config: Config;
  readonly cache: RoomCache;
  /** The room's settings of this module, merged with the defaults. */
  settings(room: Room): S;
  /** Connected rooms where this module is on (schedulers). */
  enabledRooms(): Room[];
  room(id: number): Room | null;
  /** Commands, components and modals of this module: they run only in connected rooms where it is on. */
  command(name: string, handler: CommandHandler<S>): void;
  component(customId: string | RegExp, handler: ComponentHandler<S>): void;
  modal(customId: string | RegExp, handler: ComponentHandler<S>): void;
  on<K extends "message" | "memberJoin" | "memberLeave" | "reaction">(event: K, handler: (e: EventPayload<K>, room: Room, settings: S) => unknown): void;
  /** Runs `fn` every `ms` while the platform runs (failures are logged). */
  every(ms: number, fn: () => unknown): void;
  /** Small per-room state of this module (posted message ids, last runs, seen feed items). */
  state: {
    get(room: Room, key: string): string | null;
    set(room: Room, key: string, value: string): void;
    del(room: Room, key: string): void;
  };
  /** Adds a moderation case (moderation, automod) and returns its number. */
  addCase(room: Room, action: string, target: string, moderator: string, reason: string): number;
  /** A URL of the dashboard. */
  url(path: string): string;
}

export interface Module<S extends Settings = Settings> {
  id: string;
  title: string;
  description: string;
  defaults: Omit<S, "enabled"> & { enabled?: boolean };
  schema: Field[];
  /** Commands announced for the application (gated per room by `enabled`). */
  commands?: CommandDefinition[];
  /** Commands that depend on the rooms' settings (custom commands); re-announced when they change. */
  dynamicCommands?(ctx: ModuleCtx<S>): { definition: CommandDefinition; handler: CommandHandler<S> }[];
  /** Lists edited in the web UI next to the settings (created once, after `register`). */
  collections?(ctx: ModuleCtx<S>): Record<string, Collection>;
  register(ctx: ModuleCtx<S>): void;
  /** After the settings of a room were saved (post or update messages); returns warnings for the UI. */
  onSave?(ctx: ModuleCtx<S>, room: Room, settings: S, previous: S): Promise<string[]>;
}

/** Identity helper that keeps the settings type of a module. */
export function defineModule<S extends Settings>(m: Module<S>): Module<S> {
  return m;
}
