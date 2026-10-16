// SPDX-License-Identifier: Apache-2.0
/**
 * Role menus: a bot message with buttons or a select menu; each choice gives or takes a role. Menus are edited in
 * the dashboard; saving posts new menus, edits changed ones in place and deletes removed ones.
 */
import { button, row, select, withComponents, type ComponentInteraction } from "@tavrn/bot";
import { qualify } from "../../tavrn";
import { defineModule, type Settings } from "../types";
import { post } from "../util";

interface Option {
  id: string;
  label: string;
  emoji: string;
  role: string;
}
interface Menu {
  id: string;
  title: string;
  text: string;
  channel: string;
  style: "buttons" | "select";
  mode: "multiple" | "single";
  options: Option[];
}
interface S extends Settings {
  menus: Menu[];
}

/** The message of a menu (throws TypeError for content the node would refuse, e.g. an invalid emoji). */
export function menuMessage(m: Menu): Record<string, unknown> {
  const body = [`**${m.title}**`, m.text, m.mode === "single" ? "Pick one." : "Pick as many as you like; pick again to remove."].filter(Boolean).join("\n");
  if (m.style === "select") {
    const options = m.options.map((o, i) => ({ label: o.label, value: String(i), ...(o.emoji ? { emoji: o.emoji } : {}) }));
    return withComponents(body, row(select(`rr:${m.id}`, options, { placeholder: "Choose your roles", min: 0, max: m.mode === "single" ? 1 : options.length })));
  }
  const buttons = m.options.map((o, i) => button({ label: o.label, emoji: o.emoji || undefined, customId: `rr:${m.id}:${i}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(row(...buttons.slice(i, i + 5)));
  return withComponents(body, ...rows);
}

export default defineModule<S>({
  id: "reaction-roles",
  title: "Role menus",
  description: "Messages with buttons or a menu where members pick their roles.",
  defaults: { menus: [] },
  schema: [
    {
      key: "menus",
      type: "items",
      label: "Menus",
      itemLabel: "title",
      max: 10,
      fields: [
        { key: "title", type: "string", label: "Title", max: 100, required: true },
        { key: "text", type: "text", label: "Text", max: 1000 },
        { key: "channel", type: "channel", label: "Channel", required: true },
        { key: "style", type: "select", label: "Style", options: [{ value: "buttons", label: "Buttons" }, { value: "select", label: "Select menu" }] },
        { key: "mode", type: "select", label: "Choices", options: [{ value: "multiple", label: "Several roles" }, { value: "single", label: "One role only" }] },
        { key: "options", type: "items", label: "Roles", itemLabel: "label", max: 20, fields: [{ key: "label", type: "string", label: "Label", max: 80, required: true }, { key: "emoji", type: "string", label: "Emoji", max: 16 }, { key: "role", type: "role", label: "Role", required: true }] },
      ],
    },
  ],
  register(ctx) {
    const apply = async (i: ComponentInteraction, menu: Menu, chosen: Option[]) => {
      const roles = menu.options.map((o) => o.role);
      const member = await ctx.cache.member(`${i.node}/${i.roomId}`, i.userId);
      const has = new Set(member?.roles ?? []);
      let add: string[];
      let remove: string[];
      if (i.values) {
        // A select: exactly the chosen roles of this menu.
        add = chosen.map((o) => o.role);
        remove = roles.filter((r) => !add.includes(r));
      } else {
        const role = chosen[0]!.role;
        add = has.has(role) ? [] : [role];
        remove = has.has(role) ? [role] : menu.mode === "single" ? roles.filter((r) => r !== role) : [];
      }
      await ctx.cache.changeRoles(`${i.node}/${i.roomId}`, i.userId, add, remove);
      const names = new Map((await ctx.cache.roles(`${i.node}/${i.roomId}`)).map((r) => [r.id, r.name]));
      const text = [add.length ? `Added: ${add.map((r) => names.get(r) ?? r).join(", ")}` : "", remove.filter((r) => has.has(r)).length ? `Removed: ${remove.filter((r) => has.has(r)).map((r) => names.get(r) ?? r).join(", ")}` : ""].filter(Boolean).join(" · ");
      return i.ephemeral(text || "No change.");
    };
    ctx.component(/^rr:[\w-]{1,64}(:\d{1,2})?$/, async (i, _room, s) => {
      const [, menuId, index] = i.customId!.split(":");
      const menu = s.menus.find((m) => m.id === menuId);
      if (!menu) return i.ephemeral("This menu no longer exists.");
      const picked = (index !== undefined ? [index] : (i.values ?? [])).map((v) => menu.options[Number(v)]);
      if (picked.some((o) => !o) || (!i.values && picked.length !== 1)) return i.ephemeral("That choice is not part of this menu.");
      // The node checks a select's limits only in plaintext channels; encrypted values are checked here.
      if (menu.mode === "single" && picked.length > 1) return i.ephemeral("Pick one role only.");
      return apply(i, menu, picked as Option[]).catch((e: unknown) => {
        ctx.log.warn("role menu failed", { error: e });
        return i.ephemeral("I could not change your roles (my role must be above them).");
      });
    });
  },
  async onSave(ctx, room, s, previous) {
    const warnings: string[] = [];
    for (const menu of s.menus) {
      const key = `menu:${menu.id}`;
      const posted = JSON.parse(ctx.state.get(room, key) ?? "null") as { channel: string; message: string } | null;
      let content: Record<string, unknown>;
      try {
        content = menuMessage(menu);
      } catch (e) {
        warnings.push(`Menu "${menu.title}": ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (posted && posted.channel === menu.channel) {
        const ok = await ctx.bot.edit(qualify(room.node, menu.channel), posted.message, content).then(() => true, () => false);
        if (ok) continue;
      } else if (posted) {
        await ctx.bot.deleteMessage(qualify(room.node, posted.channel), posted.message).catch(() => undefined);
      }
      const id = await post(ctx, room, menu.channel, content);
      if (id) ctx.state.set(room, key, JSON.stringify({ channel: menu.channel, message: id }));
      else warnings.push(`Menu "${menu.title}" could not be posted (can the bot write in that channel?).`);
    }
    for (const old of previous.menus.filter((p) => !s.menus.some((m) => m.id === p.id))) {
      const posted = JSON.parse(ctx.state.get(room, `menu:${old.id}`) ?? "null") as { channel: string; message: string } | null;
      if (posted) await ctx.bot.deleteMessage(qualify(room.node, posted.channel), posted.message).catch(() => undefined);
      ctx.state.del(room, `menu:${old.id}`);
    }
    return warnings;
  },
});
