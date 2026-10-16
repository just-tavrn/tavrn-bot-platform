// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, MEMBER, OWNER, type FakeUser } from "../../fake-bot";
import { setup } from "../../test-utils";
import { utcToWall } from "../util";
import raid from "./index";

const ALICE: FakeUser = { user: "alice@fake.example", userId: "01FAKEALICE000000000000000" };
const event = (extra = {}) => ({ title: "Molten Core", game: "wow", start: utcToWall(Date.now() + 48 * 3_600_000, "UTC"), channel: CH.raids, leader: "", description: "", tanks: 1, healers: 1, dps: 0, max: 3, deadlineHours: 0, remind24: true, remind1: false, remindDm: false, status: "open", ...extra });

async function created() {
  const t = setup([raid]);
  await t.configure("raid-helper", { channel: CH.raids });
  const events = t.platform.collections("raid-helper").events!;
  const saved = await events.save!(t.room, event(), null, OWNER.user);
  const msg = t.fake.sent[0]!.id;
  const click = (id: string, who: FakeUser, values?: string[]) => t.fake.click(id.replace("#", String(saved.id)), { who, messageId: msg, values });
  return { t, events, saved, msg, click };
}

describe("raid helper", () => {
  it("posts the card with buttons and every spec, and lists the event", async () => {
    const { t, events } = await created();
    const json = JSON.stringify(t.fake.sent[0]!.content);
    expect(json).toContain("Molten Core");
    expect(json).toContain("raid:spec:1:1");
    expect(json).toContain("Paladin – Holy");
    expect(await events.list!(t.room)).toMatchObject([{ title: "Molten Core", signed: "0/3", status: "open", leader: OWNER.user }]);
  });

  it("signs up by spec into the role, benches when the role is full and reuses the spec", async () => {
    const { click } = await created();
    const first = await click("raid:spec:#:0", MEMBER, ["7.1"]); // Paladin Protection: tank
    expect(first.text).toContain("🛡️ Tanks 1/1: member@fake.example (Paladin Protection)");
    const second = await click("raid:spec:#:0", ALICE, ["0.0"]); // Death Knight Blood: tank, full
    expect(second.text).toContain("🪑 Bench: alice@fake.example (Death Knight Blood)");
    await click("raid:d:#", MEMBER);
    const again = await click("raid:s:#", MEMBER);
    expect(again.text).toContain("Tanks 1/1: member@fake.example");
    expect((await click("raid:spec:#:0", ALICE, ["40.9"])).text).toContain("Pick one class");
    expect((await click("raid:s:#", OWNER)).text).toContain("Pick your class");
  });

  it("lets only leaders and moderators manage, bench and move", async () => {
    const { t, click } = await created();
    await click("raid:spec:#:0", MEMBER, ["7.1"]);
    expect((await click("raid:m:#", MEMBER)).text).toContain("Only the raid leader");
    expect((await click("raid:m:#", OWNER)).answers[0]?.type).toBe("modal");
    const moved = await t.fake.submit("raid:mm:1", { member: MEMBER.user, action: "healer" }, OWNER, t.fake.sent[0]!.id);
    expect(moved.text).toContain("💚 Healers 1/1: member@fake.example");
    const closed = await t.fake.submit("raid:mm:1", { member: "", action: "close" }, OWNER, t.fake.sent[0]!.id);
    expect(closed.text).toContain("Sign-ups closed");
    expect((await click("raid:b:#", MEMBER)).text).toContain("closed");
  });

  it("reminds the signed members 24 hours before", async () => {
    const { t, click } = await created();
    await click("raid:spec:#:0", MEMBER, ["7.1"]);
    t.db.run("UPDATE raid_events SET starts_at = ?", Date.now() + 23 * 3_600_000);
    const job = (t.platform as unknown as { jobs: [number, () => Promise<void>][] }).jobs[0]![1];
    await job();
    await job();
    const reminders = t.fake.sent.filter((m) => String(m.content).startsWith("⏰"));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.content).toContain(`@${MEMBER.user}`);
  });

  it("creates events from the /raid form and adds games of the room", async () => {
    const t = setup([raid]);
    await t.configure("raid-helper", { channel: CH.raids });
    const games = t.platform.collections("raid-helper").games!;
    await games.save!(t.room, { name: "Elder Scrolls Online", classes: [{ name: "Templar", specs: [{ name: "Healer", role: "healer" }] }] }, null, OWNER.user);
    expect((await t.fake.invoke("raid", {}, MEMBER)).text).toContain("Only raid leaders");
    expect((await t.fake.submit("raid:new", { title: "Trial", when: "2030-01-05 20:00", sizes: "2/2/8", game: "elder scrolls online", description: "" })).text).toContain("Event created");
    expect(JSON.stringify(t.fake.sent[0]!.content)).toContain("Templar – Healer");
    expect((await t.fake.submit("raid:new", { title: "x", when: "tomorrow", sizes: "", game: "" })).text).toContain("2026-11-20 20:00");
  });
});
