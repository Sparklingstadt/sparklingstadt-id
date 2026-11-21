import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// Built from pieces so this file does not match its own pattern.
const oldName = new RegExp(["ff", "pf"].join(""), "i");

test("no tracked file mentions the old name", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => file && !file.startsWith("docs/") && file !== "pnpm-lock.yaml");
  const offenders = files.filter((file) => oldName.test(readFileSync(file, "latin1")));
  assert.deepEqual(offenders, []);
});
