// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, MEMBER, ROLE } from "../../fake-bot";
import { setup } from "../../test-utils";
import roles from "./index";

const menu = (extra = {}) => ({ title: "Pick", text: "", channel: CH.general, style: "buttons", mode: "multiple", options: [{ label: "Raider", emoji: "⚔️", role: ROLE.raider }, { label: "Mod", emoji: "", role: ROLE.mod }], ...extra });

describe("role menus", () => {
  it("posts on save, edits in place and deletes removed menus", async () => {
    const t = setup([roles]);
    const saved = await t.configure("reaction-roles", { menus: [menu()] });
    expect(saved.warnings).toEqual([]);
    expect(JSON.stringify(t.fake.sent[0]?.content)).toContain(`rr:${(saved.settings.menus as { id: string }[])[0]!.id}:0`);
    await t.configure("reaction-roles", { menus: [{ ...(saved.settings.menus as object[])[0], title: "Pick again" }] });
    expect(t.fake.edits).toHaveLength(1);
    await t.configure("reaction-roles", { menus: [] });
    expect(t.fake.deleted).toHaveLength(1);
  });

  it("toggles roles with buttons and sets them with a select", async () => {
    const t = setup([roles]);
    const { settings } = await t.configure("reaction-roles", { menus: [menu({ mode: "single" })] });
    const id = (settings.menus as { id: string }[])[0]!.id;
    expect((await t.fake.click(`rr:${id}:0`, { who: MEMBER })).text).toBe("Added: Raider");
    expect((await t.fake.click(`rr:${id}:1`, { who: MEMBER })).text).toBe("Added: Moderator · Removed: Raider");
    expect((await t.fake.click(`rr:${id}:1`, { who: MEMBER })).text).toBe("Removed: Moderator");
    expect((await t.fake.click(`rr:${id}:7`, { who: MEMBER })).text).toContain("not part of this menu");
    expect((await t.fake.click(`rr:${id}`, { who: MEMBER, values: ["0", "1"] })).text).toBe("Pick one role only.");
    expect((await t.fake.click(`rr:${id}`, { who: MEMBER, values: ["1"] })).text).toBe("Added: Moderator");
    expect((await t.fake.click(`rr:nope:0`, { who: MEMBER })).text).toContain("no longer exists");
  });
});
