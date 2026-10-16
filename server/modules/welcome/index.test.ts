// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, FAKE_NODE, FAKE_ROOM, MEMBER, ROLE } from "../../fake-bot";
import { setup } from "../../test-utils";
import welcome from "./index";

const join = { node: FAKE_NODE, roomId: FAKE_ROOM, userId: MEMBER.userId, user: MEMBER.user, profile: null };

describe("welcome", () => {
  it("greets, sends the DM and gives the roles on join", async () => {
    const t = setup([welcome]);
    await t.configure("welcome", { channel: CH.general, dmEnabled: true, autoRoles: [ROLE.raider] });
    await t.fake.emit("memberJoin", join);
    expect(t.fake.sent[0]).toMatchObject({ conversation: `${FAKE_NODE}/${CH.general}`, content: `Welcome @${MEMBER.user} to Fake room! You are member number 2.` });
    expect(t.fake.dms[0]?.to).toBe(MEMBER.user);
    expect(t.fake.calls).toContainEqual({ name: "roles", args: [MEMBER.userId, [ROLE.raider]] });
  });

  it("does nothing while switched off, says goodbye when asked", async () => {
    const t = setup([welcome]);
    await t.fake.emit("memberJoin", join);
    expect(t.fake.sent).toHaveLength(0);
    await t.configure("welcome", { channel: CH.general, goodbyeEnabled: true });
    await t.fake.emit("memberLeave", { ...join, user: null });
    expect(t.fake.sent[0]?.content).toBe(`@${MEMBER.user} has left.`);
  });
});
