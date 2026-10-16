// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Permission } from "@tavrn/sdk";
import { CH, MEMBER, OWNER, type FakeUser } from "../../fake-bot";
import { CLIENT_COMMANDS } from "../../tavrn";
import { MODULES } from "..";
import { setup } from "../../test-utils";
import moderation, { auditCase } from "./index";

const MOD: FakeUser = { user: "mod@fake.example", userId: "01FAKEUSERMOD0000000000000", permissions: Permission.KICK_MEMBERS | Permission.MODERATE_MEMBERS };
const entry = (id: string, action: string, extra: Record<string, unknown> = {}) => ({ id, action, actor_id: MOD.userId, target: MEMBER.user, reason: "", meta: {}, created_at: "2026-10-16T12:00:00Z", ...extra });

const HELPER = "01FAKEROLEHELPER0000000000";

async function room() {
  const t = setup([moderation]);
  // A moderator who may kick and time out, not ban.
  t.fake.detail.roles.push({ id: HELPER, name: "Helper", is_everyone: false, permissions: String(Permission.KICK_MEMBERS | Permission.MODERATE_MEMBERS), position: 2 });
  t.fake.roster.push({ user: { id: MOD.userId, address: MOD.user, created_at: "2024-01-01T00:00:00Z" }, roles: [HELPER] });
  await t.configure("moderation", { logChannel: CH.log });
  const cases = t.platform.collections("moderation");
  const sync = () => (t.platform as unknown as { jobs: [number, () => Promise<void>][] }).jobs[0]![1]();
  return { ...t, cases, sync };
}

describe("moderation commands", () => {
  it("announces no command of the client's own", () => {
    const t = setup(MODULES);
    expect(t.platform.commandSet().filter((c) => CLIENT_COMMANDS.has(c.name))).toEqual([]);
    expect(moderation.commands!.map((c) => c.name)).toEqual(["warn", "warnings", "case"]);
  });

  it("warns with a case, a DM and a mod-log line; /warnings and /case show it", async () => {
    const t = await room();
    const i = await t.fake.invoke("warn", { user: MEMBER.user, reason: "be nice" });
    expect(i.text).toContain("was warned (case #1)");
    expect(t.fake.dms[0]?.to).toBe(MEMBER.user);
    expect(t.fake.sent.some((m) => m.conversation.endsWith(CH.log) && String(m.content).includes("Case #1: warn"))).toBe(true);
    expect((await t.fake.invoke("warnings", { user: MEMBER.user })).text).toContain("#1");
    expect((await t.fake.invoke("case", { id: 1 })).text).toMatch(/^Case #1 .*\nwarn @member@fake\.example by owner@fake\.example\nReason: be nice$/);
    expect((await t.fake.invoke("case", { id: 2 })).text).toContain("no such case");
    expect(await t.cases.cases!.list!(t.room)).toMatchObject([{ id: 1, action: "warn", target: MEMBER.user, reason: "be nice" }]);
  });

  it("checks the invoker's permission and the hierarchy", async () => {
    const t = await room();
    expect((await t.fake.invoke("warn", { user: OWNER.user, reason: "x" }, MEMBER)).text).toContain("permission");
    expect((await t.fake.invoke("warn", { user: OWNER.user, reason: "x" }, MOD)).text).toContain("below your highest role");
    expect((await t.fake.invoke("warn", { user: MOD.user, reason: "x" }, MOD)).text).toContain("another member");
    expect((await t.fake.invoke("case", { id: 1 }, MEMBER)).text).toContain("permission");
  });
});

describe("cases from the audit log", () => {
  it("maps kick, ban, unban, timeout and purge entries and ignores the rest", () => {
    expect(auditCase(entry("1", "member.kick", { reason: "spam" }))).toMatchObject({ action: "kick", target: MEMBER.user, actorId: MOD.userId, reason: "spam", tell: "You were removed" });
    expect(auditCase(entry("2", "member.ban", { target: "spam.example" }))).toMatchObject({ action: "ban", target: "spam.example", tell: null });
    expect(auditCase(entry("3", "member.unban"))).toMatchObject({ action: "unban", tell: null });
    expect(auditCase(entry("4", "member.timeout", { meta: { minutes: 30 } }))).toMatchObject({ action: "timeout 30 min", tell: "You were timed out for 30 minutes" });
    expect(auditCase(entry("5", "member.timeout_clear"))).toMatchObject({ action: "timeout lifted" });
    expect(auditCase(entry("6", "moderation.purge", { target: "", meta: { deleted: 12, channels: [CH.general], author_id: MEMBER.userId } }))).toMatchObject({ action: "purge 12", authorId: MEMBER.userId, channels: [CH.general] });
    expect(auditCase(entry("7", "role.create"))).toBeNull();
  });

  it("records new entries once, skips the bot's own and starts at the newest entry", async () => {
    const t = await room();
    t.fake.audit = [entry("01A", "member.kick")];
    await t.sync();
    expect(await t.cases.cases!.list!(t.room)).toEqual([]);

    t.fake.audit = [
      entry("01E", "moderation.purge", { target: "", meta: { deleted: 3, channels: [CH.general], author_id: MEMBER.userId } }),
      entry("01D", "member.ban", { actor_id: "01FAKEBOT" }),
      entry("01C", "role.update"),
      entry("01B", "member.timeout", { reason: "calm down", meta: { minutes: 10 } }),
      entry("01A", "member.kick"),
    ];
    await t.sync();
    await t.sync();
    expect(await t.cases.cases!.list!(t.room)).toMatchObject([
      { id: 2, action: "purge 3", target: `${MEMBER.user} in #general`, moderator: MOD.user },
      { id: 1, action: "timeout 10 min", target: MEMBER.user, moderator: MOD.user, reason: "calm down" },
    ]);
    expect(t.fake.dms).toMatchObject([{ to: MEMBER.user, content: "You were timed out for 10 minutes in Fake room: calm down" }]);
    expect(t.fake.sent.filter((m) => m.conversation.endsWith(CH.log)).map((m) => m.content)).toEqual([`🔨 Case #1: timeout 10 min @${MEMBER.user} by @${MOD.user} (calm down)`, `🔨 Case #2: purge 3 ${MEMBER.user} in #general by @${MOD.user}`]);
  });
});

describe("member actions in the dashboard", () => {
  it("acts through the bot with the platform user's permission and rank checked in tavrn", async () => {
    const t = await room();
    const { kick, ban, timeout, unban } = t.cases;
    await expect(kick!.save!(t.room, { member: OWNER.user, reason: "" }, null, MOD.user)).rejects.toThrow("below your highest role");
    await expect(ban!.save!(t.room, { member: MEMBER.user, reason: "" }, null, MOD.user)).rejects.toThrow("may not ban");
    await expect(kick!.save!(t.room, { member: MEMBER.user, reason: "" }, null, MEMBER.user)).rejects.toThrow("may not kick");
    await expect(kick!.save!(t.room, { member: "nobody@fake.example", reason: "" }, null, MOD.user)).rejects.toThrow("not a member");
    expect(t.fake.calls).toEqual([]);

    expect((await kick!.save!(t.room, { member: MEMBER.user, reason: "spam" }, null, MOD.user)).message).toBe(`Done: kick ${MEMBER.user} (case #1).`);
    expect((await timeout!.save!(t.room, { member: MEMBER.user, minutes: 15, reason: "" }, null, MOD.user)).message).toContain("timeout 15 min");
    await ban!.save!(t.room, { member: MEMBER.user, reason: "" }, null, OWNER.user);
    await unban!.save!(t.room, { member: MEMBER.user }, null, OWNER.user);
    expect(t.fake.calls.map((c) => c.name)).toEqual(["kick", "timeout", "ban", "unban"]);
    expect(t.fake.dms.map((d) => d.content)).toEqual(["You were removed in Fake room: spam", "You were timed out for 15 minutes in Fake room.", "You were banned in Fake room."]);
    expect((await t.cases.cases!.list!(t.room)).map((c) => c.moderator)).toEqual([OWNER.user, OWNER.user, MOD.user, MOD.user]);
  });
});
