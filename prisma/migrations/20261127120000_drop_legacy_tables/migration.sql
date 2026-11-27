-- The first implementation's tables, replaced by Better Auth's (ba_*). `throttles` stays (per-address and
-- per-account limits).
--
-- Stops while `users` still holds an account that is not in `ba_users`, so that this migration can never destroy the
-- owner's account before `pnpm run import:legacy` has moved it (see README, "本番の切り替え").
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" u WHERE NOT EXISTS (SELECT 1 FROM "ba_users" b WHERE b.id = u.id)) THEN
    RAISE EXCEPTION 'users holds accounts that are not in ba_users yet: run "pnpm run import:legacy" first';
  END IF;
END $$;

DROP TABLE "auth_codes";
DROP TABLE "email_tokens";
DROP TABLE "sessions";
DROP TABLE "users";
DROP TYPE "email_token_purpose";
