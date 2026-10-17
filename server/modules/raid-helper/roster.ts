// SPDX-License-Identifier: Apache-2.0
/** The raid helper's rules as pure functions: games, sign-ups against the caps, the roster and the card's menus. */

export type Role = "tank" | "healer" | "dps";
export const ROLES: Role[] = ["tank", "healer", "dps"];
export type Status = "signed" | "tentative" | "bench" | "declined";

export interface Game {
  key: string;
  name: string;
  classes: { name: string; specs: { name: string; role: Role }[] }[];
}
export interface Signup {
  user: string;
  status: Status;
  class: string;
  spec: string;
  role: Role | "";
  at: number;
}
/** 0 = no limit. */
export interface Caps {
  max: number;
  tank: number;
  healer: number;
  dps: number;
}

/** Can `user` take a place in `role` (the others' places counted, the user's own current one not)? */
export function hasRoom(signups: Signup[], caps: Caps, role: Role, user: string): boolean {
  const others = signups.filter((s) => s.status === "signed" && s.user !== user);
  if (caps.max && others.length >= caps.max) return false;
  return !caps[role] || others.filter((s) => s.role === role).length < caps[role];
}

/** A sign-up with a spec: a place in the spec's role, or the bench when that role or the raid is full. */
export function signUp(signups: Signup[], caps: Caps, user: string, cls: string, spec: string, role: Role, now: number): Signup {
  return { user, status: hasRoom(signups, caps, role, user) ? "signed" : "bench", class: cls, spec, role, at: now };
}

export function roster(signups: Signup[]): Record<Role | "bench" | "tentative" | "declined", Signup[]> {
  const by = (f: (s: Signup) => boolean) => signups.filter(f).sort((a, b) => a.at - b.at);
  return {
    tank: by((s) => s.status === "signed" && s.role === "tank"),
    healer: by((s) => s.status === "signed" && s.role === "healer"),
    dps: by((s) => s.status === "signed" && s.role === "dps"),
    bench: by((s) => s.status === "bench"),
    tentative: by((s) => s.status === "tentative"),
    declined: by((s) => s.status === "declined"),
  };
}

/** The class and spec of a menu value (`<class index>.<spec index>`), or null for anything else. */
export function specOf(game: Game, value: string): { cls: string; spec: string; role: Role } | null {
  const m = /^(\d{1,2})\.(\d{1,2})$/.exec(value);
  const c = m ? game.classes[Number(m[1])] : undefined;
  const s = c?.specs[Number(m![2])];
  return c && s ? { cls: c.name, spec: s.name, role: s.role } : null;
}

/** "2/4/14" → caps; a single number is the raid size. */
export function parseSizes(text: string): Caps | null {
  const t = text.trim();
  if (!t) return { max: 0, tank: 0, healer: 0, dps: 0 };
  const n = t.split(/[/,\s]+/).map(Number);
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 100)) return null;
  if (n.length === 1) return { max: n[0]!, tank: 0, healer: 0, dps: 0 };
  if (n.length !== 3) return null;
  return { max: n[0]! + n[1]! + n[2]!, tank: n[0]!, healer: n[1]!, dps: n[2]! };
}
