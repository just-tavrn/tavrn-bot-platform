// SPDX-License-Identifier: Apache-2.0
/**
 * What the platform uses of the `@tavrn/bot` runtime (BotPort: the real `Bot` or the fake of the tests), and a small
 * cache of every room's roles, channels and members (the bot needs the members' roles for exemptions, level roles and
 * hierarchy checks; the node offers them only as a paged list, kept current by the member and role events).
 */
import type { Bot, BotLogger } from "@tavrn/bot";
import { Permission, hasPermission, parsePermissions, roomLevelPermissions, type Channel, type Member, type Role, type RoomDetail } from "@tavrn/sdk";

export type BotPort = Pick<
  Bot,
  "on" | "command" | "component" | "modal" | "setCommands" | "send" | "createPoll" | "votes" | "edit" | "deleteMessage" | "messages" | "room" | "members" | "timeout" | "kick" | "ban" | "unban" | "auditLog" | "dm" | "api" | "start" | "stop" | "info"
>;

/**
 * The web client's own slash commands: the platform announces none of these names (an application's command of the
 * same name would only stand next to the built-in one, APPLICATIONS.md §5.4). Moderation and polls use tavrn's own
 * functions instead: the client's `/kick` lands in the room's audit log, which the moderation module reads.
 */
export const CLIENT_COMMANDS = new Set(["ban", "kick", "timeout", "mute", "unmute", "purge", "slowmode", "poll", "nick", "topic", "move", "whiteboard", "help", "me", "shrug"]);

/** `<node>/<id>` of a room, a channel (= its conversation) or anything else the node names by id. */
export const qualify = (node: string, id: string) => `${node}/${id}`;
export function split(ref: string): { node: string; id: string } {
  const i = ref.lastIndexOf("/");
  return { node: ref.slice(0, i), id: ref.slice(i + 1) };
}

/** Does a permission mask (decimal string or bigint) hold `bit`? Administrators hold everything. */
export function can(perms: string | bigint, bit: bigint): boolean {
  const p = parsePermissions(perms);
  return hasPermission(p, Permission.ADMINISTRATOR) || hasPermission(p, bit);
}
export { Permission };

export interface CachedMember {
  id: string;
  address: string;
  roles: string[];
  createdAt: string;
}
interface Entry {
  detail: RoomDetail;
  members: Map<string, CachedMember>;
  at: number;
}

const TTL_MS = 10 * 60 * 1000;
const PAGE = 500;
const MAX_PAGES = 40;

export class RoomCache {
  private readonly entries = new Map<string, Promise<Entry>>();
  constructor(
    private readonly bot: BotPort,
    private readonly log: BotLogger,
  ) {}

  /** Starts listening to the events that change a room (call once). */
  listen(): void {
    this.bot.on("memberJoin", (e) => {
      const ref = qualify(e.node, e.roomId);
      this.with(ref, (x) => x.members.set(e.userId, { id: e.userId, address: (e.user ?? "").toLowerCase(), roles: [], createdAt: e.profile?.created_at ?? "" }));
    });
    // Kept a minute longer: goodbye messages still look up who left.
    this.bot.on("memberLeave", (e) => void setTimeout(() => this.with(qualify(e.node, e.roomId), (x) => x.members.delete(e.userId)), 60_000).unref?.());
    this.bot.on("event", ({ node, event }) => {
      const data = (event as { data?: Record<string, unknown> }).data ?? {};
      const roomId = typeof data.room_id === "string" ? data.room_id : null;
      if (!roomId) return;
      const ref = qualify(node, roomId);
      const type = (event as { type?: string }).type ?? "";
      if (type === "member.update" && data.member) {
        const m = toMember(data.member as Member);
        this.with(ref, (x) => x.members.set(m.id, m));
      } else if (/^(role|channel|category|room)\.|^override\./.test(type)) {
        this.drop(ref);
      }
    });
  }

  /** Applies a change to a loaded room (a room that is not loaded is read fresh when it is needed). */
  private with(ref: string, fn: (e: Entry) => void): void {
    void this.entries.get(ref)?.then(fn, () => undefined);
  }

  drop(ref: string): void {
    this.entries.delete(ref);
  }

  private load(ref: string): Promise<Entry> {
    const cached = this.entries.get(ref);
    if (cached) return cached;
    const p = (async () => {
      const detail = await this.bot.room(ref);
      const members = new Map<string, CachedMember>();
      let after: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const list = await this.bot.members(ref, { limit: PAGE, after });
        for (const m of list) members.set(m.user.id, toMember(m));
        if (list.length < PAGE) break;
        after = list[list.length - 1]!.user.id;
      }
      return { detail, members, at: Date.now() };
    })();
    this.entries.set(ref, p);
    p.catch((e: unknown) => {
      this.log.warn("room could not be loaded", { room: ref, error: e });
      this.entries.delete(ref);
    });
    setTimeout(() => this.entries.get(ref) === p && this.entries.delete(ref), TTL_MS).unref?.();
    return p;
  }

  async detail(ref: string): Promise<RoomDetail> {
    return (await this.load(ref)).detail;
  }
  async channels(ref: string): Promise<Channel[]> {
    return (await this.detail(ref)).channels;
  }
  async roles(ref: string): Promise<Role[]> {
    return (await this.detail(ref)).roles;
  }
  async member(ref: string, userId: string): Promise<CachedMember | null> {
    return (await this.load(ref)).members.get(userId) ?? null;
  }
  async memberByAddress(ref: string, address: string): Promise<CachedMember | null> {
    const a = address.toLowerCase().replace(/^@/, "");
    for (const m of (await this.load(ref)).members.values()) if (m.address === a) return m;
    return null;
  }

  /** Room-level permissions of a member from the cached roles (owner and administrator: everything). */
  async permissions(ref: string, userId: string): Promise<bigint> {
    const e = await this.load(ref);
    const m = e.members.get(userId);
    const everyone = e.detail.roles.find((r) => r.is_everyone);
    const roles = e.detail.roles.filter((r) => m?.roles.includes(r.id)).map((r) => [r.id, parsePermissions(r.permissions)] as [string, bigint]);
    return roomLevelPermissions(e.detail.owner_id === userId, parsePermissions(everyone?.permissions), m ? roles : []);
  }

  /** Is `actor` above `target` in the role hierarchy (the owner is above everybody, nobody is above the owner)? */
  async outranks(ref: string, actorId: string, targetId: string): Promise<boolean> {
    const e = await this.load(ref);
    if (e.detail.owner_id === targetId) return false;
    if (e.detail.owner_id === actorId) return true;
    const top = (id: string) => Math.max(0, ...e.detail.roles.filter((r) => e.members.get(id)?.roles.includes(r.id)).map((r) => r.position));
    return top(actorId) > top(targetId);
  }

  /** Adds and removes roles of a member (the node replaces the whole list). */
  async changeRoles(ref: string, userId: string, add: string[], remove: string[] = []): Promise<string[]> {
    const m = await this.member(ref, userId);
    const current = m?.roles ?? [];
    const next = [...new Set([...current.filter((r) => !remove.includes(r)), ...add])];
    if (next.length === current.length && next.every((r) => current.includes(r))) return current;
    const { node, id } = split(ref);
    const updated = await this.bot.api(node).members.update(id, userId, { roles: next });
    const roles = updated.roles ?? next;
    if (m) m.roles = roles;
    return roles;
  }
}

function toMember(m: Member): CachedMember {
  return { id: m.user.id, address: m.user.address.toLowerCase(), roles: m.roles.filter(Boolean), createdAt: m.user.created_at };
}
