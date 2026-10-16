// SPDX-License-Identifier: Apache-2.0
/**
 * Social alerts: RSS/Atom feeds, YouTube channels (their feed) and Twitch live streams (TWITCH_CLIENT_ID and
 * TWITCH_CLIENT_SECRET; skipped without them), polled by the scheduler and posted once per item. The first poll of a
 * feed only remembers what is there, so adding a feed does not flood the channel.
 */
import { fetchText } from "../../net";
import { defineModule, type Room, type Settings } from "../types";
import { fill, post } from "../util";
import { Twitch, feedUrl, fresh, parseFeed, type FeedItem } from "./feeds";

interface Feed {
  id: string;
  kind: "rss" | "youtube" | "twitch";
  source: string;
  channel: string;
  template: string;
  role: string;
}
interface S extends Settings {
  intervalMinutes: number;
  feeds: Feed[];
}

export default defineModule<S>({
  id: "social-alerts",
  title: "Social alerts",
  description: "Posts new items of feeds, YouTube channels and Twitch streams.",
  defaults: { intervalMinutes: 10, feeds: [] },
  schema: [
    { key: "intervalMinutes", type: "number", label: "Check every (minutes)", min: 5, max: 1440 },
    {
      key: "feeds",
      type: "items",
      label: "Feeds",
      itemLabel: "source",
      max: 10,
      fields: [
        { key: "kind", type: "select", label: "Kind", options: [{ value: "rss", label: "RSS or Atom feed" }, { value: "youtube", label: "YouTube channel" }, { value: "twitch", label: "Twitch stream" }] },
        { key: "source", type: "string", label: "Feed URL, YouTube channel id or Twitch login", max: 500, required: true },
        { key: "channel", type: "channel", label: "Channel", required: true },
        { key: "template", type: "text", label: "Message", help: "Placeholders: {title}, {link}.", max: 500 },
        { key: "role", type: "role", label: "Role to mention" },
      ],
    },
  ],
  register(ctx) {
    const twitch = ctx.config.twitch ? new Twitch(ctx.config.twitch.clientId, ctx.config.twitch.clientSecret) : null;
    const items = async (f: Feed): Promise<FeedItem[] | null> => {
      const url = feedUrl(f.kind, f.source);
      if (typeof url !== "string") return null;
      if (f.kind === "twitch") return twitch ? twitch.live(url) : null;
      return parseFeed(await fetchText(url, { allowPrivate: ctx.config.allowPrivateFeeds }));
    };
    const check = async (room: Room, f: Feed) => {
      const got = await items(f);
      if (!got) return;
      const seenKey = `seen:${f.id}`;
      const { post: news, seen } = fresh(got, JSON.parse(ctx.state.get(room, seenKey) ?? "null") as string[] | null);
      ctx.state.set(room, seenKey, JSON.stringify(seen));
      const roleName = f.role ? (await ctx.cache.roles(room.ref).catch(() => [])).find((r) => r.id === f.role)?.name : null;
      for (const item of news) {
        const text = fill(f.template || "📢 {title}\n{link}", { title: item.title, link: item.link });
        await post(ctx, room, f.channel, roleName ? `@${roleName} ${text}` : text, f.role && roleName ? [`role:${f.role}`] : []);
      }
    };
    ctx.every(60_000, async () => {
      for (const room of ctx.enabledRooms()) {
        const s = ctx.settings(room);
        for (const f of s.feeds) {
          const key = `check:${f.id}`;
          if (Date.now() - Number(ctx.state.get(room, key) ?? 0) < s.intervalMinutes * 60_000) continue;
          ctx.state.set(room, key, String(Date.now()));
          await check(room, f).catch((e: unknown) => ctx.log.info("feed check failed", { room: room.ref, feed: f.id, error: e }));
        }
      }
    });
  },
  async onSave(ctx, _room, s) {
    return s.feeds.flatMap((f) => {
      const u = feedUrl(f.kind, f.source);
      if (typeof u !== "string") return [`Feed "${f.source}": ${u.error}.`];
      return f.kind === "twitch" && !ctx.config.twitch ? [`Feed "${f.source}": Twitch needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET on the server.`] : [];
    });
  },
});
