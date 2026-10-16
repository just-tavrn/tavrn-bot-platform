// SPDX-License-Identifier: Apache-2.0
/**
 * The generic settings form: renders a module's schema (server/fields.ts) and edits a plain object. Lists of items
 * (custom commands, feeds, role menus) are nested forms. Adding a module needs no code here.
 */
import { useId } from "preact/hooks";
import { emptyObject, type Field } from "../../../server/fields";
import { t } from "../i18n";

export interface RoomChoices {
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}
type Obj = Record<string, unknown>;

export function Form({ fields, value, onChange, room }: { fields: Field[]; value: Obj; onChange: (v: Obj) => void; room: RoomChoices }) {
  return (
    <div class="space-y-4">
      {fields.map((f) => (
        <div key={f.key}>
          {f.section && <h3 class="mb-3 mt-6 border-t border-line pt-4 text-base font-semibold">{f.section}</h3>}
          <FieldInput field={f} value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} room={room} />
        </div>
      ))}
    </div>
  );
}

function FieldInput({ field: f, value, onChange, room }: { field: Field; value: unknown; onChange: (v: unknown) => void; room: RoomChoices }) {
  const id = useId();
  const help = f.help ? <p id={`${id}-help`} class="mt-1 text-xs text-fg-2">{f.help}</p> : null;
  const described = f.help ? `${id}-help` : undefined;
  const label = (
    <label for={id} class="mb-1 block text-sm font-medium text-fg-1">
      {f.label}
      {f.required && <span aria-hidden="true"> *</span>}
    </label>
  );
  const common = { id, "aria-describedby": described, required: f.required };
  switch (f.type) {
    case "boolean":
      return (
        <div>
          <label class="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" class="size-5 accent-accent" checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} aria-describedby={described} />
            {f.label}
          </label>
          {help}
        </div>
      );
    case "number":
      return (
        <div>
          {label}
          <input {...common} type="number" class="input max-w-40" min={f.min} max={f.max} value={String(value ?? "")} onInput={(e) => onChange(Number(e.currentTarget.value))} />
          {help}
        </div>
      );
    case "string":
    case "datetime":
      return (
        <div>
          {label}
          <input {...common} type={f.type === "datetime" ? "datetime-local" : "text"} class="input" maxLength={f.max} value={String(value ?? "")} onInput={(e) => onChange(e.currentTarget.value)} />
          {help}
        </div>
      );
    case "text":
    case "strings":
      return (
        <div>
          {label}
          <textarea
            {...common}
            class="input min-h-24"
            maxLength={f.type === "text" ? f.max : undefined}
            value={f.type === "strings" ? ((value as string[]) ?? []).join("\n") : String(value ?? "")}
            onInput={(e) => onChange(f.type === "strings" ? e.currentTarget.value.split("\n").map((s) => s.trim()).filter(Boolean) : e.currentTarget.value)}
          />
          {f.type === "strings" && <p class="mt-1 text-xs text-fg-2">One entry per line.</p>}
          {help}
        </div>
      );
    case "select":
    case "channel":
    case "role": {
      const options = f.type === "select" ? (f.options ?? []) : (f.type === "channel" ? room.channels : room.roles).map((o) => ({ value: o.id, label: f.type === "channel" ? `#${o.name}` : o.name }));
      return (
        <div>
          {label}
          <select {...common} class="input max-w-md" value={String(value ?? "")} onChange={(e) => onChange(e.currentTarget.value)}>
            {f.type !== "select" && <option value="">{t("none")}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {help}
        </div>
      );
    }
    case "channels":
    case "roles": {
      const list = f.type === "channels" ? room.channels.map((c) => ({ id: c.id, name: `#${c.name}` })) : room.roles;
      const chosen = new Set((value as string[]) ?? []);
      return (
        <fieldset aria-describedby={described}>
          <legend class="mb-1 text-sm font-medium text-fg-1">{f.label}</legend>
          <div class="flex flex-wrap gap-x-4">
            {list.map((o) => (
              <label key={o.id} class="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" class="size-5 accent-accent" checked={chosen.has(o.id)} onChange={(e) => onChange(e.currentTarget.checked ? [...chosen, o.id] : [...chosen].filter((x) => x !== o.id))} />
                {o.name}
              </label>
            ))}
            {!list.length && <span class="text-sm text-fg-2">{t("nothing")}</span>}
          </div>
          {help}
        </fieldset>
      );
    }
    case "items":
      return <Items field={f} value={(value as Obj[]) ?? []} onChange={onChange} room={room} described={described} help={help} />;
  }
}

function Items({ field: f, value, onChange, room, described, help }: { field: Field; value: Obj[]; onChange: (v: Obj[]) => void; room: RoomChoices; described?: string; help: unknown }) {
  const sub = f.fields ?? [];
  return (
    <fieldset aria-describedby={described}>
      <legend class="mb-2 text-sm font-medium text-fg-1">{f.label}</legend>
      {help}
      <ul class="space-y-2">
        {value.map((item, n) => (
          <li key={String(item.id ?? n)}>
            <details class="rounded-md border border-line bg-bg-1" open={!item.id}>
              <summary class="flex min-h-10 cursor-pointer items-center px-3 text-sm">{String(item[f.itemLabel ?? ""] || `${t("item")} ${n + 1}`)}</summary>
              <div class="space-y-4 border-t border-line p-3">
                <Form fields={sub} value={item} onChange={(v) => onChange(value.map((x, i) => (i === n ? v : x)))} room={room} />
                <button type="button" class="btn" onClick={() => onChange(value.filter((_, i) => i !== n))}>
                  {t("remove")}
                </button>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {value.length < (f.max ?? 25) && (
        <button type="button" class="btn mt-2" onClick={() => onChange([...value, emptyObject(sub)])}>
          + {t("add")}: {f.label}
        </button>
      )}
    </fieldset>
  );
}
