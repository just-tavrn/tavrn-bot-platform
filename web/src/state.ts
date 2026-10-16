// SPDX-License-Identifier: Apache-2.0
/** A tiny observable value with a hook (no state library): `useValue(s)` re-renders on change. */
import { useEffect, useRef, useState } from "preact/hooks";

export interface Signal<T> {
  value: T;
  subscribe(fn: () => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let v = initial;
  const subs = new Set<() => void>();
  return {
    get value() {
      return v;
    },
    set value(next: T) {
      v = next;
      subs.forEach((f) => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useValue<T>(s: Signal<T>): T {
  const [, force] = useState(0);
  // The subscription starts after the first paint: a change in between (the session answer of a fast node after a
  // reload) would be missed and the view would stay on its loading state, so the value is compared once more.
  const seen = useRef(s.value);
  useEffect(() => {
    const off = s.subscribe(() => force((n) => n + 1));
    if (s.value !== seen.current) force((n) => n + 1);
    return off;
  }, [s]);
  seen.current = s.value;
  return s.value;
}

/** The current path; `navigate` changes it without a reload. */
export const path = signal(typeof location !== "undefined" ? location.pathname + location.search : "/");
export function navigate(to: string) {
  history.pushState(null, "", to);
  path.value = to;
  window.scrollTo(0, 0);
}
if (typeof window !== "undefined") window.addEventListener("popstate", () => (path.value = location.pathname + location.search));
