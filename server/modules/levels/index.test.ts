// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, MEMBER, OWNER, ROLE } from "../../fake-bot";
import { setup } from "../../test-utils";
import levels, { leaderboard, levelOf, rolesFor } from "./index";

describe("level maths", () => {
  it("follows the curve 5n² + 50n + 100", () => {
    expect(levelOf(0)).toEqual({ level: 0, into: 0, need: 100 });
    expect(levelOf(99).level).toBe(0);
    expect(levelOf(100)).toEqual({ level: 1, into: 0, need: 155 });
    expect(levelOf(255).level).toBe(2);
  });
  it("stacks or replaces level roles", () => {
    const lr = [{ id: "a", level: 5, role: "R5" }, { id: "b", level: 1, role: "R1" }, { id: "c", level: 10, role: "R10" }];
    expect(rolesFor(lr, 6, true)).toEqual({ add: ["R1", "R5"], remove: ["R10"] });
    expect(rolesFor(lr, 6, false)).toEqual({ add: ["R5"], remove: ["R1", "R10"] });
  });
});

describe("levels", () => {
  it("counts once per cooldown, announces the level and gives the role", async () => {
    const t = setup([levels]);
    await t.configure("levels", { minXp: 100, maxXp: 100, levelRoles: [{ level: 1, role: ROLE.raider }] });
    await t.fake.message("hello");
    await t.fake.message("again");
    expect(t.db.get("SELECT xp, messages FROM xp")).toEqual({ xp: 100, messages: 1 });
    expect(t.fake.sent[0]?.content).toBe(`🎉 @${MEMBER.user} reached level 1!`);
    expect(t.fake.calls).toContainEqual({ name: "roles", args: [MEMBER.userId, [ROLE.raider]] });
    expect((await t.fake.invoke("rank", {}, MEMBER)).text).toContain("level 1 · rank #1");
  });

  it("pages the leaderboard with buttons", async () => {
    const t = setup([levels]);
    await t.configure("levels", { cooldownSeconds: 0, announce: "off" });
    for (let n = 0; n < 12; n++) t.db.run("INSERT INTO xp (room_id, user_id, address, xp) VALUES (?, ?, ?, ?)", t.room.id, `u${n}`, `u${n}@x`, n * 10);
    expect(leaderboard(t.db, t.room, 1)).toMatchObject({ page: 1, pages: 2, entries: [{ rank: 11, address: "u1@x" }, { rank: 12 }] });
    const first = await t.fake.invoke("leaderboard", {}, OWNER, CH.general);
    expect(first.text).toContain("1. u11@x");
    expect((await t.fake.click("levels:lb:1")).text).toContain("page 2/2");
  });
});
