import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sendMail } from "../../lib/id/mailer.ts";

const MAIL_ENV = ["RESEND_API_KEY", "MAIL_FROM", "MAIL_LOG", "VERCEL_ENV", "NODE_ENV"] as const;
const mail = { to: "a@example.com", kind: "verify", locale: "ja", link: "https://x.test/verify?token=t" } as const;

async function withEnv(values: Partial<Record<(typeof MAIL_ENV)[number], string>>, run: () => Promise<void>) {
  const env = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(MAIL_ENV.map((name) => [name, env[name]]));
  for (const name of MAIL_ENV) delete env[name];
  Object.assign(env, values);
  try {
    await run();
  } finally {
    for (const name of MAIL_ENV) {
      if (saved[name] === undefined) delete env[name];
      else env[name] = saved[name];
    }
  }
}

test("a production build without Resend or a mail log refuses to send", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    await assert.rejects(sendMail(mail), /Mail is not configured/);
  });
});

test("a production build with MAIL_LOG writes the mail log (E2E)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "id-mail-"));
  try {
    const logPath = join(dir, "mail.jsonl");
    await withEnv({ NODE_ENV: "production", MAIL_LOG: logPath }, async () => {
      await sendMail(mail);
    });
    const record = JSON.parse((await readFile(logPath, "utf8")).trim());
    assert.equal(record.to, mail.to);
    assert.equal(record.link, mail.link);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Vercel production never falls back to the mail log", async () => {
  await withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", MAIL_LOG: "/nonexistent/x" }, async () => {
    await assert.rejects(sendMail(mail), /Mail is not configured/);
  });
});

test("development falls back to the console", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  await withEnv({ NODE_ENV: "development" }, async () => {
    await sendMail(mail);
  });
  assert.equal(info.mock.callCount(), 1);
});
