// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, FAKE_NODE } from "../../fake-bot";
import { setup } from "../../test-utils";
import polls, { parsePoll, summary } from "./index";

const form = (extra: Record<string, unknown> = {}) => ({ channel: CH.general, question: "Pizza?", options: "Yes\nNo", choices: 1, minutes: 5, postAt: "", ...extra });

async function room() {
  const t = setup([polls]);
  await t.configure("polls");
  const col = t.platform.collections("polls").polls!;
  const job = () => (t.platform as unknown as { jobs: [number, () => Promise<void>][] }).jobs[0]![1]();
  return { ...t, col, job };
}

describe("poll form and summary", () => {
  it("checks the form", () => {
    expect(parsePoll({ channel: CH.general, question: "Pizza?", options: "Yes\nNo\nYes", minutes: 0, choices: 1 })).toEqual({ channel: CH.general, question: "Pizza?", options: ["Yes", "No"], maxChoices: 1, minutes: null });
    expect(parsePoll({ question: "Q", options: "one" })).toContain("2 to 10");
    expect(parsePoll({ question: "", options: "a\nb" })).toContain("question");
    expect(parsePoll({ question: "Q", options: "a\nb", choices: 3 })).toContain("Choices");
  });
  it("summarizes the tally", () => {
    const t = { voters: 4, options: [{ id: "o1", label: "Yes", count: 3 }, { id: "o2", label: "No", count: 1 }], best: ["o1"] };
    expect(summary("Pizza?", t)).toBe('📊 Results of "Pizza?" (4 votes):\nYes: 3 (75%) 🏆\nNo: 1 (25%)');
    expect(summary("Pizza?", { voters: 0, options: [], best: [] })).toContain("without votes");
  });
});

describe("polls", () => {
  it("has no /poll command: the client's own creates native polls", () => {
    expect(polls.commands ?? []).toEqual([]);
  });

  it("creates a native poll from the dashboard and posts the summary when it closes", async () => {
    const t = await room();
    await t.col.save!(t.room, form(), null, "owner@fake.example");
    expect(t.fake.polls[0]).toMatchObject({ conversation: `${FAKE_NODE}/${CH.general}`, poll: { kind: "choice", question: "Pizza?", options: ["Yes", "No"], maxChoices: 1 } });
    expect(await t.col.list!(t.room)).toMatchObject([{ question: "Pizza?", results: "", status: "open" }]);
    t.db.run("UPDATE polls SET closes_at = 1");
    t.fake.tally = { voters: 1, options: [{ id: "o1", label: "Yes", count: 1 }, { id: "o2", label: "No", count: 0 }], best: ["o1"] };
    await t.job();
    expect(t.fake.sent[0]).toMatchObject({ content: expect.stringContaining("Yes: 1 (100%) 🏆"), opts: { replyTo: t.fake.polls[0]!.id } });
    expect(await t.col.list!(t.room)).toMatchObject([{ results: "Yes: 1 · No: 0 (1 vote)", status: "closed" }]);
    await t.job();
    expect(t.fake.sent).toHaveLength(1);
  });

  it("posts a scheduled poll at its time", async () => {
    const t = await room();
    await t.col.save!(t.room, form({ postAt: "2099-01-01T18:00" }), null, "owner@fake.example");
    expect(t.fake.polls).toEqual([]);
    expect((await t.col.list!(t.room))[0]!.status).toMatch(/^scheduled /);
    t.db.run("UPDATE polls SET posts_at = 1");
    await t.job();
    expect(t.fake.polls).toHaveLength(1);
    expect((await t.col.list!(t.room))[0]!.status).toBe("open");
  });

  it("lists the results of polls the bot saw votes for", async () => {
    const t = await room();
    t.fake.tally = { voters: 2, options: [{ id: "o1", label: "Yes", count: 2 }], best: ["o1"] };
    await t.fake.emit("pollVote", { node: FAKE_NODE, conversation: `${FAKE_NODE}/${CH.general}`, messageId: "theirs", user: "x@fake.example", record: null, retracted: false } as never);
    await t.fake.emit("pollVote", { node: FAKE_NODE, conversation: `${FAKE_NODE}/elsewhere`, messageId: "other", user: "x@fake.example", record: null, retracted: false } as never);
    expect(await t.col.list!(t.room)).toMatchObject([{ question: "Pizza?", results: "Yes: 2 (2 votes)", status: "open" }]);
  });
});
