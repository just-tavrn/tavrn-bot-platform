// SPDX-License-Identifier: Apache-2.0
/**
 * Mail through SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`); without a host the links
 * are logged (development) and the UI says so. The connection and the login are verified once at the start, so a
 * wrong password shows up in the log immediately, not at the first registration.
 */
import { createTransport } from "nodemailer";
import type { BotLogger } from "@tavrn/bot";
import type { Config } from "./config";

export interface Mailer {
  readonly configured: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(config: Config, log: BotLogger): Mailer {
  const smtp = config.smtp;
  if (!smtp) {
    return {
      configured: false,
      async send(to, subject, text) {
        // Development mode: the mail (with its link) goes to the log instead of a mailbox.
        log.info("mail (SMTP_HOST not set)", { to, subject, text });
      },
    };
  }
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === "tls",
    requireTLS: smtp.security === "starttls",
    ignoreTLS: smtp.security === "none",
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 15_000,
  });
  void transport
    .verify()
    .then(() => log.info("mail: SMTP login ok", { host: smtp.host, port: smtp.port, security: smtp.security, user: smtp.user }))
    .catch((e: unknown) => log.error("mail: SMTP connection or login failed; mails will fail until this is fixed", { host: smtp.host, port: smtp.port, security: smtp.security, user: smtp.user, error: e }));
  return {
    configured: true,
    async send(to, subject, text) {
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
    },
  };
}

/** A mailer that keeps the mails (tests). */
export function memoryMailer(): Mailer & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return { configured: false, sent, send: async (to, subject, text) => void sent.push({ to, subject, text }) };
}
