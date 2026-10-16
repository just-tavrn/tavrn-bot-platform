// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Permission } from "@tavrn/sdk";
import { CH, MEMBER, OWNER, type FakeUser } from "../../fake-bot";
import { setup } from "../../test-utils";
import moderation from "./index";

const MOD: FakeUser = { user: "mod@fake.example", userId: "01FAKEUSERMOD0000000000000", permissions: Permission.KICK_MEMBERS | Permission.MODERATE_MEMBERS };

async function room() {
  const t = setup([moderation]);
  t.fake.roster.push({ user: { id: MOD.userId, address: MOD.user, created_at: "2024-01-01T00:00:00Z" }, roles: [] });
  await t.configure("moderation", { logChannel: CH.log });
  return t;
}

describe("moderation", () => {
  it("warns with a case, a DM and a mod-log line", async () => {
    const t = await room();
    const i = await t.fake.invoke("warn", { user: MEMBER.user, reason: "be nice" });
    expect(i.text).toContain("was warned (case #1)");
    expect(t.fake.dms[0]?.to).toBe(MEMBER.user);
    expect(t.fake.sent.some((m) => m.conversation.endsWith(CH.log) && String(m.content).includes("Case #1: warn"))).toBe(true);
    expect((await t.fake.invoke("warnings", { user: MEMBER.user })).text).toContain("#1");
    expect(await t.platform.collections("moderation").cases!.list(t.room)).toMatchObject([{ id: 1, action: "warn", target: MEMBER.user, reason: "be nice" }]);
  });

  it("checks the invoker's permission and the hierarchy", async () => {
    const t = await room();
    expect((await t.fake.invoke("kick", { user: OWNER.user }, MEMBER)).text).toContain("permission");
    expect((await t.fake.invoke("kick", { user: OWNER.user }, MOD)).text).toContain("below your highest role");
    expect((await t.fake.invoke("kick", { user: MOD.user }, MOD)).text).toContain("another member");
    expect(t.fake.calls).toEqual([]);
    await t.fake.invoke("kick", { user: MOD.user }, OWNER);
    expect(t.fake.calls[0]?.name).toBe("kick");
  });

  it("bans only after the invoker confirms", async () => {
    const t = await room();
    const ask = await t.fake.invoke("ban", { user: MEMBER.user, reason: "spam" });
    const yes = JSON.stringify(ask.answers[0]?.content).match(/mod:yes:[\w-]+/)![0];
    expect((await t.fake.click(yes, { who: MOD })).text).toContain("Only the moderator");
    expect(t.fake.calls).toEqual([]);
    expect((await t.fake.click(yes)).text).toContain("was banned (case #1)");
    expect(t.fake.calls.map((c) => c.name)).toEqual(["ban"]);
    expect((await t.fake.click(yes)).text).toContain("expired");
  });

  it("purges through the node's preview and confirmation", async () => {
    const t = await room();
    const ask = await t.fake.invoke("purge", { count: 5 });
    expect(ask.text).toBe("Delete 5 messages?");
    const yes = JSON.stringify(ask.answers[0]?.content).match(/mod:yes:[\w-]+/)![0];
    expect((await t.fake.click(yes)).text).toBe("🧹 Deleted 5 messages.");
    expect(t.fake.calls.map((c) => (c.args[0] as { confirm_token?: string }).confirm_token ?? null)).toEqual([null, "tok"]);
  });
});
