// SPDX-License-Identifier: Apache-2.0
/**
 * SQLite through `node:sqlite` (built into Node.js 24): plain SQL, one numbered list of migrations applied at start.
 * Append new migrations at the end; never change one that was released.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS: string[] = [
  // 1: accounts, sessions, rooms, settings and the module tables
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
     verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
   CREATE TABLE sessions (
     hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
   CREATE TABLE tokens (
     hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, data TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL);
   CREATE TABLE rooms (
     id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
     installed INTEGER NOT NULL DEFAULT 1, disabled INTEGER NOT NULL DEFAULT 0,
     timezone TEXT NOT NULL DEFAULT 'UTC', created_at INTEGER NOT NULL);
   CREATE TABLE room_managers (
     room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     address TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (room_id, user_id));
   CREATE TABLE room_settings (
     room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, module TEXT NOT NULL, json TEXT NOT NULL,
     PRIMARY KEY (room_id, module));
   CREATE TABLE module_state (
     room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, module TEXT NOT NULL, key TEXT NOT NULL,
     value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (room_id, module, key));
   CREATE TABLE cases (
     id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, action TEXT NOT NULL,
     target TEXT NOT NULL, moderator TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
   CREATE INDEX cases_target ON cases (room_id, target);
   CREATE TABLE xp (
     room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL, address TEXT NOT NULL,
     xp INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (room_id, user_id));
   CREATE INDEX xp_rank ON xp (room_id, xp DESC);
   CREATE TABLE polls (
     id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     conversation TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, question TEXT NOT NULL,
     options TEXT NOT NULL, multiple INTEGER NOT NULL DEFAULT 0, closes_at INTEGER, closed INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE poll_votes (
     poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE, user TEXT NOT NULL, choice INTEGER NOT NULL,
     PRIMARY KEY (poll_id, user, choice));
   CREATE TABLE raid_events (
     id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, json TEXT NOT NULL,
     starts_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', conversation TEXT NOT NULL DEFAULT '',
     message_id TEXT NOT NULL DEFAULT '', reminded TEXT NOT NULL DEFAULT '');
   CREATE INDEX raid_events_room ON raid_events (room_id, starts_at);
   CREATE TABLE raid_signups (
     event_id INTEGER NOT NULL REFERENCES raid_events(id) ON DELETE CASCADE, user TEXT NOT NULL, status TEXT NOT NULL,
     class TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL, PRIMARY KEY (event_id, user));
   CREATE TABLE raid_games (
     id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, json TEXT NOT NULL);`,
];

export type Row = Record<string, SQLInputValue>;

/** A thin wrapper: `all`, `get`, `run` with positional parameters, and `tx` for a transaction. */
export class Db {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }
  private migrate() {
    this.raw.exec("CREATE TABLE IF NOT EXISTS migrations (n INTEGER PRIMARY KEY, at INTEGER NOT NULL)");
    const done = (this.get<{ n: number | null }>("SELECT MAX(n) AS n FROM migrations")?.n ?? 0) as number;
    MIGRATIONS.forEach((sql, i) => {
      if (i + 1 <= done) return;
      this.tx(() => {
        this.raw.exec(sql);
        this.run("INSERT INTO migrations (n, at) VALUES (?, ?)", i + 1, Date.now());
      });
    });
  }
  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: SQLInputValue[]): { changes: number; id: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.raw.close();
  }
}
