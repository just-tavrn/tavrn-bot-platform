// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import automod from "./index";
import { History, check, compileWord, type Msg, type RuleSettings } from "./rules";

const base = { ...automod.defaults } as unknown as RuleSettings;
const msg = (text: string, extra: Partial<Msg> = {}): Msg => ({ text, mentions: 0, at: 1_000_000, ...extra });
const run = (s: Partial<RuleSettings>, m: Msg, h = new History()) => {
  h.push(m, 600_000);
  return check({ ...base, ...s }, m, h);
};

describe("automod rules", () => {
  it("blocks words as whole words and regular expressions", () => {
    const s = { wordsOn: true, words: ["spam", "/fr[e3]{2}\\s*gift/i"] };
    expect(run(s, msg("this is SPAM!"))?.rule).toBe("words");
    expect(run(s, msg("spammer"))).toBeNull();
    expect(run(s, msg("get a fr33 gift"))?.rule).toBe("words");
  });
  it("refuses dangerous or broken patterns", () => {
    expect(compileWord("/(a+)+$/")).toBe("nested quantifiers are not allowed");
    expect(typeof compileWord("/[/")).toBe("string");
  });
  it("filters links outside the allow-list and invite links", () => {
    const s = { linksOn: true, invitesOn: true, allowedDomains: ["example.org"] };
    expect(run(s, msg("see https://docs.example.org/a"))).toBeNull();
    expect(run(s, msg("see www.bad.test/x"))?.reason).toBe("a link to www.bad.test");
    expect(run({ ...s, linksOn: false }, msg("join https://chat.example.org/invite/Code_1"))?.rule).toBe("invites");
  });
  it("counts capitals, mentions, floods and duplicates", () => {
    expect(run({ capsOn: true }, msg("WHY IS EVERYTHING LOUD"))?.rule).toBe("caps");
    expect(run({ capsOn: true }, msg("OK FINE"))).toBeNull();
    expect(run({ mentionsOn: true, mentionsMax: 2 }, msg("hi", { mentions: 3 }))?.rule).toBe("mentions");
    const h = new History();
    const flood = { floodOn: true, floodCount: 3, floodSeconds: 5 };
    expect([1, 2, 3].map((i) => run(flood, msg(`m${i}`, { at: 1000 * i }), h))).toEqual([null, null, null]);
    expect(run(flood, msg("m4", { at: 4000 }), h)?.rule).toBe("flood");
    const d = new History();
    const dup = { dupOn: true, dupCount: 3, dupSeconds: 30 };
    run(dup, msg("buy now", { at: 1 }), d);
    expect(run(dup, msg("Buy now ", { at: 2 }), d)).toBeNull();
    expect(run(dup, msg("buy now", { at: 3 }), d)?.rule).toBe("duplicates");
  });
});
