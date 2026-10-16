// SPDX-License-Identifier: Apache-2.0
/** Mail through SMTP (`SMTP_URL`); without it the links are logged (development) and the UI says so. */
import { createTransport } from "nodemailer";
import type { BotLogger } from "@tavrn/bot";
import type { Config } from "./config";

export interface Mailer {
  readonly configured: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(config: Config, log: BotLogger): Mailer {
  if (!config.smtpUrl) {
    return {
      configured: false,
      async send(to, subject, text) {
        // Development mode: the mail (with its link) goes to the log instead of a mailbox.
        log.info("mail (SMTP_URL not set)", { to, subject, text });
      },
    };
  }
  const transport = createTransport(config.smtpUrl);
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
