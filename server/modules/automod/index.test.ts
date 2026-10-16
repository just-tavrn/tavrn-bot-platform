// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, FAKE_NODE, FAKE_ROOM, MEMBER, OWNER, ROLE } from "../../fake-bot";
import { setup } from "../../test-utils";
import automod from "./index";

describe("automod", () => {
  it("deletes, times out, records a case and logs without the content", async () => {
    const t = setup([automod]);
    await t.configure("automod", { wordsOn: true, words: ["badword"], wordsAction: "timeout", logChannel: CH.log });
    const m = await t.fake.message("this has a badword in it");
    expect(t.fake.deleted).toEqual([`${m.conversation}#${m.id}`]);
    expect(t.fake.calls[0]?.args.slice(0, 3)).toEqual([`${FAKE_NODE}/${FAKE_ROOM}`, MEMBER.userId, 10]);
    expect(t.db.get("SELECT action, target, moderator FROM cases")).toEqual({ action: "timeout", target: MEMBER.user, moderator: "automod" });
    const log = t.fake.sent.find((x) => x.conversation.endsWith(CH.log))!;
    expect(String(log.content)).toContain("blocked word");
    expect(String(log.content)).not.toContain("badword");
  });

  it("skips the owner, exempt roles and the switched-off module", async () => {
    const t = setup([automod]);
    t.fake.roster[1]!.roles = [ROLE.raider];
    await t.fake.message("badword");
    await t.configure("automod", { wordsOn: true, words: ["badword"], exemptRoles: [ROLE.raider] });
    await t.fake.message("badword", OWNER);
    await t.fake.message("badword", MEMBER);
    expect(t.fake.deleted.map((d) => d.split("#")[1])).toEqual([]);
  });

  it("warns about patterns it ignores", async () => {
    const t = setup([automod]);
    expect((await t.configure("automod", { words: ["/(a+)+/"] })).warnings[0]).toContain("nested quantifiers");
  });
});
