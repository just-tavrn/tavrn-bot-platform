// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Collection } from "./Collection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("collection as a form", () => {
  it("runs the action without a list and shows the server's answer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 0, message: "Done: kick a@b (case #1)." }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const meta = { key: "kick", title: "Kick a member", fields: [{ key: "member", type: "string" as const, label: "Member" }], columns: [], readonly: false, form: true };
    render(<Collection base="/rooms/1/modules/moderation" meta={meta} room={{ channels: [], roles: [] }} />);
    expect(screen.queryByRole("button", { name: /New/ })).toBeNull();
    fireEvent.input(screen.getByRole("textbox", { name: "Member" }), { target: { value: "a@b" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply|Ausführen/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Done: kick a@b (case #1)."));
    expect(fetch.mock.calls.map((c) => [(c as unknown[])[0], ((c as unknown[])[1] as RequestInit).method])).toEqual([["/api/rooms/1/modules/moderation/kick", "POST"]]);
    expect((screen.getByRole("textbox", { name: "Member" }) as HTMLInputElement).value).toBe("");
  });
});
