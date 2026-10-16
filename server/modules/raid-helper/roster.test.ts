// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import wow from "./games/wow.json";
import { hasRoom, parseSizes, roster, signUp, specMenus, specOf, type Game, type Signup } from "./roster";

const game = wow as Game;
const caps = { max: 3, tank: 1, healer: 1, dps: 0 };
const s = (user: string, role: Signup["role"], status: Signup["status"] = "signed", at = 0): Signup => ({ user, status, class: "", spec: "", role, at });

describe("raid roster", () => {
  it("fills roles up to their caps and the raid size, then benches", () => {
    const list = [s("a", "tank")];
    expect(signUp(list, caps, "b", "Paladin", "Protection", "tank", 1).status).toBe("bench");
    expect(signUp(list, caps, "a", "Warrior", "Protection", "tank", 1).status).toBe("signed");
    expect(signUp(list, caps, "b", "Priest", "Holy", "healer", 1).status).toBe("signed");
    const full = [s("a", "tank"), s("b", "healer"), s("c", "dps")];
    expect(hasRoom(full, caps, "dps", "d")).toBe(false);
    expect(hasRoom(full, caps, "dps", "c")).toBe(true);
  });
  it("groups the roster by role and status in sign-up order", () => {
    const r = roster([s("x", "dps", "signed", 2), s("y", "dps", "signed", 1), s("z", "", "declined"), s("w", "tank", "bench")]);
    expect(r.dps.map((x) => x.user)).toEqual(["y", "x"]);
    expect(r.declined.map((x) => x.user)).toEqual(["z"]);
    expect(r.bench.map((x) => x.user)).toEqual(["w"]);
    expect(r.tank).toEqual([]);
  });
  it("offers every WoW spec in menus of at most 25 without splitting a class", () => {
    const menus = specMenus(game);
    expect(menus.flat()).toHaveLength(40);
    expect(menus.every((m) => m.length <= 25)).toBe(true);
    expect(menus[0]!.at(-1)!.label).toBe("Paladin – Retribution");
    expect(specOf(game, "7.0")).toEqual({ cls: "Paladin", spec: "Holy", role: "healer" });
    expect(specOf(game, "99.0")).toBeNull();
    expect(specOf(game, "1.0; drop table")).toBeNull();
  });
  it("parses sizes", () => {
    expect(parseSizes("2/4/14")).toEqual({ max: 20, tank: 2, healer: 4, dps: 14 });
    expect(parseSizes("25")).toEqual({ max: 25, tank: 0, healer: 0, dps: 0 });
    expect(parseSizes("a/b")).toBeNull();
  });
});
