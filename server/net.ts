// SPDX-License-Identifier: Apache-2.0
/**
 * Fetching URLs that people typed in (feeds) without opening the server's network to them (SSRF): http(s) only,
 * no credentials in the URL, every resolved address must be public (checked in the socket's own lookup, so a DNS
 * answer cannot change between check and connect), at most 3 redirects, 10 seconds, 2 MiB.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// Two lists: a BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules, too.
const v4 = new BlockList();
const v6 = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) v4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 127], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) v6.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !v4.check(ip, "ipv4");
  if (v !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return !v4.check(mapped, "ipv4");
  // Other IPv4-mapped spellings (::ffff:7f00:1) are refused outright.
  return !/^::ffff:/i.test(ip) && !v6.check(ip, "ipv6");
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
function safeLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb): void {
  dnsLookup(hostname, { family: options.family, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || !addresses.length) return cb(Object.assign(new Error(`${hostname} resolves to a non-public address`), { code: "EBLOCKED" }), "");
    if (options.all) cb(null, addresses);
    else cb(null, addresses[0]!.address, addresses[0]!.family);
  });
}

export interface FetchOptions {
  allowPrivate?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  redirects?: number;
}

export function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.reject(new Error("not a URL"));
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return Promise.reject(new Error("only http(s) URLs without credentials"));
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!opts.allowPrivate && isIP(host) && !isPublicAddress(host)) return Promise.reject(new Error("non-public address"));
  const max = opts.maxBytes ?? 2 * 1024 * 1024;
  const redirects = opts.redirects ?? 3;
  return new Promise((resolve, reject) => {
    const get = u.protocol === "https:" ? https.get : http.get;
    const req = get(u, { lookup: opts.allowPrivate ? undefined : (safeLookup as never), timeout: opts.timeoutMs ?? 10_000, headers: { "user-agent": "tavrn-bot-platform (feeds)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error("too many redirects"));
        return resolve(fetchText(new URL(res.headers.location, u).href, { ...opts, redirects: redirects - 1 }));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status}`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > max) req.destroy(new Error("response too large"));
        else chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
