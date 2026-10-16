// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { CH, FAKE_NODE, FAKE_ROOM } from "../../fake-bot";
import { setup } from "../../test-utils";
import starboard from "./index";

const reaction = (count: number, extra = {}) => ({ node: FAKE_NODE, conversation: `${FAKE_NODE}/${CH.general}`, conversationId: CH.general, roomId: FAKE_ROOM, messageId: "h0", emoji: "⭐", count, added: true, user: null, userId: null, encrypted: false, message: {} as never, ...extra });

describe("starboard", () => {
  it("reposts once when the threshold is reached", async () => {
    const t = setup([starboard]);
    await t.configure("starboard", { channel: CH.log, threshold: 2 });
    await t.fake.emit("reaction", reaction(1));
    await t.fake.emit("reaction", reaction(2));
    await t.fake.emit("reaction", reaction(3));
    expect(t.fake.sent).toHaveLength(1);
    expect(t.fake.sent[0]?.content).toBe("⭐ 2 · @member@fake.example\n> old 0");
  });
  it("never moves encrypted messages into a plaintext starboard", async () => {
    const t = setup([starboard]);
    await t.configure("starboard", { channel: CH.log, threshold: 1 });
    await t.fake.emit("reaction", reaction(1, { encrypted: true }));
    expect(t.fake.sent).toHaveLength(0);
  });
});
