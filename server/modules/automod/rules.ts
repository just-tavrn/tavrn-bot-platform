// SPDX-License-Identifier: Apache-2.0
/** The automod rules as pure functions: a message and the author's recent history in, the first violation out. */

export type Action = "delete" | "warn" | "timeout" | "kick" | "ban";
export interface Violation {
  rule: string;
  action: Action;
  reason: string;
}
export interface RuleSettings {
  wordsOn: boolean;
  words: string[];
  wordsAction: Action;
  linksOn: boolean;
  allowedDomains: string[];
  invitesOn: boolean;
  linksAction: Action;
  capsOn: boolean;
  capsPercent: number;
  capsMinLength: number;
  capsAction: Action;
  mentionsOn: boolean;
  mentionsMax: number;
  mentionsAction: Action;
  floodOn: boolean;
  floodCount: number;
  floodSeconds: number;
  floodAction: Action;
  dupOn: boolean;
  dupCount: number;
  dupSeconds: number;
  dupAction: Action;
}
export interface Msg {
  text: string;
  mentions: number;
  at: number;
}

/** Patterns that can backtrack catastrophically (a quantified group that itself contains a quantifier). */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

/** A word list entry: `/regex/flags` or a plain word matched as a whole word, case-insensitively. */
export function compileWord(entry: string): RegExp | string {
  const re = /^\/(.+)\/([imsu]*)$/.exec(entry);
  if (!re) {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
  }
  if (re[1]!.length > 100) return "longer than 100 characters";
  if (NESTED_QUANTIFIER.test(re[1]!)) return "nested quantifiers are not allowed";
  try {
    return new RegExp(re[1]!, re[2]!.includes("u") ? re[2] : `${re[2]}u`);
  } catch (e) {
    return e instanceof Error ? e.message : "invalid";
  }
}

const compiled = new WeakMap<string[], RegExp[]>();
function wordRegexes(words: string[]): RegExp[] {
  let list = compiled.get(words);
  if (!list) {
    list = words.map(compileWord).filter((r): r is RegExp => r instanceof RegExp);
    compiled.set(words, list);
  }
  return list;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
export function links(text: string): URL[] {
  return [...text.matchAll(URL_RE)].flatMap(([u]) => {
    try {
      return [new URL(u.startsWith("http") ? u : `https://${u}`)];
    } catch {
      return [];
    }
  });
}
const allowed = (host: string, domains: string[]) => domains.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`));

/** Recent messages of one member (timestamps and normalized texts), kept by the caller per room and member. */
export class History {
  private items: { at: number; text: string }[] = [];
  push(m: Msg, keepMs: number): void {
    this.items = this.items.filter((x) => m.at - x.at <= keepMs).concat({ at: m.at, text: m.text.trim().toLowerCase() });
  }
  count(since: number): number {
    return this.items.filter((x) => x.at >= since).length;
  }
  same(text: string, since: number): number {
    const t = text.trim().toLowerCase();
    return this.items.filter((x) => x.at >= since && x.text === t).length;
  }
}

/** The first rule the message breaks (the history must already contain it). */
export function check(s: RuleSettings, m: Msg, h: History): Violation | null {
  if (s.wordsOn && s.words.length) {
    const hit = wordRegexes(s.words).find((r) => r.test(m.text));
    if (hit) return { rule: "words", action: s.wordsAction, reason: "a blocked word" };
  }
  if (s.linksOn || s.invitesOn) {
    for (const u of links(m.text)) {
      if (s.invitesOn && /\/invite\/[\w-]+/.test(u.pathname)) return { rule: "invites", action: s.linksAction, reason: "an invite link" };
      if (s.linksOn && !allowed(u.hostname, s.allowedDomains)) return { rule: "links", action: s.linksAction, reason: `a link to ${u.hostname}` };
    }
  }
  if (s.capsOn) {
    const letters = [...m.text].filter((c) => c.toLowerCase() !== c.toUpperCase());
    const upper = letters.filter((c) => c === c.toUpperCase()).length;
    if (letters.length >= s.capsMinLength && (upper * 100) / letters.length >= s.capsPercent) return { rule: "caps", action: s.capsAction, reason: "too many capital letters" };
  }
  if (s.mentionsOn && m.mentions > s.mentionsMax) return { rule: "mentions", action: s.mentionsAction, reason: `${m.mentions} mentions` };
  if (s.floodOn && h.count(m.at - s.floodSeconds * 1000) > s.floodCount) return { rule: "flood", action: s.floodAction, reason: "sending messages too fast" };
  if (s.dupOn && m.text.trim() && h.same(m.text, m.at - s.dupSeconds * 1000) >= s.dupCount) return { rule: "duplicates", action: s.dupAction, reason: "repeating the same message" };
  return null;
}
