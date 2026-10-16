// SPDX-License-Identifier: Apache-2.0
/** The leaderboard of a room: inside the dashboard and as the public page (when the room allows it). */
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Link } from "../app";
import { t } from "../i18n";

interface Board {
  room?: { name: string };
  page: number;
  pages: number;
  entries: { rank: number; address: string; level: number; xp: number }[];
}

export function Board({ path, publicId }: { path: string; publicId?: string }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState("");
  useEffect(() => void api<Board>("GET", `${path}?page=${page}`).then(setData, (e: Error) => setError(e.message)), [path, page]);
  if (error) return <p role="alert" class="text-danger">{error}</p>;
  if (!data) return <p class="text-fg-2">…</p>;
  return (
    <section class="card">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">
          {t("leaderboard")}
          {data.room ? ` · ${data.room.name}` : ""}
        </h2>
        {publicId && !data.room && <Link href={`/leaderboard/${publicId}`}>{t("publicLink")}</Link>}
      </div>
      {!data.entries.length ? (
        <p class="text-sm text-fg-2">{t("nothing")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-fg-2">
              <tr>
                <th class="px-2 py-2">{t("rank")}</th>
                <th class="px-2 py-2">{t("member")}</th>
                <th class="px-2 py-2">{t("level")}</th>
                <th class="px-2 py-2">{t("xp")}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.address} class="border-t border-line">
                  <td class="px-2 py-2">{e.rank}</td>
                  <td class="px-2 py-2 break-all">{e.address}</td>
                  <td class="px-2 py-2">{e.level}</td>
                  <td class="px-2 py-2">{e.xp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.pages > 1 && (
        <div class="mt-3 flex items-center gap-2">
          <button type="button" class="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("previous")}
          </button>
          <span class="text-sm text-fg-2">
            {data.page + 1} / {data.pages}
          </span>
          <button type="button" class="btn" disabled={page >= data.pages - 1} onClick={() => setPage(page + 1)}>
            {t("next")}
          </button>
        </div>
      )}
    </section>
  );
}

export const PublicLeaderboard = ({ id }: { id: string }) => <Board path={`/public/leaderboard/${encodeURIComponent(id)}`} />;
