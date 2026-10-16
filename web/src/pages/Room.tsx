// SPDX-License-Identifier: Apache-2.0
/** A connected room: overview with the module switches, one page per module, the leaderboard. */
import { useEffect, useState } from "preact/hooks";
import type { Field } from "../../../server/fields";
import { api, config } from "../api";
import { Link } from "../app";
import { Collection, type CollectionMeta } from "../components/Collection";
import { Form, type RoomChoices } from "../components/Form";
import { t } from "../i18n";
import { navigate } from "../state";
import { Board } from "./Leaderboard";

interface Module {
  id: string;
  title: string;
  description: string;
  schema: Field[];
  settings: Record<string, unknown> & { enabled: boolean };
  collections: CollectionMeta[];
}
interface RoomData extends RoomChoices {
  room: { id: number; name: string; ref: string; timezone: string; installed: boolean; disabled: boolean };
  online: boolean;
  modules: Module[];
}

export function RoomPage({ id, tab }: { id: string; tab: string }) {
  const [data, setData] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
  const load = () => api<RoomData>("GET", `/rooms/${id}`).then(setData, (e: Error) => setError(e.message));
  useEffect(() => void load(), [id]);
  if (error) return <p role="alert" class="text-danger">{error}</p>;
  if (!data) return <p class="text-fg-2">…</p>;
  const mod = data.modules.find((m) => m.id === tab);
  const tabs = [{ id: "", title: t("overview") }, ...data.modules.map((m) => ({ id: m.id, title: m.title, on: m.settings.enabled })), { id: "leaderboard", title: t("leaderboard") }];
  return (
    <div class="grid gap-6 md:grid-cols-[14rem_1fr]">
      <nav aria-label={t("modules")} class="md:sticky md:top-4 md:self-start">
        <h1 class="mb-3 text-lg font-semibold break-words">{data.room.name || data.room.ref}</h1>
        <ul class="flex flex-wrap gap-1 md:flex-col">
          {tabs.map((x) => (
            <li key={x.id}>
              <Link href={`/rooms/${id}${x.id ? `/${x.id}` : ""}`} class={`flex min-h-10 items-center justify-between gap-2 rounded-md px-3 text-sm ${x.id === tab ? "bg-accent-soft text-fg-0" : "text-fg-1 hover:bg-bg-3"}`}>
                <span aria-current={x.id === tab ? "page" : undefined}>{x.title}</span>
                {"on" in x && <span class={`text-xs ${x.on ? "text-ok" : "text-fg-2"}`}>{x.on ? t("on") : t("off")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div class="min-w-0 space-y-4">
        {!data.online && <p class="rounded-md border border-warn p-3 text-sm text-warn">{t("botOffline")}</p>}
        {data.room.disabled && <p class="rounded-md border border-danger p-3 text-sm text-danger">{t("disabledRoom")}</p>}
        {!data.room.installed && (
          <p class="rounded-md border border-warn p-3 text-sm text-warn">
            {t("notInstalled")} {config.value?.addLink && <a class="link" href={config.value.addLink}>{t("addToRoom")}</a>}
          </p>
        )}
        {tab === "leaderboard" ? <Board path={`/rooms/${id}/leaderboard`} publicId={id} /> : mod ? <ModulePage key={mod.id} roomId={id} mod={mod} data={data} /> : <Overview data={data} reload={load} />}
      </div>
    </div>
  );
}

function Overview({ data, reload }: { data: RoomData; reload: () => void }) {
  const [tz, setTz] = useState(data.room.timezone);
  const [msg, setMsg] = useState("");
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const toggle = async (m: Module) => {
    await api("PUT", `/rooms/${data.room.id}/modules/${m.id}`, { ...m.settings, enabled: !m.settings.enabled }).catch((e: Error) => setMsg(e.message));
    reload();
  };
  const leave = async () => {
    await api("DELETE", `/rooms/${data.room.id}/manager`);
    navigate("/dashboard");
  };
  return (
    <>
      <section class="card">
        <h2 class="mb-3 text-lg font-semibold">{t("modules")}</h2>
        <ul class="grid gap-3 sm:grid-cols-2">
          {data.modules.map((m) => (
            <li key={m.id} class="rounded-md border border-line bg-bg-1 p-3">
              <div class="flex items-start justify-between gap-3">
                <Link href={`/rooms/${data.room.id}/${m.id}`} class="font-medium text-fg-0 hover:underline">
                  {m.title}
                </Link>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" role="switch" class="size-5 accent-accent" checked={m.settings.enabled} onChange={() => toggle(m)} aria-label={`${m.title}: ${m.settings.enabled ? t("on") : t("off")}`} />
                  <span aria-hidden="true">{m.settings.enabled ? t("on") : t("off")}</span>
                </label>
              </div>
              <p class="mt-1 text-sm text-fg-2">{m.description}</p>
            </li>
          ))}
        </ul>
        {msg && <p role="alert" class="mt-2 text-sm text-danger">{msg}</p>}
      </section>
      <section class="card space-y-3">
        <form
          class="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("PUT", `/rooms/${data.room.id}`, { timezone: tz }).then(() => setMsg(t("saved")), (err: Error) => setMsg(err.message));
          }}
        >
          <div class="min-w-64 flex-1">
            <label for="tz" class="mb-1 block text-sm font-medium text-fg-1">
              {t("timezone")}
            </label>
            <input id="tz" class="input" list="zones" value={tz} onInput={(e) => setTz(e.currentTarget.value)} />
            <datalist id="zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          <button class="btn">{t("save")}</button>
        </form>
        <p class="text-xs text-fg-2">{data.room.ref}</p>
        <button type="button" class="btn" onClick={leave}>
          {t("leaveRoom")}
        </button>
      </section>
    </>
  );
}

function ModulePage({ roomId, mod, data }: { roomId: string; mod: Module; data: RoomData }) {
  const [value, setValue] = useState(mod.settings);
  const [notes, setNotes] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const save = async (e: Event) => {
    e.preventDefault();
    try {
      const r = await api<{ settings: Module["settings"]; warnings: string[] }>("PUT", `/rooms/${roomId}/modules/${mod.id}`, value);
      setValue(r.settings);
      mod.settings = r.settings;
      setNotes({ ok: true, lines: r.warnings.length ? [t("warnings"), ...r.warnings] : [t("saved")] });
    } catch (err) {
      setNotes({ ok: false, lines: [(err as Error).message] });
    }
  };
  return (
    <>
      <section class="card">
        <h2 class="text-lg font-semibold">{mod.title}</h2>
        <p class="mb-4 text-sm text-fg-2">{mod.description}</p>
        <form onSubmit={save} class="space-y-4">
          <Form fields={mod.schema} value={value} onChange={(v) => setValue(v as Module["settings"])} room={data} />
          <div class="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-bg-2 px-4 py-3">
            <button class="btn btn-primary">{t("save")}</button>
            {notes && (
              <div role={notes.ok ? "status" : "alert"} class={`text-sm ${notes.ok && notes.lines.length === 1 ? "text-ok" : notes.ok ? "text-warn" : "text-danger"}`}>
                {notes.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            )}
          </div>
        </form>
      </section>
      {mod.collections.map((c) => (
        <Collection key={c.key} base={`/rooms/${roomId}/modules/${mod.id}`} meta={c} room={data} />
      ))}
    </>
  );
}
