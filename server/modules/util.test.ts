// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { fill, formatTime, list, utcToWall, wallToUtc } from "./util";

describe("templates", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(fill("Hi {user}, welcome to {room} ({count}) {nope}", { user: "@a", room: "R", count: 3 })).toBe("Hi @a, welcome to R (3) {nope}");
  });
  it("splits option lists", () => expect(list("a; b\n c ;;")).toEqual(["a", "b", "c"]));
});

describe("time zones", () => {
  it("converts wall time in a zone to UTC and back", () => {
    const t = wallToUtc("2026-07-01T20:00", "Europe/Berlin");
    expect(new Date(t).toISOString()).toBe("2026-07-01T18:00:00.000Z");
    expect(utcToWall(t, "Europe/Berlin")).toBe("2026-07-01T20:00");
    expect(new Date(wallToUtc("2026-12-01T20:00", "Europe/Berlin")).toISOString()).toBe("2026-12-01T19:00:00.000Z");
    expect(new Date(wallToUtc("2026-12-01T20:00", "UTC")).toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });
  it("formats with the zone name", () => {
    expect(formatTime(Date.parse("2026-07-01T18:00:00Z"), "Europe/Berlin")).toContain("20:00 (Europe/Berlin)");
  });
});
