// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH } from "../../fake-bot";
import { setup } from "../../test-utils";
import reminders, { nextRun } from "./index";

const at = (iso: string) => Date.parse(iso);

describe("reminder schedule", () => {
  it("computes once, daily and weekly runs in the room's zone", () => {
    expect(nextRun({ repeat: "once", at: "2026-11-02T18:00" }, "Europe/Berlin", at("2026-11-01T00:00:00Z"))).toBe(at("2026-11-02T17:00:00Z"));
    expect(nextRun({ repeat: "once", at: "2026-11-02T18:00" }, "UTC", at("2026-11-03T00:00:00Z"))).toBeNull();
    expect(nextRun({ repeat: "daily", at: "2026-11-02T18:00" }, "UTC", at("2026-11-05T19:00:00Z"))).toBe(at("2026-11-06T18:00:00Z"));
    expect(nextRun({ repeat: "daily", at: "2026-11-02T18:00" }, "UTC", at("2026-10-01T00:00:00Z"))).toBe(at("2026-11-02T18:00:00Z"));
    // 2026-11-02 is a Monday: the next Monday after Wednesday the 4th is the 9th.
    expect(nextRun({ repeat: "weekly", at: "2026-11-02T18:00" }, "UTC", at("2026-11-04T00:00:00Z"))).toBe(at("2026-11-09T18:00:00Z"));
  });
});

describe("reminders", () => {
  it("sends a due daily message once per day and warns about past one-offs", async () => {
    const t = setup([reminders]);
    const { warnings } = await t.configure("reminders", { reminders: [{ channel: CH.general, message: "Standup!", repeat: "daily", at: "2020-01-01T00:00" }, { channel: CH.general, message: "Old", repeat: "once", at: "2020-01-01T00:00" }] });
    expect(warnings).toEqual(['"Old" is in the past and will not be sent.']);
    const id = (t.db.get<{ json: string }>("SELECT json FROM room_settings")!.json.match(/"id":"([\w-]+)"/) ?? [])[1]!;
    t.db.run("UPDATE module_state SET value = ? WHERE key = ?", String(Date.now() - 86_400_000 - 1000), `since:${id}`);
    const job = (t.platform as unknown as { jobs: [number, () => Promise<void>][] }).jobs[0]![1];
    await job();
    await job();
    expect(t.fake.sent.map((m) => m.content)).toEqual(["Standup!"]);
  });
});
