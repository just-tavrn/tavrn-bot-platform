// SPDX-License-Identifier: Apache-2.0
/** Welcome and goodbye messages, an optional welcome DM and roles given on join. */
import { at, fill, post } from "../util";
import { defineModule, type Settings } from "../types";

interface S extends Settings {
  channel: string;
  welcome: string;
  goodbyeEnabled: boolean;
  goodbye: string;
  dmEnabled: boolean;
  dm: string;
  autoRoles: string[];
}

const PLACEHOLDERS = "Placeholders: {user}, {room}, {count} (members).";

export default defineModule<S>({
  id: "welcome",
  title: "Welcome",
  description: "Greets new members, says goodbye and gives roles on join.",
  defaults: { channel: "", welcome: "Welcome {user} to {room}! You are member number {count}.", goodbyeEnabled: false, goodbye: "{user} has left.", dmEnabled: false, dm: "Welcome to {room}! Have a look at the rules.", autoRoles: [] },
  schema: [
    { key: "channel", type: "channel", label: "Channel", help: "Where welcome and goodbye messages are posted." },
    { key: "welcome", type: "text", label: "Welcome message", help: PLACEHOLDERS, max: 1000 },
    { key: "goodbyeEnabled", type: "boolean", label: "Goodbye messages", section: "Goodbye" },
    { key: "goodbye", type: "text", label: "Goodbye message", help: PLACEHOLDERS, max: 1000 },
    { key: "dmEnabled", type: "boolean", label: "Send a direct message", section: "Direct message" },
    { key: "dm", type: "text", label: "Direct message", help: PLACEHOLDERS, max: 1000 },
    { key: "autoRoles", type: "roles", label: "Roles on join", section: "Roles", help: "Given to every new member (the bot's role must be above them).", max: 10 },
  ],
  register(ctx) {
    const vars = async (room: Parameters<typeof ctx.settings>[0], user: string) => ({ user: at(user), room: room.name, count: await ctx.cache.detail(room.ref).then((d) => d.member_count, () => 0) });
    ctx.on("memberJoin", async (e, room, s) => {
      if (!e.user) return;
      const v = await vars(room, e.user);
      await post(ctx, room, s.channel, fill(s.welcome, v), [e.user]);
      if (s.dmEnabled) await ctx.bot.dm(e.user, fill(s.dm, v)).catch((err: unknown) => ctx.log.warn("welcome DM failed", { error: err }));
      if (s.autoRoles.length) await ctx.cache.changeRoles(room.ref, e.userId, s.autoRoles).catch((err: unknown) => ctx.log.warn("auto roles failed", { room: room.ref, error: err }));
    });
    ctx.on("memberLeave", async (e, room, s) => {
      if (!s.goodbyeEnabled) return;
      const address = e.user ?? (await ctx.cache.member(room.ref, e.userId).catch(() => null))?.address;
      if (address) await post(ctx, room, s.channel, fill(s.goodbye, await vars(room, address)));
    });
  },
});
