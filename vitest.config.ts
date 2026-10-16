// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    include: ["server/**/*.test.ts", "web/src/**/*.test.tsx"],
    environment: "node",
    maxWorkers: 2,
  },
});
