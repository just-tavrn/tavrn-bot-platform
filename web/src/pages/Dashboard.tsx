// SPDX-License-Identifier: Apache-2.0
/** The user's rooms and "connect a room": the add link and a one-time /connect code. */
import { useEffect, useState } from "preact/hooks";
import { api, config } from "../api";
import { Link } from "../app";
import { t } from "../i18n";
import { useValue } from "../state";

interface Room {
  id: number;
  name: string;
  ref: string;
  installed: boolean;
  disabled: boolean;
}

export function Dashboard() {
  const cfg = useValue(config);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [code, setCode] = useState<{ code: string; addLink: string | null } | null>(null);
  const load = () => api<Room[]>("GET", "/rooms").then(setRooms);
  useEffect(() => void load(), []);
  // While a code is shown, look for the new room every few seconds.
  useEffect(() => {
    if (!code) return;
    const known = rooms?.length ?? 0;
    const timer = setInterval(async () => {
      const list = await api<Room[]>("GET", "/rooms");
      if (list.length > known) {
        setRooms(list);
        setCode(null);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [code]);

  return (
    <div class="space-y-6">
      {cfg && !cfg.bot.online && <p class="rounded-md border border-warn p-3 text-sm text-warn">{t("botOffline")}</p>}
      <section class="card">
        <h1 class="mb-3 text-xl font-semibold">{t("myRooms")}</h1>
        {rooms && !rooms.length && <p class="text-sm text-fg-2">{t("noRooms")}</p>}
        <ul class="divide-y divide-line">
          {rooms?.map((r) => (
            <li key={r.id} class="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/rooms/${r.id}`}>{r.name || r.ref}</Link>
              <span class="text-xs text-fg-2">{r.disabled ? t("disabledRoom") : !r.installed ? t("notInstalled") : r.ref.split("/")[0]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section class="card space-y-3">
        <h2 class="text-lg font-semibold">{t("connectRoom")}</h2>
        {code ? (
          <>
            <p class="text-sm text-fg-1">{t("connectSteps")}</p>
            <p>
              <code class="rounded bg-bg-3 px-3 py-2 font-mono text-lg" data-testid="connect-command">
                /connect {code.code}
              </code>
            </p>
            {code.addLink && (
              <a class="btn btn-primary" href={code.addLink} target="_blank" rel="noopener">
                {t("addToRoom")}
              </a>
            )}
            <p role="status" class="text-sm text-fg-2">
              {t("connectWaiting")}
            </p>
          </>
        ) : (
          <button type="button" class="btn btn-primary" onClick={() => api("POST", "/rooms/connect-code").then(setCode)}>
            {t("connectRoom")}
          </button>
        )}
      </section>
    </div>
  );
}
