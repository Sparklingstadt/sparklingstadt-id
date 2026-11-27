-- The first implementation's tables, replaced by Better Auth's (ba_*) and moved by the one-time `pnpm run
-- import:legacy` at the cutover (spec 4.6 step 3). `throttles` stays (per-address and per-account limits).
--
-- Stops while `users` still holds an account that is not in `ba_users`, so that this migration can never destroy an
-- account that was not moved. The import script is gone from this commit on: to move such an account, check out the
-- commit before this migration and run `pnpm run import:legacy` from there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" u WHERE NOT EXISTS (SELECT 1 FROM "ba_users" b WHERE b.id = u.id)) THEN
    RAISE EXCEPTION 'users holds accounts that are not in ba_users yet: run "pnpm run import:legacy" from the commit before this migration first';
  END IF;
END $$;

DROP TABLE "auth_codes";
DROP TABLE "email_tokens";
DROP TABLE "sessions";
DROP TABLE "users";
DROP TYPE "email_token_purpose";
