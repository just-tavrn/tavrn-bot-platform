// SPDX-License-Identifier: Apache-2.0
/** Feed sources: RSS and Atom (also YouTube's channel feed) parsed without a library, and Twitch's live status. */

export interface FeedItem {
  id: string;
  title: string;
  link: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => (e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10)) : (ENTITIES[e] ?? all)))
    .trim();
}

const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1];

/** The items of an RSS or Atom document, in document order (newest first in practice), at most 50. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, 50);
  return blocks.flatMap(([, , b]) => {
    const atomLink = /<link\b[^>]*?href="([^"]+)"[^>]*?(?:rel="alternate"[^>]*)?\/?>/i.exec(b!)?.[1];
    const link = decode(atomLink ?? tag(b!, "link") ?? "");
    const id = decode(tag(b!, "yt:videoId") ?? tag(b!, "guid") ?? tag(b!, "id") ?? link);
    const title = decode(tag(b!, "title") ?? "").replace(/<[^>]+>/g, "").slice(0, 300);
    return id ? [{ id: id.slice(0, 300), title, link: /^https?:\/\//.test(link) ? link : "" }] : [];
  });
}

/** The feed URL of a source, or a reason it is not valid. */
export function feedUrl(kind: string, source: string): string | { error: string } {
  const s = source.trim();
  if (kind === "youtube") {
    const id = /(?:channel_id=|channel\/)?(UC[\w-]{22})\b/.exec(s)?.[1];
    return id ? `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` : { error: "a YouTube channel id starts with UC and has 24 characters" };
  }
  if (kind === "twitch") return /^[a-zA-Z0-9_]{3,25}$/.test(s) ? s.toLowerCase() : { error: "a Twitch login has 3–25 letters, digits or _" };
  return /^https?:\/\/\S+$/.test(s) ? s : { error: "the feed must be an http(s) URL" };
}

/** Items not seen yet (oldest first, at most `max`) and the new list of seen ids (bounded). */
export function fresh(items: FeedItem[], seen: string[] | null, max = 3): { post: FeedItem[]; seen: string[] } {
  const ids = items.map((i) => i.id);
  if (!seen) return { post: [], seen: ids.slice(0, 200) };
  const known = new Set(seen);
  const post = items.filter((i) => !known.has(i.id)).slice(0, max).reverse();
  return { post, seen: [...new Set([...ids, ...seen])].slice(0, 200) };
}

/** Twitch Helix with an app access token (client credentials), cached until it expires. */
export class Twitch {
  private token: { value: string; until: number } | null = null;
  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  private async bearer(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, grant_type: "client_credentials" });
    const res = await this.fetchImpl("https://id.twitch.tv/oauth2/token", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Twitch token: HTTP ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
    return j.access_token;
  }
  /** The live stream of a login as a feed item (id = the stream's id, so every new stream counts once). */
  async live(login: string): Promise<FeedItem[]> {
    const res = await this.fetchImpl(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, { headers: { "Client-Id": this.clientId, Authorization: `Bearer ${await this.bearer()}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new Error(`Twitch: HTTP ${res.status}`);
    const s = ((await res.json()) as { data: { id: string; title: string; user_login: string }[] }).data[0];
    return s ? [{ id: s.id, title: s.title.slice(0, 300), link: `https://twitch.tv/${s.user_login}` }] : [];
  }
}
