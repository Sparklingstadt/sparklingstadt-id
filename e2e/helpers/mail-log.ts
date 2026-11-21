import { readFile } from "node:fs/promises";
import type { MailKind } from "../../lib/id/mail-templates.ts";

export type MailRecord = { to: string; kind: MailKind; link: string; subject: string; text: string };

const logPath = () => process.env.MAIL_LOG ?? "/tmp/sparklingstadt-id-mail.jsonl";

export async function readMails(): Promise<MailRecord[]> {
  let raw: string;
  try {
    raw = await readFile(logPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as MailRecord);
}

/**
 * Waits for the newest `kind` mail to `email`. Pass `after` (the number of records
 * already present, from `(await readMails()).length`) to wait for a NEW mail.
 */
export async function lastMailTo(
  email: string,
  kind: MailKind,
  { after = 0 }: { after?: number } = {},
): Promise<MailRecord> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const found = (await readMails())
      .slice(after)
      .filter((mail) => mail.to === email && mail.kind === kind)
      .at(-1);
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(`No "${kind}" mail to ${email} appeared in ${logPath()} within 5 s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
