// SPDX-License-Identifier: Apache-2.0
import { silentLogger } from "@tavrn/bot";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { loadConfig } from "../config";
import { Db } from "../db";
import { FakeBot, OWNER, CH } from "../fake-bot";
import { memoryMailer } from "../mail";
import { MODULES } from "../modules";
import { Platform } from "../platform";

const BASE = "http://dash.test";

function server(env: Record<string, string> = {}) {
  const config = loadConfig({ BASE_URL: BASE, SESSION_SECRET: "x".repeat(40), FAKE_BOT: "1", ADMIN_EMAILS: "admin@example.org", ...env });
  const db = new Db(":memory:");
  const fake = new FakeBot();
  const mailer = memoryMailer();
  const platform = new Platform(config, db, fake.asBot(), silentLogger, MODULES);
  platform.status.online = true;
  const app = createApp({ config, db, platform, mailer, fake });
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { method, headers: { origin: BASE, "content-type": "application/json", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!.startsWith("sid=;") ? "" : set.split(";")[0]!;
    return { status: res.status, json: (await res.json().catch(() => null)) as any, setCookie: set };
  };
  const token = () => mailer.sent.at(-1)!.text.match(/token=([\w-]+)/)![1]!;
  const account = async (email = "maria@example.org", password = "correct horse battery") => {
    await call("POST", "/api/auth/register", { email, password });
    await call("POST", "/api/auth/confirm", { token: token() });
  };
  return { app, call, mailer, token, account, fake, db, logout: () => (cookie = "") };
}

describe("accounts", () => {
  it("registers, confirms by mail, logs in and out", async () => {
    const s = server();
    expect((await s.call("POST", "/api/auth/register", { email: "Maria@Example.org", password: "correct horse battery" })).json).toEqual({ ok: true, mailConfigured: false });
    expect((await s.call("POST", "/api/auth/login", { email: "maria@example.org", password: "correct horse battery" })).status).toBe(403);
    const confirmed = await s.call("POST", "/api/auth/confirm", { token: s.token() });
    expect(confirmed.setCookie).toMatch(/sid=.*HttpOnly.*SameSite=Lax/i);
    expect((await s.call("GET", "/api/me")).json).toEqual({ email: "maria@example.org", admin: false });
    await s.call("POST", "/api/auth/logout");
    expect((await s.call("GET", "/api/me")).status).toBe(401);
    expect((await s.call("POST", "/api/auth/login", { email: "maria@example.org", password: "wrong password!" })).status).toBe(401);
    expect((await s.call("POST", "/api/auth/login", { email: "maria@example.org", password: "correct horse battery" })).status).toBe(200);
  });

  it("does not reveal registered addresses and refuses foreign origins", async () => {
    const s = server();
    await s.account();
    const again = await s.call("POST", "/api/auth/register", { email: "maria@example.org", password: "another password" });
    expect(again.json).toEqual({ ok: true, mailConfigured: false });
    expect(s.mailer.sent.at(-1)!.subject).toBe("Your tavrn bot account");
    expect((await s.call("POST", "/api/auth/reset-request", { email: "nobody@example.org" })).json).toEqual({ ok: true });
    expect((await s.call("POST", "/api/auth/login", { email: "nobody@example.org", password: "whatever12" })).status).toBe(401);
    expect((await s.call("POST", "/api/auth/logout", {}, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("resets the password and revokes the sessions; changes the password and the address", async () => {
    const s = server();
    await s.account();
    await s.call("POST", "/api/auth/reset-request", { email: "maria@example.org" });
    const reset = s.token();
    expect((await s.call("POST", "/api/auth/reset", { token: reset, password: "a new password" })).status).toBe(200);
    expect((await s.call("GET", "/api/me")).status).toBe(401);
    expect((await s.call("POST", "/api/auth/reset", { token: reset, password: "a new password" })).status).toBe(400);
    await s.call("POST", "/api/auth/login", { email: "maria@example.org", password: "a new password" });
    expect((await s.call("POST", "/api/me/password", { current: "wrong", password: "third password" })).status).toBe(403);
    expect((await s.call("POST", "/api/me/password", { current: "a new password", password: "third password" })).status).toBe(200);
    await s.call("POST", "/api/me/email", { email: "new@example.org", password: "third password" });
    expect(s.mailer.sent.at(-1)!.to).toBe("new@example.org");
    await s.call("POST", "/api/auth/confirm", { token: s.token() });
    expect((await s.call("GET", "/api/me")).json.email).toBe("new@example.org");
    expect((await s.call("POST", "/api/me/delete", { password: "third password" })).status).toBe(200);
    expect((await s.call("POST", "/api/auth/login", { email: "new@example.org", password: "third password" })).status).toBe(401);
  });

  it("limits login attempts", async () => {
    const s = server();
    const codes = [];
    for (let n = 0; n < 12; n++) codes.push((await s.call("POST", "/api/auth/login", { email: "x@example.org", password: "wrong one" })).status);
    expect(codes.at(-1)).toBe(429);
  });
});

describe("rooms", () => {
  it("connects a room with a code, round-trips settings and lists", async () => {
    const s = server();
    await s.account();
    const { json: code } = await s.call("POST", "/api/rooms/connect-code");
    expect(code.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await s.call("POST", "/api/test/connect", { code: code.code })).json.answer).toContain("Connected");
    expect((await s.call("POST", "/api/test/connect", { code: code.code })).json.answer).toContain("unknown or expired");
    const rooms = (await s.call("GET", "/api/rooms")).json;
    expect(rooms).toMatchObject([{ name: "Fake room", installed: true }]);
    const id = rooms[0].id;
    const room = (await s.call("GET", `/api/rooms/${id}`)).json;
    expect(room.channels.map((c: { name: string }) => c.name)).toContain("general");
    expect(room.modules.map((m: { id: string }) => m.id)).toContain("raid-helper");

    const welcome = room.modules.find((m: { id: string }) => m.id === "welcome");
    const saved = await s.call("PUT", `/api/rooms/${id}/modules/welcome`, { ...welcome.settings, enabled: true, channel: CH.general });
    expect(saved.json.settings).toMatchObject({ enabled: true, channel: CH.general });
    expect((await s.call("PUT", `/api/rooms/${id}/modules/welcome`, { ...welcome.settings, channel: "01NOTACHANNEL0000000000000" })).json).toMatchObject({ error: "invalid", path: "channel" });
    expect((await s.call("GET", `/api/rooms/${id}`)).json.modules.find((m: { id: string }) => m.id === "welcome").settings.enabled).toBe(true);

    await s.call("PUT", `/api/rooms/${id}/modules/raid-helper`, { enabled: true, channel: CH.raids, leaderRoles: [], defaultGame: "wow" });
    const ev = { title: "Raid", game: "wow", start: "2030-01-01T20:00", channel: "", leader: "", description: "", tanks: 2, healers: 4, dps: 14, max: 20, deadlineHours: 0, remind24: true, remind1: true, remindDm: false, status: "open" };
    const created = await s.call("POST", `/api/rooms/${id}/modules/raid-helper/events`, ev);
    expect(created.json).toMatchObject({ title: "Raid", leader: OWNER.user });
    expect((await s.call("GET", `/api/rooms/${id}/modules/raid-helper/events`)).json).toMatchObject([{ title: "Raid", start: "2030-01-01T20:00" }]);
    expect((await s.call("DELETE", `/api/rooms/${id}/modules/raid-helper/events/${created.json.id}`)).status).toBe(200);
    expect((await s.call("GET", `/api/rooms/${id}/modules/moderation/cases`)).json).toEqual([]);
    expect((await s.call("POST", `/api/rooms/${id}/modules/moderation/cases`, {})).status).toBe(403);
  });

  it("keeps rooms to their managers and the public leaderboard opt-in", async () => {
    const s = server();
    await s.account();
    const { json: code } = await s.call("POST", "/api/rooms/connect-code");
    await s.call("POST", "/api/test/connect", { code: code.code });
    const id = (await s.call("GET", "/api/rooms")).json[0].id;
    expect((await s.call("GET", `/api/public/leaderboard/${id}`)).status).toBe(404);
    await s.call("PUT", `/api/rooms/${id}/modules/levels`, { enabled: true, publicLeaderboard: true });
    expect((await s.call("GET", `/api/public/leaderboard/${id}`)).json).toMatchObject({ room: { name: "Fake room" }, entries: [] });
    s.logout();
    await s.account("eve@example.org");
    expect((await s.call("GET", `/api/rooms/${id}`)).status).toBe(404);
    expect((await s.call("PUT", `/api/rooms/${id}/modules/levels`, { enabled: false })).status).toBe(404);
    expect((await s.call("GET", "/api/admin")).status).toBe(403);
    s.logout();
    await s.account("admin@example.org");
    const admin = (await s.call("GET", "/api/admin")).json;
    expect(admin.rooms).toHaveLength(1);
    await s.call("PUT", `/api/admin/rooms/${id}`, { disabled: true });
    expect((await s.call("GET", `/api/public/leaderboard/${id}`)).status).toBe(404);
  });

  it("drops a manager who lost Manage room in tavrn, also for member actions", async () => {
    const s = server();
    await s.account();
    const { json: code } = await s.call("POST", "/api/rooms/connect-code");
    await s.call("POST", "/api/test/connect", { code: code.code });
    const id = (await s.call("GET", "/api/rooms")).json[0].id;
    await s.call("PUT", `/api/rooms/${id}/modules/moderation`, { enabled: true, logChannel: "", dmOnAction: false });
    expect((await s.call("GET", `/api/rooms/${id}/modules/moderation/kick`)).status).toBe(404);
    expect((await s.call("POST", `/api/rooms/${id}/modules/moderation/kick`, { member: "member@fake.example", reason: "spam" })).json).toMatchObject({ message: "Done: kick member@fake.example (case #1)." });
    expect((await s.call("PUT", `/api/rooms/${id}/modules/moderation/kick/1`, { member: "member@fake.example", reason: "" })).status).toBe(403);
    s.db.run("UPDATE room_managers SET address = 'member@fake.example'");
    expect((await s.call("POST", `/api/rooms/${id}/modules/moderation/ban`, { member: "owner@fake.example", reason: "" })).status).toBe(403);
    expect(s.fake.calls.map((c) => c.name)).toEqual(["kick"]);
    expect((await s.call("GET", `/api/rooms/${id}`)).status).toBe(404);
    expect((await s.call("GET", "/api/rooms")).json).toEqual([]);
  });
});
