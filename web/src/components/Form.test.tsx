// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it } from "vitest";
import type { Field } from "../../../server/fields";
import { STRINGS } from "../i18n";
import { Form } from "./Form";

const room = { channels: [{ id: "C1", name: "general" }], roles: [{ id: "R1", name: "Raider" }, { id: "R2", name: "Mod" }] };
const fields: Field[] = [
  { key: "enabled", type: "boolean", label: "Enabled" },
  { key: "channel", type: "channel", label: "Channel", help: "Where to post." },
  { key: "roles", type: "roles", label: "Roles" },
  { key: "words", type: "strings", label: "Words", section: "Filters" },
  { key: "cmds", type: "items", label: "Commands", itemLabel: "name", fields: [{ key: "name", type: "string", label: "Name" }, { key: "eph", type: "boolean", label: "Private" }] },
];

let last: Record<string, unknown> = {};
function Harness({ initial }: { initial: Record<string, unknown> }) {
  const [v, setV] = useState(initial);
  last = v;
  return <Form fields={fields} value={v} onChange={setV} room={room} />;
}
afterEach(cleanup);

describe("generic form", () => {
  it("renders every field type with labels, help and sections", () => {
    render(<Harness initial={{ enabled: false, channel: "", roles: [], words: [], cmds: [] }} />);
    expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Channel" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("option", { name: "#general" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Filters" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Roles" })).toBeTruthy();
  });

  it("edits values, lists and items", () => {
    render(<Harness initial={{ enabled: false, channel: "", roles: [], words: [], cmds: [] }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Channel" }), { target: { value: "C1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mod" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Words" }), { target: { value: "spam\n\n eggs " } });
    fireEvent.click(screen.getByRole("button", { name: /Add: Commands/ }));
    fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "rules" } });
    expect(last).toEqual({ enabled: true, channel: "C1", roles: ["R2"], words: ["spam", "eggs"], cmds: [{ name: "rules", eph: false }] });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(last.cmds).toEqual([]);
  });
});

describe("text and date fields", () => {
  it("renders a string as a text input with its length limit and a datetime as a native date-time picker", () => {
    const own: Field[] = [
      { key: "title", type: "string", label: "Title", max: 40 },
      { key: "start", type: "datetime", label: "Start", required: true },
    ];
    const { container } = render(<Form fields={own} value={{ title: "Raid", start: "2026-11-11T20:00" }} onChange={() => {}} room={room} />);
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(title.getAttribute("type")).toBe("text");
    expect(title.getAttribute("maxlength")).toBe("40");
    const start = container.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    expect(start?.value).toBe("2026-11-11T20:00");
    expect(start?.required).toBe(true);
    expect(start?.hasAttribute("maxlength")).toBe(false);
  });
});

describe("UI strings", () => {
  it("has every key in English and German", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
    expect(Object.values(STRINGS.de).every((s) => s.length > 0)).toBe(true);
  });
});
