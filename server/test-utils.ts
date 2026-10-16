// SPDX-License-Identifier: Apache-2.0
/** Test setup: an in-memory database, the fake bot and a platform with one connected room. */
import { silentLogger } from "@tavrn/bot";
import { loadConfig } from "./config";
import { Db } from "./db";
import { FAKE_REF, FakeBot } from "./fake-bot";
import type { Module, Room } from "./modules/types";
import { Platform } from "./platform";

export function setup(modules: Module<any>[], env: Record<string, string> = {}) {
  const db = new Db(":memory:");
  const fake = new FakeBot();
  const config = loadConfig({ BASE_URL: "http://dash.test", SESSION_SECRET: "s".repeat(40), ...env });
  const platform = new Platform(config, db, fake.asBot(), silentLogger, modules);
  platform.status.online = true;
  const id = db.run("INSERT INTO rooms (ref, name, created_at) VALUES (?, 'Fake room', 0)", FAKE_REF).id;
  const room = platform.roomById(id) as Room;
  /** Saves settings as the dashboard would (validated, `enabled` on unless given). */
  const configure = (moduleId: string, settings: Record<string, unknown> = {}) => {
    const m = platform.module(moduleId)!;
    return platform.saveSettings(room, m, { ...platform.settings(room, m), enabled: true, ...settings });
  };
  return { db, fake, config, platform, room, configure };
}
