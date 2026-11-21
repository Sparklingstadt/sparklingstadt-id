import assert from "node:assert/strict";
import test from "node:test";
import { clientIp } from "../../lib/id/client-ip.ts";
import { renderMail, type MailKind } from "../../lib/id/mail-templates.ts";

const kinds: MailKind[] = ["verify", "changeEmail", "alreadyRegistered", "resetPassword"];
const locales = ["ja", "zh-cn", "zh-tw"] as const;

test("renderMail includes the link and a subject for every kind and locale", () => {
  const link = "https://example.test/verify?token=abc_-123";
  for (const kind of kinds) {
    for (const locale of locales) {
      const { subject, text } = renderMail(kind, locale, link);
      assert.ok(subject.length > 0, `${kind}/${locale} subject`);
      assert.ok(text.includes(link), `${kind}/${locale} link`);
      assert.ok(text.includes("Sparklingstadt ID"), `${kind}/${locale} name`);
    }
  }
});

test("clientIp takes the first x-forwarded-for value", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" })), "1.2.3.4");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9");
  assert.equal(clientIp(new Headers()), "unknown");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "" })), "unknown");
});
