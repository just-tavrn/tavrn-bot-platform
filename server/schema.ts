// SPDX-License-Identifier: Apache-2.0
/**
 * The settings schema of the modules: a list of fields from which the web UI renders a form and the server checks
 * what comes back. Adding a module needs no UI code. `items` is a list of objects with fields of its own (custom
 * commands, feeds, role menus); every item gets a stable `id`.
 */
import { randomBytes } from "node:crypto";

export type FieldType = "boolean" | "number" | "string" | "text" | "select" | "channel" | "role" | "roles" | "strings" | "datetime" | "items";

export interface Field {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  /** A heading shown above this field (groups long forms). */
  section?: string;
  /** number: range; string/text: maximum length; strings/roles/items: maximum count. */
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** items: the fields of one item and the key shown as its title in the list. */
  fields?: Field[];
  itemLabel?: string;
  /** Optional strings may be empty; required ones not. */
  required?: boolean;
}

/** What the room offers for channel and role fields (null: not known, only the id format is checked). */
export interface RoomChoices {
  channels: Set<string> | null;
  roles: Set<string> | null;
}

export class ValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

const ID = /^[0-9A-Za-z_-]{1,64}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DEFAULT_TEXT_MAX: Record<string, number> = { string: 200, text: 2000 };

/** The empty value of a field (new items, missing keys). */
export function emptyValue(f: Field): unknown {
  switch (f.type) {
    case "boolean":
      return false;
    case "number":
      return f.min ?? 0;
    case "select":
      return f.options?.[0]?.value ?? "";
    case "roles":
    case "strings":
    case "items":
      return [];
    default:
      return "";
  }
}

/** Checks and normalizes `input` against `fields`; unknown keys are dropped, missing ones take `defaults`. */
export function clean(fields: Field[], input: unknown, defaults: Record<string, unknown>, room: RoomChoices, path = ""): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError(path || "settings", "must be an object");
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const p = path ? `${path}.${f.key}` : f.key;
    const v = f.key in src ? src[f.key] : (defaults[f.key] ?? emptyValue(f));
    out[f.key] = value(f, v, room, p);
  }
  return out;
}

function value(f: Field, v: unknown, room: RoomChoices, p: string): unknown {
  const fail = (m: string): never => {
    throw new ValidationError(p, m);
  };
  switch (f.type) {
    case "boolean":
      return typeof v === "boolean" ? v : fail("must be true or false");
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return fail("must be a number");
      if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) fail(`must be between ${f.min ?? "-∞"} and ${f.max ?? "∞"}`);
      return v;
    }
    case "string":
    case "text": {
      if (typeof v !== "string") return fail("must be text");
      const s = f.type === "string" ? v.trim() : v.replace(/\r\n/g, "\n");
      if (s.length > (f.max ?? DEFAULT_TEXT_MAX[f.type]!)) fail(`at most ${f.max ?? DEFAULT_TEXT_MAX[f.type]} characters`);
      if (f.required && !s.trim()) fail("is required");
      // No control characters besides line breaks and tabs in multi-line text.
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) fail("contains control characters");
      return s;
    }
    case "select":
      return typeof v === "string" && f.options?.some((o) => o.value === v) ? v : fail("is not one of the choices");
    case "datetime":
      if (v === "" && !f.required) return "";
      return typeof v === "string" && DATETIME.test(v) && !Number.isNaN(Date.parse(`${v}:00Z`)) ? v : fail("must be a date and time");
    case "channel":
    case "role": {
      if (v === "" && !f.required) return "";
      if (typeof v !== "string" || !ID.test(v)) return fail("is not an id");
      const known = f.type === "channel" ? room.channels : room.roles;
      if (known && !known.has(v)) fail(`is not a ${f.type} of this room`);
      return v;
    }
    case "roles":
    case "strings": {
      if (!Array.isArray(v)) return fail("must be a list");
      if (v.length > (f.max ?? 50)) fail(`at most ${f.max ?? 50} entries`);
      const item: Field = f.type === "roles" ? { key: "", type: "role", label: "", required: true } : { key: "", type: "string", label: "", max: 200, required: true };
      return [...new Set(v.map((x, i) => value(item, x, room, `${p}[${i}]`) as string))];
    }
    case "items": {
      if (!Array.isArray(v)) return fail("must be a list");
      if (v.length > (f.max ?? 25)) fail(`at most ${f.max ?? 25} entries`);
      const ids = new Set<string>();
      return v.map((x, i) => {
        const obj = clean(f.fields ?? [], x, {}, room, `${p}[${i}]`);
        const given = (x as Record<string, unknown>).id;
        let id = typeof given === "string" && ID.test(given) && !ids.has(given) ? given : randomBytes(6).toString("base64url");
        while (ids.has(id)) id = randomBytes(6).toString("base64url");
        ids.add(id);
        return { id, ...obj };
      });
    }
  }
}
