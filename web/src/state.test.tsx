// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { signal, useValue } from "./state";

describe("useValue", () => {
  it("catches a change that happens between the first render and the subscription", async () => {
    const s = signal<string | undefined>(undefined);
    function View() {
      const v = useValue(s);
      return <p>{v ?? "…"}</p>;
    }
    const { container } = render(<View />);
    // The value arrives before the effect subscribed (effects run after the paint).
    s.value = "ready";
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("ready");
  });

  it("re-renders on later changes and stops after unmount", async () => {
    const s = signal(1);
    function View() {
      return <p>{useValue(s)}</p>;
    }
    const { container, unmount } = render(<View />);
    await new Promise((r) => setTimeout(r, 0));
    s.value = 2;
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("2");
    unmount();
    s.value = 3;
  });
});
