// SPDX-License-Identifier: Apache-2.0
/**
 * The rooms of a platform user: connect codes, the room page (modules with their schema and settings), settings,
 * module collections, the leaderboard (also public, opt-in). Every room route checks that the user manages the room
 * on the platform and, when the bot can read the room, still holds Manage room there.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { createToken, newCode } from "../auth";
import { HttpError, body, requireUser, type Deps, type Env } from "../app";
import { leaderboard } from "../modules/levels";
import type { Room } from "../modules/types";
import { ENABLED_FIELD } from "../platform";
import { clean } from "../schema";

const CODE_TTL_MS = 15 * 60_000;

export function roomRoutes({ config, db, platform }: Deps): Hono<Env> {
  const r = new Hono<Env>();

  /** The room of the path, if the user manages it. */
  const managed = async (c: Context<Env>): Promise<{ room: Room; address: string }> => {
    const u = requireUser(c);
    const id = Number(c.req.param("id"));
    const row = Number.isSafeInteger(id) ? db.get<{ address: string }>("SELECT address FROM room_managers WHERE room_id = ? AND user_id = ?", id, u.id) : undefined;
    const room = row ? platform.roomById(id) : null;
    if (!row || !room) throw new HttpError(404, "room_not_found", "Room not found");
    if (!(await platform.stillManages(room, row.address))) {
      db.run("DELETE FROM room_managers WHERE room_id = ? AND user_id = ?", id, u.id);
      throw new HttpError(403, "not_manager", "You no longer manage this room in tavrn");
    }
    return { room, address: row.address };
  };
  const moduleOf = (c: Context) => {
    const m = platform.module(c.req.param("mod") ?? "");
    if (!m) throw new HttpError(404, "module_not_found", "Unknown module");
    return m;
  };
  const collectionOf = (c: Context) => {
    const col = platform.collections(moduleOf(c).id)[c.req.param("col") ?? ""];
    if (!col) throw new HttpError(404, "collection_not_found", "Unknown list");
    return col;
  };

  r.get("/rooms", (c) => {
    const u = requireUser(c);
    const ids = db.all<{ room_id: number }>("SELECT room_id FROM room_managers WHERE user_id = ? ORDER BY room_id", u.id);
    return c.json(ids.map(({ room_id }) => platform.roomById(room_id)).filter(Boolean));
  });

  r.post("/rooms/connect-code", (c) => {
    const u = requireUser(c);
    const code = newCode();
    db.run("DELETE FROM tokens WHERE user_id = ? AND kind = 'connect'", u.id);
    createToken(db, config.sessionSecret, u.id, "connect", CODE_TTL_MS, "", code);
    return c.json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: Date.now() + CODE_TTL_MS, addLink: platform.addLink });
  });

  r.get("/rooms/:id", async (c) => {
    const { room } = await managed(c);
    const detail = await platform.cache.detail(room.ref).catch(() => null);
    return c.json({
      room,
      online: platform.status.online,
      channels: (detail?.channels ?? []).filter((ch) => ["text", "announcement", "forum"].includes(ch.kind)).map((ch) => ({ id: ch.id, name: ch.name, encrypted: ch.encrypted })),
      roles: (detail?.roles ?? []).filter((ro) => !ro.is_everyone).map((ro) => ({ id: ro.id, name: ro.name })),
      modules: platform.modules.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        schema: [ENABLED_FIELD, ...m.schema],
        settings: platform.settings(room, m),
        collections: Object.entries(platform.collections(m.id)).map(([key, col]) => ({ key, title: col.title, fields: col.fields, columns: col.columns, readonly: !!col.readonly })),
      })),
    });
  });

  r.put("/rooms/:id", async (c) => {
    const { room } = await managed(c);
    const { timezone } = await body(c, z.object({ timezone: z.string().max(64).refine(validZone, "unknown time zone") }));
    db.run("UPDATE rooms SET timezone = ? WHERE id = ?", timezone, room.id);
    return c.json(platform.roomById(room.id));
  });

  r.delete("/rooms/:id/manager", async (c) => {
    const u = requireUser(c);
    db.run("DELETE FROM room_managers WHERE room_id = ? AND user_id = ?", Number(c.req.param("id")), u.id);
    return c.json({ ok: true });
  });

  r.put("/rooms/:id/modules/:mod", async (c) => {
    const { room } = await managed(c);
    return c.json(await platform.saveSettings(room, moduleOf(c), await c.req.json()));
  });

  r.get("/rooms/:id/modules/:mod/:col", async (c) => {
    const { room } = await managed(c);
    return c.json(await collectionOf(c).list(room));
  });

  const save = async (c: Context<Env>, id: string | null) => {
    const { room, address } = await managed(c);
    const col = collectionOf(c);
    if (col.readonly || !col.save) throw new HttpError(403, "readonly", "This list cannot be edited");
    const item = clean(col.fields, await c.req.json(), {}, await platform.choices(room));
    return c.json(await col.save(room, item, id, address));
  };
  r.post("/rooms/:id/modules/:mod/:col", (c) => save(c, null));
  r.put("/rooms/:id/modules/:mod/:col/:item", (c) => save(c, c.req.param("item")));
  r.delete("/rooms/:id/modules/:mod/:col/:item", async (c) => {
    const { room } = await managed(c);
    const col = collectionOf(c);
    if (col.readonly || !col.remove) throw new HttpError(403, "readonly", "This list cannot be edited");
    await col.remove(room, c.req.param("item"));
    return c.json({ ok: true });
  });

  r.get("/rooms/:id/leaderboard", async (c) => {
    const { room } = await managed(c);
    return c.json(leaderboard(db, room, Number(c.req.query("page") ?? 0)));
  });

  // Public, without login: only when the room switched the public leaderboard on.
  r.get("/public/leaderboard/:id", (c) => {
    const room = platform.roomById(Number(c.req.param("id")));
    const levels = platform.module("levels");
    const s = room && levels ? platform.settings(room, levels) : null;
    if (!room || room.disabled || !s?.enabled || !s.publicLeaderboard) throw new HttpError(404, "not_public", "This leaderboard is not public");
    return c.json({ room: { name: room.name }, ...leaderboard(db, room, Number(c.req.query("page") ?? 0)) });
  });
  return r;
}

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
