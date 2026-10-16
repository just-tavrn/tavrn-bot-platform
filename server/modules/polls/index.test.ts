// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { MEMBER, OWNER } from "../../fake-bot";
import { setup } from "../../test-utils";
import polls, { parsePoll, summary } from "./index";

describe("poll form and summary", () => {
  it("checks the form", () => {
    expect(parsePoll({ question: "Pizza?", options: "Yes\nNo\nYes", minutes: "", choices: "" })).toEqual({ question: "Pizza?", options: ["Yes", "No"], maxChoices: 1, minutes: null });
    expect(parsePoll({ question: "Q", options: "one" })).toContain("2 to 10");
    expect(parsePoll({ question: "", options: "a\nb" })).toContain("question");
    expect(parsePoll({ question: "Q", options: "a\nb", minutes: "0" })).toContain("duration");
    expect(parsePoll({ question: "Q", options: "a\nb", choices: "3" })).toContain("Choices");
  });
  it("summarizes the tally", () => {
    const t = { voters: 4, options: [{ id: "o1", label: "Yes", count: 3 }, { id: "o2", label: "No", count: 1 }], best: ["o1"] };
    expect(summary("Pizza?", t)).toBe('📊 Results of "Pizza?" (4 votes):\nYes: 3 (75%) 🏆\nNo: 1 (25%)');
    expect(summary("Pizza?", { voters: 0, options: [], best: [] })).toContain("without votes");
  });
});

describe("polls", () => {
  it("creates a native poll from the form and posts the summary when it closes", async () => {
    const t = setup([polls]);
    await t.configure("polls");
    expect((await t.fake.invoke("poll", {}, OWNER)).answers[0]?.type).toBe("modal");
    expect((await t.fake.submit("poll:create", { question: "Pizza?", options: "Yes\nNo", minutes: "5" })).text).toBe("Your poll is up.");
    expect(t.fake.polls[0]?.poll).toEqual({ kind: "choice", question: "Pizza?", options: ["Yes", "No"], maxChoices: 1 });
    t.db.run("UPDATE polls SET closes_at = 0");
    t.fake.tally = { voters: 1, options: [{ id: "o1", label: "Yes", count: 1 }, { id: "o2", label: "No", count: 0 }], best: ["o1"] };
    const job = (t.platform as unknown as { jobs: [number, () => Promise<void>][] }).jobs[0]![1];
    await job();
    expect(t.fake.sent[0]).toMatchObject({ content: expect.stringContaining("Yes: 1 (100%) 🏆"), opts: { replyTo: t.fake.polls[0]!.id } });
  });

  it("needs Send polls unless the room allows everybody", async () => {
    const t = setup([polls]);
    await t.configure("polls");
    expect((await t.fake.invoke("poll", {}, MEMBER)).text).toContain("may not send polls");
    await t.configure("polls", { allowWithoutPermission: true });
    expect((await t.fake.invoke("poll", {}, MEMBER)).answers[0]?.type).toBe("modal");
  });
});
