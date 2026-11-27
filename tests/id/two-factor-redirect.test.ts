import assert from "node:assert/strict";
import test from "node:test";
import { twoFactorPagePath } from "../../lib/id/two-factor-redirect.ts";

test("the 2FA page keeps the login page's language, next and reauth", () => {
  const next = "/oauth/authorize?client_id=c&state=s";
  assert.equal(
    twoFactorPagePath("/login", `?${new URLSearchParams({ next, reauth: "1" })}`),
    `/two-factor?${new URLSearchParams({ next, reauth: "1" })}`,
  );
  assert.equal(twoFactorPagePath("/zh-cn/login", "?next=%2Faccount"), "/zh-cn/two-factor?next=%2Faccount");
  assert.equal(twoFactorPagePath("/zh-tw/login", ""), "/zh-tw/two-factor");
});

test("only next and reauth are carried over", () => {
  assert.equal(twoFactorPagePath("/login", "?reset=done&fresh=1&next=%2Faccount"), "/two-factor?next=%2Faccount");
});
