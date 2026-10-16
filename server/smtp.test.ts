// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { smtpConfig } from "./config";

describe("smtpConfig", () => {
  it("is off without a host", () => {
    expect(smtpConfig({})).toBeNull();
    expect(smtpConfig({ SMTP_HOST: "  " })).toBeNull();
  });

  it("defaults to TLS on 465 and takes the password as plain text", () => {
    expect(smtpConfig({ SMTP_HOST: "mail.example.org", SMTP_USER: "vpn@example.org", SMTP_PASSWORD: "P@$$w0rd" })).toEqual({
      host: "mail.example.org",
      port: 465,
      security: "tls",
      user: "vpn@example.org",
      password: "P@$$w0rd",
    });
  });

  it("infers STARTTLS from another port and honours an explicit security", () => {
    expect(smtpConfig({ SMTP_HOST: "h", SMTP_PORT: "587" })).toMatchObject({ port: 587, security: "starttls" });
    expect(smtpConfig({ SMTP_HOST: "h", SMTP_SECURITY: "none" })).toMatchObject({ port: 587, security: "none" });
    expect(smtpConfig({ SMTP_HOST: "h", SMTP_SECURITY: "starttls" })).toMatchObject({ port: 587, security: "starttls" });
    expect(smtpConfig({ SMTP_HOST: "h", SMTP_PORT: "2525", SMTP_SECURITY: "tls" })).toMatchObject({ port: 2525, security: "tls" });
    expect(smtpConfig({ SMTP_HOST: "h", SMTP_PORT: "abc" })).toMatchObject({ port: 465, security: "tls" });
  });
});
