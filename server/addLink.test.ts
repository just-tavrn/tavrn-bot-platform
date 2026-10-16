// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { addLinkOf } from "./platform";

describe("addLinkOf", () => {
  it("puts the add link on the web client's origin, not on the bare domain", () => {
    expect(addLinkOf("https://app.tavrn.org", "01APP")).toBe("https://app.tavrn.org/add/01APP");
    expect(addLinkOf("https://app.tavrn.org/", "01APP")).toBe("https://app.tavrn.org/add/01APP");
    expect(addLinkOf("https://tavrn.org", "01APP")).toBe("https://tavrn.org/add/01APP");
  });
});
