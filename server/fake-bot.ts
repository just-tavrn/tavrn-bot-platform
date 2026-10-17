// SPDX-License-Identifier: Apache-2.0
/**
 * An in-memory stand-in for the `@tavrn/bot` runtime: the unit and API tests and the e2e run (FAKE_BOT=1) drive the
 * platform with it. It keeps what the platform sent and lets a test invoke commands, click components, submit modals
 * and emit events as a node would.
 */
import type { BotEvents } from "@tavrn/bot";
import { Permission } from "@tavrn/sdk";
import type { BotPort } from "./tavrn";

type Fn = (...args: any[]) => unknown;
type Matcher = string | RegExp;

export interface FakeUser {
  user: string;
  userId: string;
  permissions?: bigint;
}

export const FAKE_NODE = "fake.example";
export const FAKE_ROOM = "01FAKEROOM00000000000000AA";
export const FAKE_REF = `${FAKE_NODE}/${FAKE_ROOM}`;
export const CH = { general: "01FAKECHGENERAL00000000000", log: "01FAKECHLOG000000000000000", raids: "01FAKECHRAIDS0000000000000" };
export const ROLE = { everyone: "01FAKEROLEEVERYONE00000000", mod: "01FAKEROLEMOD0000000000000", raider: "01FAKEROLERAIDER0000000000" };
export const OWNER: FakeUser = { user: "owner@fake.example", userId: "01FAKEUSEROWNER00000000000", permissions: Permission.ADMINISTRATOR };
export const MEMBER: FakeUser = { user: "member@fake.example", userId: "01FAKEUSERMEMBER0000000000", permissions: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES };

const MOD_PERMS = Permission.MANAGE_MESSAGES | Permission.KICK_MEMBERS | Permission.BAN_MEMBERS | Permission.MODERATE_MEMBERS | Permission.PURGE;

function roomDetail() {
  const channel = (id: string, name: string) => ({ id, name, kind: "text", encrypted: false, bitrate_kbps: 0 });
  return {
    id: FAKE_ROOM,
    name: "Fake room",
    owner_id: OWNER.userId,
    member_count: 2,
    channels: [channel(CH.general, "general"), channel(CH.log, "mod-log"), channel(CH.raids, "raids")],
    roles: [
      { id: ROLE.everyone, name: "@everyone", is_everyone: true, permissions: String(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES), position: 0 },
      { id: ROLE.raider, name: "Raider", is_everyone: false, permissions: "0", position: 1 },
      { id: ROLE.mod, name: "Moderator", is_everyone: false, permissions: String(MOD_PERMS), position: 2 },
    ],
  };
}

/** One answered interaction: what the handler answered, in order. */
export class FakeInteraction {
  readonly answers: { type: string; content?: unknown; opts?: unknown }[] = [];
  readonly id = `ix${Math.random().toString(36).slice(2)}`;
  readonly node = FAKE_NODE;
  readonly conversation: string;
  readonly conversationId: string;
  readonly permissions: string;
  readonly locale = "en";
  readonly encrypted = false;
  readonly threadId = null;
  modalCustomId: string | null = null;
  constructor(
    readonly user: string,
    readonly userId: string,
    perms: bigint,
    readonly roomId: string | null,
    readonly channelId: string | null,
    readonly args: Record<string, unknown> = {},
    readonly command = { id: "c", name: "" },
    readonly customId: string | null = null,
    readonly messageId: string | null = null,
    readonly values: string[] | null = null,
    readonly fields: Record<string, string> = {},
  ) {
    this.permissions = String(perms);
    this.conversationId = channelId ?? "dm";
    this.conversation = `${FAKE_NODE}/${this.conversationId}`;
  }
  get answered() {
    return this.answers.length > 0;
  }
  private push(type: string, content?: unknown, opts?: unknown) {
    this.answers.push({ type, content, opts });
    return Promise.resolve(undefined);
  }
  reply = (content: unknown, opts?: { ephemeral?: boolean }) => this.push(opts?.ephemeral ? "ephemeral" : "reply", content, opts);
  ephemeral = (content: unknown) => this.push("ephemeral", content);
  update = (content: unknown) => this.push("update", content);
  modal = (m: unknown) => this.push("modal", m);
  defer = () => this.push("defer");
  followUp = (content: unknown, opts?: unknown) => this.push("followUp", content, opts);
  error = (message: string) => this.push("error", message);
  /** The text of the last answer (string content or `body`). */
  get text(): string {
    const c = this.answers.at(-1)?.content;
    return typeof c === "string" ? c : String((c as { body?: unknown } | undefined)?.body ?? "");
  }
}

export class FakeBot {
  readonly listeners = new Map<string, Fn[]>();
  readonly commands = new Map<string, Fn>();
  readonly components: [Matcher, Fn][] = [];
  readonly modals: [Matcher, Fn][] = [];
  readonly sent: { id: string; conversation: string; content: unknown; opts?: unknown }[] = [];
  readonly edits: { conversation: string; id: string; content: unknown }[] = [];
  readonly deleted: string[] = [];
  readonly calls: { name: string; args: unknown[] }[] = [];
  readonly dms: { to: string; content: unknown }[] = [];
  announced: { name: string }[] = [];
  detail = roomDetail();
  roster = [
    { user: { id: OWNER.userId, address: OWNER.user, created_at: "2024-01-01T00:00:00Z" }, roles: [] as string[] },
    { user: { id: MEMBER.userId, address: MEMBER.user, created_at: "2024-01-01T00:00:00Z" }, roles: [] as string[] },
  ];
  private n = 0;
  readonly info = { address: "platform@fake.example", username: "platform", userId: "01FAKEBOT", applicationId: "01FAKEAPP", applicationRef: "fake.example/01FAKEAPP", deviceId: "d", homeDomain: FAKE_NODE };

  asBot(): BotPort {
    return this as unknown as BotPort;
  }
  on(event: string, fn: Fn) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return () => undefined;
  }
  async emit<K extends keyof BotEvents>(event: K, payload: BotEvents[K][0]) {
    for (const fn of this.listeners.get(event) ?? []) await fn(payload);
  }
  command(name: string, fn: Fn) {
    this.commands.set(name, fn);
    return this;
  }
  component(m: Matcher, fn: Fn) {
    this.components.push([m, fn]);
    return this;
  }
  modal(m: Matcher, fn: Fn) {
    this.modals.push([m, fn]);
    return this;
  }
  async setCommands(defs: { name: string }[]) {
    this.announced = defs;
    return { commands: defs, commands_version: 1 };
  }
  async start() {}
  async stop() {}

  async send(conversation: string | { conversation: string }, content: unknown, opts?: unknown) {
    const id = `m${++this.n}`;
    const conv = typeof conversation === "string" ? conversation : conversation.conversation;
    this.sent.push({ id, conversation: conv, content, opts });
    return { id, conversation_id: conv.split("/").pop() };
  }
  readonly polls: { id: string; conversation: string; poll: unknown; opts: unknown }[] = [];
  /** The tally `votes()` reports (tests set it). */
  tally = { voters: 0, options: [] as { id: string; label: string; count: number }[], best: [] as string[] };
  async createPoll(conversation: string, poll: unknown, opts?: unknown) {
    const id = `p${++this.n}`;
    this.polls.push({ id, conversation, poll, opts });
    return { id };
  }
  async votes() {
    return { tally: this.tally, poll: { question: "Pizza?" }, closesAt: null };
  }
  /** The room's audit log, newest first (tests set it). */
  audit: { id: string; action: string; actor_id: string | null; target: string; reason: string; meta: Record<string, unknown>; created_at: string }[] = [];
  async auditLog(_room: string, q: { limit?: number } = {}) {
    return this.audit.slice(0, q.limit ?? 50);
  }
  async edit(conversation: string, id: string, content: unknown) {
    this.edits.push({ conversation, id, content });
    return { id };
  }
  async deleteMessage(conversation: string, id: string) {
    this.deleted.push(`${conversation}#${id}`);
  }
  async messages(_conversation: string, q: { limit?: number } = {}) {
    return Array.from({ length: q.limit ?? 50 }, (_, i) => ({ id: `h${i}`, authorId: MEMBER.userId, author: MEMBER.user, text: `old ${i}`, createdAt: new Date(Date.now() - (i + 1) * 60_000).toISOString() }));
  }
  async room() {
    return this.detail;
  }
  async members(_ref: string, q: { after?: string } = {}) {
    return q.after ? [] : this.roster;
  }
  private record(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  async timeout(...args: unknown[]) {
    this.record("timeout", ...args);
  }
  async kick(...args: unknown[]) {
    this.record("kick", ...args);
  }
  async ban(...args: unknown[]) {
    this.record("ban", ...args);
  }
  async unban(...args: unknown[]) {
    this.record("unban", ...args);
  }
  async dm(to: string, content: unknown) {
    this.dms.push({ to, content });
  }
  nodeCapabilities = ["components.v1", "components.modal_select.v1"];
  api() {
    return {
      node: { info: async () => ({ capabilities: this.nodeCapabilities }) },
      members: {
        update: async (_room: string, userId: string, req: { roles: string[] }) => {
          this.record("roles", userId, req.roles);
          const m = this.roster.find((x) => x.user.id === userId);
          if (m) m.roles = req.roles;
          return { roles: req.roles };
        },
      },
      channels: { update: async (...args: unknown[]) => this.record("channel", ...args) },
      rooms: {
        purge: async (_room: string, req: { confirm_token?: string }) => {
          this.record("purge", req);
          return req.confirm_token ? { dry_run: false, messages: 5 } : { dry_run: true, messages: 5, confirm_token: "tok" };
        },
      },
    };
  }

  // ---- Driving the platform as a node would ----

  async invoke(name: string, args: Record<string, unknown> = {}, who: FakeUser = OWNER, channelId: string | null = CH.general, roomId: string | null = FAKE_ROOM) {
    const i = new FakeInteraction(who.user, who.userId, who.permissions ?? 0n, roomId, channelId, args, { id: "c", name });
    const fn = this.commands.get(name);
    if (!fn) throw new Error(`no command ${name}`);
    await fn(i);
    return i;
  }
  async click(customId: string, opts: { who?: FakeUser; values?: string[]; messageId?: string; channelId?: string } = {}) {
    const who = opts.who ?? OWNER;
    const i = new FakeInteraction(who.user, who.userId, who.permissions ?? 0n, FAKE_ROOM, opts.channelId ?? CH.general, {}, { id: "", name: "" }, customId, opts.messageId ?? "m1", opts.values ?? null);
    await this.find(this.components, customId)(i);
    return i;
  }
  async submit(modalId: string, fields: Record<string, string>, who: FakeUser = OWNER, messageId: string | null = null, channelId: string = CH.general) {
    const i = new FakeInteraction(who.user, who.userId, who.permissions ?? 0n, FAKE_ROOM, channelId, {}, { id: "", name: "" }, null, messageId, null, fields);
    i.modalCustomId = modalId;
    await this.find(this.modals, modalId)(i);
    return i;
  }
  private find(list: [Matcher, Fn][], id: string): Fn {
    const hit = list.find(([m]) => (typeof m === "string" ? m === id : m.test(id)));
    if (!hit) throw new Error(`no handler for ${id}`);
    return hit[1];
  }
  /** A message event in the fake room. */
  async message(text: string, who: FakeUser = MEMBER, channelId = CH.general, extra: Record<string, unknown> = {}) {
    const id = `in${++this.n}`;
    const m = { id, node: FAKE_NODE, conversationId: channelId, conversation: `${FAKE_NODE}/${channelId}`, roomId: FAKE_ROOM, author: who.user, authorId: who.userId, authorKind: "user", encrypted: false, text, content: { type: "text", body: text }, mentions: [], mentionsMe: false, createdAt: new Date().toISOString(), ...extra, reply: async (c: unknown) => this.send(`${FAKE_NODE}/${channelId}`, c), react: async () => ({}) };
    await this.emit("message", m as never);
    return m;
  }
}
