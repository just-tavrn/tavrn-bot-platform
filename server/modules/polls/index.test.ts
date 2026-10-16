// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { MEMBER, OWNER } from "../../fake-bot";
import { setup } from "../../test-utils";
import polls, { parsePoll, tally } from "./index";

describe("poll maths", () => {
  it("counts votes and voters", () => {
    expect(tally(3, [{ user: "a", choice: 0 }, { user: "b", choice: 0 }, { user: "b", choice: 2 }, { user: "c", choice: 9 }])).toEqual({ counts: [2, 0, 1], voters: 3 });
  });
  it("checks question, options and duration", () => {
    expect(parsePoll("Q?", "a; b; a", "")).toEqual({ question: "Q?", options: ["a", "b"], minutes: null });
    expect(parsePoll("Q?", "only one", null)).toContain("2 to 10");
    expect(parsePoll("", "a;b", null)).toContain("question");
    expect(parsePoll("Q", "a;b", "0")).toContain("duration");
  });
});

describe("polls", () => {
  it("posts a card, counts single-choice votes in place and closes for the author only", async () => {
    const t = setup([polls]);
    await t.configure("polls");
    expect((await t.fake.invoke("poll", { question: "Pizza?", options: "Yes; No" })).text).toBe("Your poll is up.");
    const id = t.fake.sent[0]!.id;
    const v1 = await t.fake.click("poll:v:1:0", { who: MEMBER, messageId: id });
    expect(v1.text).toContain("Yes — 1 (100%)");
    const v2 = await t.fake.click("poll:v:1:1", { who: MEMBER, messageId: id });
    expect(v2.text).toContain("Yes — 0 (0%)");
    expect(v2.text).toContain("No — 1 (100%)");
    expect((await t.fake.click("poll:v:1:1", { who: MEMBER, messageId: "other" })).text).toContain("does not exist");
    expect((await t.fake.click("poll:close:1", { who: MEMBER, messageId: id })).text).toContain("Only the author");
    const closed = await t.fake.click("poll:close:1", { who: OWNER, messageId: id });
    expect(closed.text).toContain("Closed · 1 voters");
    expect((await t.fake.click("poll:v:1:0", { who: MEMBER, messageId: id })).text).toContain("closed");
  });

  it("opens a form without arguments", async () => {
    const t = setup([polls]);
    await t.configure("polls");
    expect((await t.fake.invoke("poll")).answers[0]?.type).toBe("modal");
    expect((await t.fake.submit("poll:create", { question: "Q", options: "a\nb\nc", minutes: "" })).text).toBe("Your poll is up.");
  });
});
