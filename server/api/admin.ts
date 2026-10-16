// SPDX-License-Identifier: Apache-2.0
/** The operator page (ADMIN_EMAILS): users, rooms, disabling a room, the bot's status. */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { HttpError, body, requireUser, type Deps, type Env } from "../app";

export function adminRoutes({ config, db, platform }: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const admin = (c: Context<Env>) => {
    const u = requireUser(c);
    if (!config.adminEmails.includes(u.email)) throw new HttpError(403, "not_admin", "Operators only");
  };
  r.get("/admin", (c) => {
    admin(c);
    return c.json({
      bot: platform.status,
      uptime: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      users: db.all("SELECT id, email, verified, created_at, (SELECT COUNT(*) FROM room_managers m WHERE m.user_id = u.id) AS rooms FROM users u ORDER BY id DESC LIMIT 500"),
      rooms: db.all("SELECT id, ref, name, installed, disabled, created_at, (SELECT COUNT(*) FROM room_managers m WHERE m.room_id = r.id) AS managers FROM rooms r ORDER BY id DESC LIMIT 500"),
    });
  });
  r.put("/admin/rooms/:id", async (c) => {
    admin(c);
    const { disabled } = await body(c, z.object({ disabled: z.boolean() }));
    db.run("UPDATE rooms SET disabled = ? WHERE id = ?", disabled ? 1 : 0, Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  return r;
}
