// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { fetchText, isPublicAddress } from "./net";

describe("outbound fetches", () => {
  it("tells public from private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("refuses private literals, other schemes and credentials before connecting", async () => {
    await expect(fetchText("http://127.0.0.1:1/feed")).rejects.toThrow("non-public");
    await expect(fetchText("http://[::1]/feed")).rejects.toThrow("non-public");
    await expect(fetchText("file:///etc/passwd")).rejects.toThrow("only http");
    await expect(fetchText("https://user:pw@example.org/")).rejects.toThrow("only http");
  });
  it("refuses host names that resolve to private addresses", async () => {
    await expect(fetchText("http://localhost:1/feed")).rejects.toThrow(/non-public/);
  });
});
