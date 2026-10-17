// SPDX-License-Identifier: Apache-2.0
/**
 * Optional real-bot fixture for a client's end-to-end tests. Run from this repository with:
 * E2E_RAID_BOT=1 node --import tsx e2e/raid-bot.ts
 * The usual TAVRN_BOT_NODE, TAVRN_BOT_TOKEN, TAVRN_BOT_KEY_FILE and TAVRN_BOT_STATE_DIR identify the test bot.
 * Mention it with "raid" in an installed room to create a card through the actual platform and raid module.
 */
import { createBot, silentLogger } from "@tavrn/bot";
import { loadConfig } from "../server/config";
import { Db } from "../server/db";
import raid from "../server/modules/raid-helper/index";
import { utcToWall } from "../server/modules/util";
import { Platform } from "../server/platform";

if (process.env.E2E_RAID_BOT !== "1" || process.env.NODE_ENV === "production") throw new Error("This fixture is for local end-to-end tests only.");
function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the raid fixture.`);
  return value;
}

const bot = createBot({
  node: env("TAVRN_BOT_NODE"),
  token: env("TAVRN_BOT_TOKEN"),
  key: process.env.TAVRN_BOT_KEY ?? null,
  keyFile: env("TAVRN_BOT_KEY_FILE"),
  stateDir: env("TAVRN_BOT_STATE_DIR"),
  joinPolicy: "eager",
  logger: silentLogger,
});
const db = new Db(":memory:");
const platform = new Platform(loadConfig({}), db, bot, silentLogger, [raid]);

bot.on("message", async (message) => {
  if (!message.roomId || !message.mentionsMe || message.authorKind !== "user" || !/\braid\b/i.test(message.text)) return;
  const ref = `${message.node}/${message.roomId}`;
  let room = platform.roomByRef(ref);
  if (!room) {
    const id = db.run("INSERT INTO rooms (ref, name, created_at) VALUES (?, 'Raid test room', ?)", ref, Date.now()).id;
    room = platform.roomById(id)!;
    const module = platform.module("raid-helper")!;
    await platform.saveSettings(room, module, { ...platform.settings(room, module), enabled: true, channel: message.conversationId });
  }
  const events = platform.collections("raid-helper").events!;
  await events.save!(room, {
    title: "Raid helper E2E",
    description: "Choose your own class and spec.",
    game: "wow",
    start: utcToWall(Date.now() + 48 * 3_600_000, "UTC"),
    channel: message.conversationId,
    leader: message.author,
    tanks: 2,
    healers: 4,
    dps: 14,
    max: 20,
    deadlineHours: 0,
    remind24: false,
    remind1: false,
    remindDm: false,
    status: "open",
  }, null, message.author);
});

const stop = async () => {
  await bot.stop();
  db.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
await bot.start();
console.log(`ready ${bot.info.address}`);
