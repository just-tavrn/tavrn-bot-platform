// SPDX-License-Identifier: Apache-2.0
/**
 * Custom commands: `/<name>` answers with a text. Commands are announced for the whole application, so the names of
 * all rooms are announced together (at most 100 commands in total, APPLICATIONS.md §5.1) and a room that does not
 * define a name answers that it is not set up there; `/cmd <name>` reaches every custom command of the room, also
 * those beyond the limit.
 */
import type { Interaction } from "@tavrn/bot";
import { CLIENT_COMMANDS, Permission, can } from "../../tavrn";
import { defineModule, type ModuleCtx, type Room, type Settings } from "../types";
import { at, fill } from "../util";

interface Cmd {
  id: string;
  name: string;
  description: string;
  response: string;
  ephemeral: boolean;
  roles: string[];
}
interface S extends Settings {
  commands: Cmd[];
}

export const NAME = /^[a-z0-9_-]{1,32}$/;

/** The text of a custom command for an invoker. */
export function render(cmd: Pick<Cmd, "response">, vars: { user: string; room: string; count: number }): string {
  return fill(cmd.response, { user: at(vars.user), room: vars.room, count: vars.count });
}

async function run(ctx: ModuleCtx<S>, i: Interaction, room: Room, cmd: Cmd | undefined) {
  if (!cmd) return i.ephemeral("This command is not set up in this room.");
  if (cmd.roles.length && !can(i.permissions, Permission.ADMINISTRATOR)) {
    const member = await ctx.cache.member(room.ref, i.userId).catch(() => null);
    if (!member?.roles.some((r) => cmd.roles.includes(r))) return i.ephemeral("You may not use this command.");
  }
  const count = await ctx.cache.detail(room.ref).then((d) => d.member_count, () => 0);
  return i.reply(render(cmd, { user: i.user, room: room.name, count }), { ephemeral: cmd.ephemeral });
}

export default defineModule<S>({
  id: "custom-commands",
  title: "Custom commands",
  description: "Your own slash commands that answer with a text.",
  defaults: { commands: [] },
  schema: [
    {
      key: "commands",
      type: "items",
      label: "Commands",
      itemLabel: "name",
      max: 25,
      fields: [
        { key: "name", type: "string", label: "Name", help: "Lowercase letters, digits, - and _ (at most 32).", max: 32, required: true },
        { key: "description", type: "string", label: "Description", max: 100, required: true },
        { key: "response", type: "text", label: "Answer", help: "Placeholders: {user}, {room}, {count}.", max: 2000, required: true },
        { key: "ephemeral", type: "boolean", label: "Only the invoker sees the answer" },
        { key: "roles", type: "roles", label: "Only for these roles (empty: everybody)", max: 10 },
      ],
    },
  ],
  commands: [{ name: "cmd", description: "Run a custom command of this room", args: [{ name: "name", description: "The command's name", type: "string", required: true, max_length: 32 }], default_permissions: null, dm_allowed: false }],
  register(ctx) {
    ctx.command("cmd", (i, room, s) => run(ctx, i, room, s.commands.find((c) => c.name === String(i.args.name ?? "").toLowerCase())));
  },
  dynamicCommands(ctx) {
    const seen = new Map<string, string>();
    for (const room of ctx.enabledRooms()) for (const c of ctx.settings(room).commands) if (NAME.test(c.name) && !seen.has(c.name)) seen.set(c.name, c.description);
    return [...seen].map(([name, description]) => ({
      definition: { name, description: description || "Custom command", args: [], default_permissions: null, dm_allowed: false },
      handler: (i, room, s) => run(ctx, i, room, s.commands.find((c) => c.name === name)),
    }));
  },
  async onSave(_ctx, _room, s) {
    return s.commands.flatMap((c) =>
      !NAME.test(c.name) ? [`"${c.name}" is not a valid command name: use a–z, 0–9, - and _.`] : CLIENT_COMMANDS.has(c.name) ? [`/${c.name} is a command of the tavrn client itself: use /cmd ${c.name} or another name.`] : [],
    );
  },
});
