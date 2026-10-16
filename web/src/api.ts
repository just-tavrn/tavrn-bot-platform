// SPDX-License-Identifier: Apache-2.0
/** JSON calls to the platform's API; errors carry the server's message. */
import { signal } from "./state";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "error", json?.message ?? res.statusText);
  return json as T;
}

export interface Me {
  email: string;
  admin: boolean;
}
export interface Config {
  addLink: string | null;
  mailConfigured: boolean;
  registrationOpen: boolean;
  bot: { online: boolean; address: string | null };
}
/** The signed-in user (null: logged out, undefined: not known yet). */
export const me = signal<Me | null | undefined>(undefined);
export const config = signal<Config | null>(null);

export async function loadSession() {
  config.value = await api<Config>("GET", "/config").catch(() => null);
  me.value = await api<Me>("GET", "/me").catch(() => null);
}
