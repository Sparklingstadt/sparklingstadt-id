import { appendFile } from "node:fs/promises";
import type { Locale } from "@/i18n/routing";
import { renderMail, type MailKind } from "./mail-templates.ts";

export type { MailKind };

export async function sendMail(input: { to: string; kind: MailKind; locale: Locale; link: string }): Promise<void> {
  const { subject, text } = renderMail(input.kind, input.locale, input.link);
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (apiKey && from) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the ${input.kind} mail (HTTP ${response.status}).`);
    }
    return;
  }

  const notConfigured = () =>
    new Error("Mail is not configured: RESEND_API_KEY and MAIL_FROM are required in production.");
  if (process.env.VERCEL_ENV === "production") throw notConfigured();

  // The JSON Lines log is for E2E, which runs a production build locally.
  const logPath = process.env.MAIL_LOG;
  if (logPath) {
    await appendFile(
      logPath,
      `${JSON.stringify({ to: input.to, kind: input.kind, link: input.link, subject, text })}\n`,
    );
    return;
  }
  if (process.env.NODE_ENV === "production") throw notConfigured();
  console.info(`[id mail] to=${input.to} kind=${input.kind}\n${subject}\n${text}`);
}
