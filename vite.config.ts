// SPDX-License-Identifier: Apache-2.0
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const api = `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  root: "web",
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { outDir: "../server/public", emptyOutDir: true, assetsDir: "assets" },
  server: { port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy: { "/api": api, "/healthz": api } },
});
