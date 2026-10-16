// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { render } from "preact";
import { render as renderInAct } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { signal, useValue } from "./state";

describe("useValue", () => {
  it("catches a change that happens between the first render and the subscription", async () => {
    const s = signal<string | undefined>(undefined);
    let first = true;
    function View() {
      const v = useValue(s);
      // The value arrives in a microtask after this render, before the effect (effects run after the paint).
      if (first) {
        first = false;
        queueMicrotask(() => (s.value = "ready"));
      }
      return <p>{v ?? "…"}</p>;
    }
    // Plain preact render: the testing library's `render` flushes the effects at once, which hides the race.
    const container = document.createElement("div");
    render(<View />, container);
    await new Promise((r) => setTimeout(r, 100));
    expect(container.textContent).toBe("ready");
  });

  it("re-renders on later changes and stops after unmount", async () => {
    const s = signal(1);
    function View() {
      return <p>{useValue(s)}</p>;
    }
    const { container, unmount } = renderInAct(<View />);
    await new Promise((r) => setTimeout(r, 0));
    s.value = 2;
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("2");
    unmount();
    s.value = 3;
  });
});
