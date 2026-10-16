// SPDX-License-Identifier: Apache-2.0
/**
 * A module's list (raid events, games, cases): a table, and the generic form for a new or edited entry. A collection
 * without a list (`form`) is only a form that runs an action (kick a member) and shows the server's answer.
 */
import { useEffect, useState } from "preact/hooks";
import { emptyObject, type Field } from "../../../server/fields";
import { api } from "../api";
import { t } from "../i18n";
import { Form, type RoomChoices } from "./Form";

export interface CollectionMeta {
  key: string;
  title: string;
  fields: Field[];
  columns: string[];
  readonly: boolean;
  noEdit?: boolean;
  form?: boolean;
}
type Item = Record<string, unknown> & { id: string | number };

export function Collection({ base, meta, room }: { base: string; meta: CollectionMeta; room: RoomChoices }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(meta.form ? emptyObject(meta.fields) : null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const url = `${base}/${meta.key}`;
  const load = () => (meta.form ? Promise.resolve() : api<Item[]>("GET", url).then(setItems, (e: Error) => setError(e.message)));
  useEffect(() => void load(), [url]);

  const save = async (e: Event) => {
    e.preventDefault();
    setError("");
    setDone("");
    try {
      const { id, ...body } = editing as Item;
      const r = await api<{ message?: string }>(id ? "PUT" : "POST", id ? `${url}/${id}` : url, body);
      setEditing(meta.form ? emptyObject(meta.fields) : null);
      if (r.message) setDone(r.message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (id: Item["id"]) => {
    if (!confirm(t("confirmDelete"))) return;
    await api("DELETE", `${url}/${id}`).catch((err: Error) => setError(err.message));
    await load();
  };

  return (
    <section class="card" aria-labelledby={`col-${meta.key}`}>
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 id={`col-${meta.key}`} class="text-lg font-semibold">
          {meta.title}
        </h2>
        {!meta.readonly && !meta.form && !editing && (
          <button type="button" class="btn btn-primary" onClick={() => setEditing(emptyObject(meta.fields))}>
            + {t("new")}
          </button>
        )}
      </div>
      {error && <p role="alert" class="mb-3 text-sm text-danger">{error}</p>}
      {done && <p role="status" class="mb-3 text-sm text-ok">{done}</p>}
      {editing ? (
        <form onSubmit={save} class="space-y-4">
          <Form fields={meta.fields} value={editing} onChange={setEditing} room={room} />
          <div class="flex gap-2">
            <button class="btn btn-primary">{t(meta.form ? "apply" : "save")}</button>
            {!meta.form && (
              <button type="button" class="btn" onClick={() => setEditing(null)}>
                {t("cancel")}
              </button>
            )}
          </div>
        </form>
      ) : !items?.length ? (
        <p class="text-sm text-fg-2">{t("nothing")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-fg-2">
              <tr>
                {meta.columns.map((c) => (
                  <th key={c} class="px-2 py-2 font-medium capitalize">
                    {c}
                  </th>
                ))}
                {!meta.readonly && <th class="sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} class="border-t border-line">
                  {meta.columns.map((c) => (
                    <td key={c} class="px-2 py-2">
                      {String(item[c] ?? "")}
                    </td>
                  ))}
                  {!meta.readonly && (
                    <td class="flex gap-2 px-2 py-1">
                      {!meta.noEdit && (
                        <button type="button" class="btn" onClick={() => setEditing(item)} aria-label={`${t("edit")}: ${String(item[meta.columns[1] ?? meta.columns[0]!] ?? item.id)}`}>
                          {t("edit")}
                        </button>
                      )}
                      <button type="button" class="btn" onClick={() => remove(item.id)} aria-label={`${t("delete")}: ${String(item[meta.columns[1] ?? meta.columns[0]!] ?? item.id)}`}>
                        {t("delete")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
