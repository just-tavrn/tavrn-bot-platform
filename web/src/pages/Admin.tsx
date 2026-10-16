// SPDX-License-Identifier: Apache-2.0
/** The operator page (ADMIN_EMAILS): the bot's status, users and rooms; a room can be disabled. */
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";

interface Overview {
  bot: { online: boolean; address: string | null; error: string | null };
  uptime: number;
  memoryMb: number;
  users: { id: number; email: string; verified: number; created_at: number; rooms: number }[];
  rooms: { id: number; ref: string; name: string; installed: number; disabled: number; managers: number }[];
}

export function Admin() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const load = () => api<Overview>("GET", "/admin").then(setData, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (error) return <p role="alert" class="text-danger">{error}</p>;
  if (!data) return <p class="text-fg-2">…</p>;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return (
    <div class="space-y-6">
      <section class="card">
        <h1 class="mb-2 text-xl font-semibold">{t("botStatus")}</h1>
        <p class="text-sm">
          <span class={data.bot.online ? "text-ok" : "text-danger"}>{data.bot.online ? t("online") : t("offline")}</span> · {data.bot.address ?? "–"} · {Math.round(data.uptime / 60)} min · {data.memoryMb} MB
        </p>
        {data.bot.error && <p class="mt-1 text-sm text-warn">{data.bot.error}</p>}
      </section>
      <section class="card overflow-x-auto">
        <h2 class="mb-2 text-lg font-semibold">{t("rooms")} ({data.rooms.length})</h2>
        <table class="w-full text-left text-sm">
          <tbody>
            {data.rooms.map((r) => (
              <tr key={r.id} class="border-t border-line">
                <td class="px-2 py-2">{r.name || "–"}</td>
                <td class="px-2 py-2 break-all text-fg-2">{r.ref}</td>
                <td class="px-2 py-2">{r.managers}</td>
                <td class="px-2 py-2">{r.installed ? "" : t("notInstalled")}</td>
                <td class="px-2 py-1">
                  <button type="button" class={`btn ${r.disabled ? "" : "btn-danger"}`} onClick={() => api("PUT", `/admin/rooms/${r.id}`, { disabled: !r.disabled }).then(load)} aria-label={`${r.disabled ? t("enable") : t("disable")}: ${r.name || r.ref}`}>
                    {r.disabled ? t("enable") : t("disable")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section class="card overflow-x-auto">
        <h2 class="mb-2 text-lg font-semibold">{t("users")} ({data.users.length})</h2>
        <table class="w-full text-left text-sm">
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} class="border-t border-line">
                <td class="px-2 py-2 break-all">{u.email}</td>
                <td class="px-2 py-2">{u.verified ? "✓" : "…"}</td>
                <td class="px-2 py-2">{u.rooms}</td>
                <td class="px-2 py-2 text-fg-2">{day(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
