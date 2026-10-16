// SPDX-License-Identifier: Apache-2.0
import type { Db } from "../../db";
import type { Room } from "../types";
export function leaderboard(_db: Db, _room: Room, _page: number) {
  return { page: 0, pages: 0, entries: [] };
}
