// SPDX-License-Identifier: Apache-2.0
/**
 * Starboard: a message that reaches N reactions of the chosen emoji is reposted once to the starboard channel.
 * Messages of encrypted channels are only reposted into an encrypted starboard, never into plaintext.
 */
import { defineModule, type Settings } from "../types";
import { at, post } from "../util";

interface S extends Settings {
  channel: string;
  emoji: string;
  threshold: number;
}

export default defineModule<S>({
  id: "starboard",
  title: "Starboard",
  description: "Reposts popular messages to a starboard channel.",
  defaults: { channel: "", emoji: "⭐", threshold: 3 },
  schema: [
    { key: "channel", type: "channel", label: "Starboard channel", required: true },
    { key: "emoji", type: "string", label: "Emoji", max: 40, required: true },
    { key: "threshold", type: "number", label: "Reactions needed", min: 1, max: 100 },
  ],
  register(ctx) {
    ctx.on("reaction", async (e, room, s) => {
      if (!e.added || e.emoji !== s.emoji || e.count < s.threshold || !s.channel || e.conversationId === s.channel) return;
      const key = `star:${e.messageId}`;
      if (ctx.state.get(room, key)) return;
      if (e.encrypted) {
        const board = (await ctx.cache.channels(room.ref).catch(() => [])).find((c) => c.id === s.channel);
        if (!board?.encrypted) return;
      }
      ctx.state.set(room, key, "1");
      const [m] = (await ctx.bot.messages(e.conversation, { around: e.messageId, limit: 1 })).filter((x) => x.id === e.messageId);
      if (!m) return;
      const quote = m.text ? m.text.split("\n").slice(0, 10).map((l) => `> ${l}`).join("\n") : "> (attachment)";
      await post(ctx, room, s.channel, `${s.emoji} ${e.count} · ${at(m.author)}\n${quote}`);
    });
  },
});
