// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Twitch, decode, feedUrl, fresh, parseFeed } from "./feeds";

const RSS = `<?xml version="1.0"?><rss><channel><title>Blog</title>
<item><title><![CDATA[Second & last]]></title><link>https://blog.example/2</link><guid isPermaLink="false">post-2</guid></item>
<item><title>First &amp; best</title><link>https://blog.example/1</link><guid>post-1</guid></item></channel></rss>`;
const ATOM = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId>
<title>New video</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/></entry></feed>`;

describe("feeds", () => {
  it("parses RSS and Atom items", () => {
    expect(parseFeed(RSS)).toEqual([{ id: "post-2", title: "Second & last", link: "https://blog.example/2" }, { id: "post-1", title: "First & best", link: "https://blog.example/1" }]);
    expect(parseFeed(ATOM)).toEqual([{ id: "abc", title: "New video", link: "https://www.youtube.com/watch?v=abc" }]);
    expect(decode("&#x1F600; &lt;b&gt;")).toBe("😀 <b>");
  });
  it("posts only new items, oldest first, and nothing on the first poll", () => {
    const items = parseFeed(RSS);
    const first = fresh(items, null);
    expect(first.post).toEqual([]);
    const next = fresh([{ id: "post-3", title: "Third", link: "" }, ...items], first.seen);
    expect(next.post.map((i) => i.id)).toEqual(["post-3"]);
    expect(fresh([{ id: "a", title: "", link: "" }, { id: "b", title: "", link: "" }], []).post.map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("checks sources", () => {
    expect(feedUrl("youtube", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv");
    expect(feedUrl("youtube", "nope")).toHaveProperty("error");
    expect(feedUrl("twitch", "Some_Streamer")).toBe("some_streamer");
    expect(feedUrl("rss", "ftp://x")).toHaveProperty("error");
  });
  it("reads Twitch's live status with a cached app token", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url).split("?")[0]!);
      const body = String(url).includes("oauth2") ? { access_token: "t", expires_in: 3600 } : { data: [{ id: "s1", title: "Raid night", user_login: "streamer" }] };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const t = new Twitch("id", "secret", fake);
    expect(await t.live("streamer")).toEqual([{ id: "s1", title: "Raid night", link: "https://twitch.tv/streamer" }]);
    await t.live("streamer");
    expect(calls.filter((c) => c.includes("oauth2"))).toHaveLength(1);
  });
});
