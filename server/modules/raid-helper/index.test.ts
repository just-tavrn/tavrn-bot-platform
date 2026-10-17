// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { CH, MEMBER, OWNER, type FakeUser } from "../../fake-bot";
import { setup } from "../../test-utils";
import { utcToWall } from "../util";
import raid from "./index";

type Card = { body: string; components: { components: { custom_id: string; options?: { label: string; value: string }[] }[] }[] };
type Form = { custom_id: string; inputs: { custom_id: string; style: string; options: { label: string; value: string }[] }[] };
const ALICE: FakeUser = { user: "alice@fake.example", userId: "01FAKEALICE000000000000000" };
const event = (extra = {}) => ({ title: "Molten Core", game: "wow", start: utcToWall(Date.now() + 48 * 3_600_000, "UTC"), channel: CH.raids, leader: "", description: "", tanks: 1, healers: 1, dps: 0, max: 3, deadlineHours: 0, remind24: true, remind1: false, remindDm: false, status: "open", ...extra });

async function created() {
  const t = setup([raid]);
  await t.configure("raid-helper", { channel: CH.raids });
  const events = t.platform.collections("raid-helper").events!;
  const saved = await events.save!(t.room, event(), null, OWNER.user);
  const msg = t.fake.sent[0]!.id;
  const click = (id: string, who: FakeUser, values?: string[]) => t.fake.click(id.replace("#", String(saved.id)), { who, messageId: msg, channelId: CH.raids, values });
  const pickClass = async (who: FakeUser, value: string) => {
    const answer = await click("raid:class:#", who, [value]);
    expect(answer.answers[0]!.type).toBe("modal");
    return answer.answers[0]!.content as Form;
  };
  const submit = (form: Form, who: FakeUser, spec: string) => t.fake.submit(form.custom_id, { spec }, who, msg, CH.raids);
  const signup = async (who: FakeUser, value: string) => submit(await pickClass(who, value.split(".")[0]!), who, value);
  return { t, events, saved, msg, click, pickClass, submit, signup };
}

describe("raid helper", () => {
  it("posts readable event details, roster sections and a class menu, and lists the event", async () => {
    const { t, events } = await created();
    const content = t.fake.sent[0]!.content as Card;
    expect(content.body).toContain("Molten Core");
    expect(content.body).toContain("**Tanks · 0/1**\n–");
    expect(content.body).toContain("\n\n💚 **Healers · 0/1**\n–");
    expect(content.body).toContain("**Signed up:** 0/3\nSign-ups open");
    expect(content.body).toContain(`**Leader:** @${OWNER.user}`);
    const classes = content.components.flatMap((r) => r.components).filter((c) => c.options);
    expect(classes).toHaveLength(1);
    expect(classes[0]!.options).toHaveLength(13);
    expect(JSON.stringify(content)).not.toContain("Paladin – Holy");
    expect(await events.list!(t.room)).toMatchObject([{ title: "Molten Core", signed: "0/3", status: "open", leader: OWNER.user }]);
    expect((t.fake.sent[0]!.opts as { mentions?: string[] } | undefined)?.mentions).toBeUndefined();
  });

  it("opens a private spec form for the chosen class without editing the public card or signing up early", async () => {
    const { t, pickClass } = await created();
    const form = await pickClass(MEMBER, "7");
    expect(form.inputs).toMatchObject([{ custom_id: "spec", style: "select", options: [
      { label: "Holy", value: "7.0" }, { label: "Protection", value: "7.1" }, { label: "Retribution", value: "7.2" },
    ] }]);
    expect(t.db.all("SELECT * FROM raid_signups")).toEqual([]);
    expect(t.fake.edits).toHaveLength(0);
    expect(t.fake.sent).toHaveLength(1);
  });

  it("signs up by spec into the role, benches when full and reuses the spec", async () => {
    const { click, signup } = await created();
    expect((await signup(MEMBER, "7.1")).text).toContain("🛡️ **Tanks · 1/1**\n• @member@fake.example — Paladin · Protection");
    expect((await signup(ALICE, "0.0")).text).toContain("🪑 **Bench · 1**\n• @alice@fake.example — Death Knight · Blood");
    await click("raid:d:#", MEMBER);
    expect((await click("raid:s:#", MEMBER)).text).toContain("Tanks · 1/1**\n• @member@fake.example");
    expect((await click("raid:class:#", ALICE, ["40"])).text).toContain("Pick one class");
    expect((await click("raid:class:#", ALICE, ["0", "7"])).text).toContain("Pick one class");
    expect((await click("raid:s:#", OWNER)).text).toContain("Pick your class");
  });

  it("keeps concurrent members' personal choices independent and binds each form to its owner and class", async () => {
    const { t, pickClass, submit } = await created();
    const member = await pickClass(MEMBER, "7");
    const alice = await pickClass(ALICE, "0");
    expect((await submit(member, ALICE, "7.1")).text).toContain("Choose your class");
    expect((await submit(member, MEMBER, "0.0")).text).toContain("Choose a spec");
    expect((await submit(member, { ...MEMBER, userId: ALICE.userId }, "7.1")).text).toContain("Choose your class");
    expect((await submit(member, MEMBER, "7.1")).answers[0]!.type).toBe("update");
    expect((await submit(alice, ALICE, "0.0")).answers[0]!.type).toBe("update");
    expect((await submit(member, MEMBER, "7.1")).text).toContain("Choose your class");
    expect(t.db.all("SELECT user, class, spec FROM raid_signups ORDER BY user")).toEqual([
      { user: ALICE.user, class: "Death Knight", spec: "Blood" }, { user: MEMBER.user, class: "Paladin", spec: "Protection" },
    ]);
  });

  it("rejects a replaced or expired personal form", async () => {
    const { t, pickClass, submit } = await created();
    const first = await pickClass(MEMBER, "7");
    const current = await pickClass(MEMBER, "0");
    expect((await submit(first, MEMBER, "7.1")).text).toContain("Choose your class");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60_000);
    try { expect((await submit(current, MEMBER, "0.0")).text).toContain("Choose your class"); }
    finally { vi.restoreAllMocks(); }
    expect(t.db.all("SELECT * FROM raid_signups")).toEqual([]);
  });

  it("rejects closed events, changed games, wrong messages and wrong conversations", async () => {
    const { t, pickClass, submit, events, saved, msg } = await created();
    let form = await pickClass(MEMBER, "7");
    expect((await t.fake.submit(form.custom_id, { spec: "7.1" }, MEMBER, "other-message", CH.raids)).text).toContain("does not exist");
    expect((await t.fake.submit(form.custom_id, { spec: "7.1" }, MEMBER, msg, CH.general)).text).toContain("does not exist");
    await events.save!(t.room, event({ game: "ff14" }), String(saved.id), OWNER.user);
    expect((await submit(form, MEMBER, "7.1")).text).toContain("Choose your class");
    await events.save!(t.room, event(), String(saved.id), OWNER.user);
    form = await pickClass(MEMBER, "7");
    t.db.run("UPDATE raid_events SET status = 'closed'");
    expect((await submit(form, MEMBER, "7.1")).text).toContain("closed");
    expect(t.db.all("SELECT * FROM raid_signups")).toEqual([]);
  });

  it("rejects remembered specs from an event's previous game", async () => {
    const { t, events, saved, signup, click } = await created();
    await signup(MEMBER, "7.1");
    await events.save!(t.room, event({ game: "ff14" }), String(saved.id), OWNER.user);
    expect((await click("raid:s:#", MEMBER)).text).toContain("Pick your class");
  });

  it("invalidates a personal form when the member chooses a later status", async () => {
    const { t, pickClass, submit, click } = await created();
    const form = await pickClass(MEMBER, "7");
    await click("raid:d:#", MEMBER);
    expect((await submit(form, MEMBER, "7.1")).text).toContain("Choose your class");
    expect(t.db.all("SELECT status FROM raid_signups")).toEqual([{ status: "declined" }]);
  });

  it("does not restore an older form after a status action while node discovery is pending", async () => {
    const { t, click } = await created();
    const api = t.fake.api.bind(t.fake);
    let resolveInfo!: (node: { capabilities: string[] }) => void;
    let requested!: () => void;
    const request = new Promise<void>((resolve) => { requested = resolve; });
    vi.spyOn(t.fake, "api").mockImplementation(() => ({ ...api(), node: { info: () => {
      requested();
      return new Promise((resolve) => { resolveInfo = resolve; });
    } } }));
    const pending = click("raid:class:#", MEMBER, ["7"]);
    await request;
    await click("raid:d:#", MEMBER);
    resolveInfo({ capabilities: t.fake.nodeCapabilities });
    const result = await pending;
    expect(result.answers[0]!.type).toBe("ephemeral");
    expect(t.db.all("SELECT * FROM module_state WHERE module = 'raid-helper'")).toEqual([]);
  });

  it("keeps only the latest personal class choice when node replies arrive out of order", async () => {
    const { t, click, submit } = await created();
    const api = t.fake.api.bind(t.fake);
    const resolveInfo: ((node: { capabilities: string[] }) => void)[] = [];
    vi.spyOn(t.fake, "api").mockImplementation(() => ({ ...api(), node: { info: () => new Promise((resolve) => { resolveInfo.push(resolve); }) } }));
    const first = click("raid:class:#", MEMBER, ["7"]);
    const second = click("raid:class:#", MEMBER, ["0"]);
    resolveInfo[1]!({ capabilities: t.fake.nodeCapabilities });
    const latest = await second;
    resolveInfo[0]!({ capabilities: t.fake.nodeCapabilities });
    expect((await first).answers[0]!.type).toBe("ephemeral");
    expect(latest.answers[0]!.type).toBe("modal");
    expect((await submit(latest.answers[0]!.content as Form, MEMBER, "0.0")).text).toContain("Death Knight · Blood");
  });

  it("bounds a large roster to the message limit while retaining totals and omitted-member counts", async () => {
    const { t, events, saved, click } = await created();
    await events.save!(t.room, event({ title: "R".repeat(100), description: "d".repeat(1000), tanks: 0, healers: 0, dps: 0, max: 0 }), String(saved.id), OWNER.user);
    for (let n = 0; n < 90; n++) {
      const role = ["tank", "healer", "dps"][n % 3]!;
      const status = n < 60 ? "signed" : ["bench", "tentative", "declined"][n % 3]!;
      t.db.run("INSERT INTO raid_signups (event_id, user, status, class, spec, role, at) VALUES (?, ?, ?, ?, ?, ?, ?)", saved.id, `raider-${n}-${"x".repeat(150)}@long.example`, status, "C".repeat(40), "S".repeat(40), role, n);
    }
    const result = await click("raid:t:#", OWNER);
    expect([...result.text].length).toBeLessThanOrEqual(4000);
    expect(result.text).toContain("**Tanks · 20**");
    expect(result.text).toContain("**Signed up:** 60");
    expect(result.text).toMatch(/… \d+ more/);
  });

  it("keeps every custom class reachable through one paged class menu", async () => {
    const { t, events, saved, click, pickClass } = await created();
    const game = await t.platform.collections("raid-helper").games!.save!(t.room, { name: "Many classes", classes: Array.from({ length: 40 }, (_, n) => ({ name: `Class ${n}`, specs: [{ name: "DPS", role: "dps" }] })) }, null, OWNER.user);
    await events.save!(t.room, event({ game: `g${game.id}` }), String(saved.id), OWNER.user);
    const next = await click("raid:page:#:1", MEMBER);
    const menus = (next.answers[0]!.content as Card).components.flatMap((r) => r.components).filter((c) => c.options);
    expect(menus).toHaveLength(1);
    expect(menus[0]!.options).toHaveLength(15);
    expect(menus[0]!.options!.at(-1)).toMatchObject({ label: "Class 39", value: "39" });
    expect((await pickClass(MEMBER, "39")).inputs[0]!.options).toEqual([{ label: "DPS", value: "39.0", emoji: "⚔️" }]);
    expect((await click("raid:page:#:9", MEMBER)).text).toContain("does not exist");
  });

  it("refreshes legacy combined menus and removes pending state when an event is deleted", async () => {
    const { t, click, pickClass, events, saved } = await created();
    const legacy = await click("raid:spec:#:0", MEMBER, ["7.1"]);
    expect(legacy.answers.map((answer) => answer.type)).toEqual(["update", "followUp"]);
    expect(legacy.answers[0]!.content).toMatchObject({ components: expect.any(Array) });
    expect(t.db.all("SELECT * FROM raid_signups")).toEqual([]);
    await pickClass(MEMBER, "7");
    expect(t.db.all("SELECT * FROM module_state WHERE module = 'raid-helper'")).toHaveLength(1);
    await events.remove!(t.room, String(saved.id));
    expect(t.db.all("SELECT * FROM module_state WHERE module = 'raid-helper'")).toEqual([]);
  });

  it("gives an update hint on nodes without personal select forms", async () => {
    const { t, click } = await created();
    t.fake.nodeCapabilities = ["components.v1"];
    expect((await click("raid:class:#", MEMBER, ["7"])).text).toContain("update");
    expect(t.db.all("SELECT * FROM raid_signups")).toEqual([]);
  });

  it("lets only leaders and moderators manage, bench and move", async () => {
    const { t, click, signup, msg } = await created();
    await signup(MEMBER, "7.1");
    expect((await click("raid:m:#", MEMBER)).text).toContain("Only the raid leader");
    expect((await click("raid:m:#", OWNER)).answers[0]?.type).toBe("modal");
    const moved = await t.fake.submit("raid:mm:1", { member: MEMBER.user, action: "healer" }, OWNER, msg, CH.raids);
    expect(moved.text).toContain("💚 **Healers · 1/1**\n• @member@fake.example");
    expect((await t.fake.submit("raid:mm:1", { member: "", action: "close" }, OWNER, msg, CH.raids)).text).toContain("Sign-ups closed");
    expect((await click("raid:b:#", MEMBER)).text).toContain("closed");
  });

  it("reminds the signed members 24 hours before", async () => {
    const { t, signup } = await created();
    await signup(MEMBER, "7.1");
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
    await t.platform.collections("raid-helper").games!.save!(t.room, { name: "Elder Scrolls Online", classes: [{ name: "Templar", specs: [{ name: "Healer", role: "healer" }] }] }, null, OWNER.user);
    expect((await t.fake.invoke("raid", {}, MEMBER)).text).toContain("Only raid leaders");
    expect((await t.fake.submit("raid:new", { title: "Trial", when: "2030-01-05 20:00", sizes: "2/2/8", game: "elder scrolls online", description: "" })).text).toContain("Event created");
    expect(JSON.stringify(t.fake.sent[0]!.content)).toContain("Templar");
    expect((await t.fake.submit("raid:new", { title: "x", when: "tomorrow", sizes: "", game: "" })).text).toContain("2026-11-20 20:00");
  });
});
