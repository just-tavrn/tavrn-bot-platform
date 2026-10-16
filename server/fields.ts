// SPDX-License-Identifier: Apache-2.0
/** The field types of the settings schema, shared by the server's validator and the web UI's generic form. */

export type FieldType = "boolean" | "number" | "string" | "text" | "select" | "channel" | "channels" | "role" | "roles" | "strings" | "datetime" | "items";

export interface Field {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  /** A heading shown above this field (groups long forms). */
  section?: string;
  /** number: range; string/text: maximum length; strings/channels/roles/items: maximum count. */
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** items: the fields of one item and the key shown as its title in the list. */
  fields?: Field[];
  itemLabel?: string;
  /** Optional strings may be empty; required ones not. */
  required?: boolean;
}

/** The empty value of a field (new items, missing keys). */
export function emptyValue(f: Field): unknown {
  switch (f.type) {
    case "boolean":
      return false;
    case "number":
      return f.min ?? 0;
    case "select":
      return f.options?.[0]?.value ?? "";
    case "channels":
    case "roles":
    case "strings":
    case "items":
      return [];
    default:
      return "";
  }
}

/** A new object with the empty value of every field. */
export const emptyObject = (fields: Field[]): Record<string, unknown> => Object.fromEntries(fields.map((f) => [f.key, emptyValue(f)]));
