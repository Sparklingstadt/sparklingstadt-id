# Sparklingstadt ID の Better Auth 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sparklingstadt ID の自前の認証と OIDC を Better Auth に置き換え、パスキー（指紋）と二要素認証（TOTP＋バックアップコード）を足す。登録済みのクライアントの側は何も変えない。

**Architecture:**
- Better Auth の本体をここで使う：メール＋パスワード、メール確認、セッション、IP ごとのレート制限。
- プラグインを 4 つ使う：`@better-auth/oauth-provider`・`jwt`（ES256）・`@better-auth/passkey`・`twoFactor`。
- 自前のプラグインを 2 つ足し、Better Auth にない約束を補う：
  - `accountThrottle`：アカウントごとの試行回数の制限。
  - `oidcCompat`：メール未確認のときの authorize のゲート。
- ハンドラーは `/api/auth/[...all]` に置く。今の `/oauth/*` は Next.js の rewrites で Better Auth へつなぐ。`/oauth/logout` と `/.well-known/openid-configuration` は自前の Route Handler で、今の答えを保つ。
- ログイン・二要素認証・パスキーの画面は、Better Auth のクライアント（`oauthProviderClient` 入り）で動くクライアントコンポーネントにする。authorize から来たときは、このクライアントが元のフローを続ける。アカウントの画面の操作は、今の Server Action のまま中身を `auth.api.*` に替える。

**Tech Stack:** Next.js 16.4.6、Prisma 7.10（`@prisma/adapter-pg`、Neon）、next-intl 4、better-auth 1.7.28、@better-auth/oauth-provider 1.7.28、@better-auth/passkey 1.7.28、Playwright（Chromium の仮想認証器）、node:test。

**Spec:** `docs/superpowers/specs/2026-11-26-better-auth-migration-design.md`

## Global Constraints

**版**
- `better-auth`・`@better-auth/oauth-provider`・`@better-auth/passkey` は 3 つとも `1.7.28` に固定する（`^` を付けない）。

**OIDC**
- issuer は `ID_ISSUER`（本番 `https://id.sparklingstadt.com`、末尾スラッシュなし）。Better Auth の `baseURL` にも同じ値を使う。
- ID トークンは ES256。クレームは `iss`・`sub`・`aud`・`iat`・`exp`・`auth_time`・`nonce`・`email`・`email_verified`・`name`。`role` は出さない。
- クライアントに許す scope は `openid email profile`。PKCE は S256 だけで、必須。同意画面は出さない（全クライアント `skipConsent: true`）。
- クライアントのシークレットの照合は、`sha256(secret)` の 16 進（今の `lib/id/tokens.ts` の `hashToken`）。
- 今の URL `/oauth/authorize`・`/oauth/token`・`/oauth/jwks`・`/oauth/userinfo`・`/oauth/logout`・`/.well-known/openid-configuration` は、どれも動き続けること。

**アカウント**
- セッションは 30 日（`expiresIn: 30 * 24 * 60 * 60`）。
- パスワードのハッシュは `lib/password.ts` の `hashPassword`・`verifyPassword` で、形式は `scrypt$N$r$p$salt$hash`。パスワードの規則は `lib/id/validation.ts` の `checkPassword`。
- アカウントごとの制限の値は今と同じ。窓はどれも 15 分。

  | キー | 回数 |
  | --- | --- |
  | `login:mail:<email>` | 5（成功で数え直す） |
  | `login:account:<email>` | 30 |
  | `login:ip:<ip>` | 20 |
  | `signup:ip:<ip>` | 10 |
  | `resend:ip:<ip>` | 10 |
  | `emailchange:ip:<ip>` | 10 |
  | `reset:ip:<ip>` | 10 |
  | パスワードの確認 | 5（成功で数え直す） |
  | 新規：`2fa:account:<userId>` | 5（成功で数え直す） |

**パスキー**
- `rpName: "Sparklingstadt ID"`。`rpID` は `new URL(ID_ISSUER).hostname`。`origin` は `ID_ISSUER`。`userVerification: "required"`。

**二要素認証**
- `issuer: "Sparklingstadt ID"`。方式は TOTP とバックアップコード（10 個）。`otpOptions` は使わない。`allowPasswordless: false`。「この端末を信頼する」は出さない。

**画面とメール**
- 画面とメールは ja・zh-cn・zh-tw の 3 言語。足す文言は `messages/{ja,zh-cn,zh-tw}.json` の 3 つに同時に入れる。「FFPF」「Candy Rain」の名前を出さない（`tests/no-ffpf-name.test.ts`）。

**テストの実行**
- 単体テスト：`pnpm run test:unit`。
- E2E：`docker compose up -d --wait && pnpm prisma migrate deploy && pnpm exec playwright test`。Docker が要るので、クラウドのセッションでは実行できない。持ち主の Mac で行う。

## Review Focus

1. **二要素認証をオンにしたアカウントが、authorize からパスワードでログインしたとき。** コードの画面を経ずに `code` が出てはいけない。→ Task 7 のテスト `authorize with password and 2FA does not issue a code before the TOTP`。
2. **`prompt=login` で来て、パスキーでログインし直したとき。** 元の authorize に戻り、新しい `auth_time` のコードが出ること。→ Task 6 のテスト `prompt=login then passkey returns a code with a fresh auth_time`。
3. **メール未確認のアカウントがパスキーを登録し、authorize に来たとき。** `/account?verify=required` に送られ、コードは出ないこと。→ Task 6 のテスト `passkey login with unconfirmed email does not get a code`。
4. **パスワードを再設定したアカウントに二要素認証がかかっているとき。** 再設定のあとのログインでも TOTP を求めること。→ Task 7 のテスト `password reset keeps 2FA`。
5. **今の `/oauth/token` に `client_secret_basic` で、今のシークレット（取り込んだハッシュ）を送ったとき。** 通ること。違うシークレットは `invalid_client` になること。→ Task 4 のテスト `legacy client secret is accepted at /oauth/token`。

---

### Task 1: Better Auth の土台（本体・スキーマ・ハンドラー）

**Files:**
- Modify: `package.json`（依存を足す）
- Create: `lib/auth.ts`（`betterAuth(...)` の設定。プラグインは後の Task で足す）
- Create: `lib/auth-client.ts`（`createAuthClient`）
- Create: `app/api/auth/[...all]/route.ts`
- Modify: `prisma/schema.prisma`（Better Auth の `User`・`Session`・`Account`・`Verification`、それに Better Auth の内部のレート制限の表 `RateLimit` を足す。今の `User`・`Session` は名前がぶつかるので `LegacyUser`・`LegacySession` に改名し、`@@map` は今の表名のまま）
- Create: `prisma/migrations/<timestamp>_better_auth_core/migration.sql`
- Modify: `.env.example`（`BETTER_AUTH_SECRET`）
- Test: `tests/id/auth-config.test.ts`、`e2e/better-auth-core.spec.ts`

**Interfaces:**
- Produces:
  - `export const auth`（`lib/auth.ts`）。後の Task は `plugins: [...]` に足す。
  - `export const authClient`（`lib/auth-client.ts`）。
  - `export function authOptionsFrom(env: Record<string, string | undefined>): { baseURL: string; secret: string }`：`ID_ISSUER` か `BETTER_AUTH_SECRET` が無ければ `Error("<変数名>: is not set")` を投げる。値はメッセージに入れない。
  - Better Auth のモデル名は `user`・`session`・`account`・`verification`。表名は `ba_users`・`ba_sessions`・`ba_accounts`・`ba_verifications`（`@@map`）。後で今の表を消したあとも名前を変えない。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/id/auth-config.test.ts`：
    - `authOptionsFrom({ ID_ISSUER: "https://id.example.com/", BETTER_AUTH_SECRET: "x".repeat(32) })` が `{ baseURL: "https://id.example.com", secret: "x".repeat(32) }` を返す。
    - `BETTER_AUTH_SECRET` が無いと `/BETTER_AUTH_SECRET: is not set/` で投げる。
  - `e2e/better-auth-core.spec.ts` の `sign-up and sign-in through /api/auth work with the legacy password hash`：
    1. `POST /api/auth/sign-up/email` で登録すると 200。
    2. `ba_accounts.password` が `^scrypt\$` で始まる。
    3. `POST /api/auth/sign-in/email` が 200 で、Set-Cookie にセッションがある。
- [ ] **Step 2: 失敗を確かめる。** `pnpm run test:unit` が、`authOptionsFrom` が無くて FAIL になる。
- [ ] **Step 3: 依存を入れる。** `pnpm add better-auth@1.7.28 @better-auth/oauth-provider@1.7.28 @better-auth/passkey@1.7.28`。
- [ ] **Step 4: `lib/auth.ts` を書く。**
  - `database`：`prismaAdapter(getPrisma(), { provider: "postgresql" })`（`better-auth/adapters/prisma`）。
  - `session.expiresIn`：30 日。
  - `emailAndPassword`：
    - `enabled: true`
    - `requireEmailVerification: false`（未確認でもログインはできる。ゲートは Task 4）
    - `minPasswordLength: 1`・`maxPasswordLength: 1024`（規則は `checkPassword` で別に確かめる）
    - `password: { hash: hashPassword, verify: ({ hash, password }) => verifyPassword(password, hash) }`
    - `revokeSessionsOnPasswordReset: true`
  - `rateLimit: { enabled: true, storage: "database" }`。
  - `plugins: [nextCookies()]`（`better-auth/next-js`。Server Action から Cookie を書くため。配列の最後に置く）。
  - `user.modelName: "user"`。表名は Prisma の `@@map` で決める。
- [ ] **Step 5: ハンドラーを置く。** `app/api/auth/[...all]/route.ts` は `export const { GET, POST } = toNextJsHandler(auth)`。
- [ ] **Step 6: スキーマとマイグレーション。**
  - `pnpm dlx @better-auth/cli@1.7.28 generate --config lib/auth.ts --output prisma/schema.prisma` の出力を手で取り込み、上の名前に合わせる。
  - `pnpm prisma migrate dev --name better_auth_core`。
- [ ] **Step 7: 通ることを確かめる。**
  - `pnpm run test:unit` が PASS。
  - `pnpm exec playwright test e2e/better-auth-core.spec.ts` が PASS。
- [ ] **Step 8: コミットする。** `git commit -m "Better Auth の本体とスキーマ、/api/auth のハンドラーを足す"`

### Task 2: アカウントの画面を Better Auth に載せ替える

**Files:**
- Modify: `app/[locale]/actions.ts`（全 Action の中身）
- Modify: `app/[locale]/login/login-form.tsx`（クライアントの `authClient.signIn.email` に替える）
- Modify: `app/[locale]/verify/*`・`reset/*`・`forgot/*`・`account/*`
- Rewrite: `lib/id/session.ts`
- Rewrite: `lib/id/accounts.ts`（Better Auth の呼び出しと、メールのフックの中身だけを残す）
- Create: `lib/id/auth-mail.ts`
- Modify: `e2e/helpers/db.ts`（`ba_*` の表を見る）
- Test: 既存の `e2e/account.spec.ts`（全部通す）

**Interfaces:**
- Consumes: Task 1 の `auth`・`authClient`。
- Produces:
  - `getCurrentUser(): Promise<{ user: { id: string; email: string; name: string; emailVerified: boolean }; session: { id: string; createdAt: Date } } | null>`（`lib/id/session.ts`、`react` の `cache` 付き）。中身は `auth.api.getSession({ headers: await headers() })`。
  - `mailHooks`（`lib/id/auth-mail.ts`）：`{ sendVerificationEmail, sendResetPassword, sendChangeEmailVerification }`。リンクの URL は今の画面（`/verify?token=…`・`/reset?token=…`、言語つき）。言語は `NEXT_LOCALE` の Cookie から、無ければ `ja`。
  - `e2e/helpers/db.ts` の `deleteUser(email)`・`expireMailedLink(link)` は名前と意味を保つ。`expireAuthCode` は Task 4 で直す。

- [ ] **Step 1: 既存の E2E を見る。** `pnpm exec playwright test e2e/account.spec.ts` を実行し、今の画面が Better Auth の上では FAIL になることを確かめる。
- [ ] **Step 2: メールのフック。** `lib/id/auth-mail.ts` を書き、`lib/auth.ts` につなぐ。
  - `emailVerification.sendVerificationEmail`、`emailAndPassword.sendResetPassword`、`user.changeEmail: { enabled: true, sendChangeEmailVerification }`。
  - `emailVerification.sendOnSignUp: true`。
  - 送るのは今の `sendMail`。失敗しても画面は同じに見えるよう、`sendMailQuietly` と同じく握りつぶしてログだけ出す。
- [ ] **Step 3: Action の中身を替える。**
  - 割り当て：
    - `signUpAction` → `auth.api.signUpEmail`
    - `resendVerificationAction` → `auth.api.sendVerificationEmail`
    - `changeDisplayNameAction` → `auth.api.updateUser({ body: { name } })`
    - `requestEmailChangeAction` → `auth.api.changeEmail`
    - `changePasswordAction` → `auth.api.changePassword({ body: { revokeOtherSessions: true } })`
    - `requestPasswordResetAction` → `auth.api.requestPasswordReset`
    - `resetPasswordAction` → `auth.api.resetPassword`
    - `confirmEmailAction` → `auth.api.verifyEmail`
    - `logOutAction` → `auth.api.signOut`
  - 入力の確かめ（`normalizeEmail`・`normalizeDisplayName`・`checkPassword`）と、エラーの文言のキーは今のまま。
- [ ] **Step 4: ログインの画面。** `login-form.tsx` をクライアントの `authClient.signIn.email` に替える。成功したら `next`（`safeNextPath`）か `/account` へ移る。
- [ ] **Step 5: 通ることを確かめる。** `pnpm exec playwright test e2e/account.spec.ts` が PASS。ほかの spec はまだ FAIL でよい。
- [ ] **Step 6: コミットする。** `git commit -m "アカウントの画面と Server Action を Better Auth に載せ替える"`

### Task 3: アカウントごとの試行回数の制限（`accountThrottle`）

**Files:**
- Create: `lib/id/account-throttle.ts`（Better Auth のプラグイン）
- Modify: `lib/id/throttle.ts`（`clientIp` の取り方は今のまま）
- Modify: `lib/auth.ts`（プラグインを足す）
- Test: `tests/id/account-throttle.test.ts`、`e2e/account.spec.ts` の制限のテスト（今あるもの）

**Interfaces:**
- Produces:
  - `accountThrottle(store?: { consume(key: string, limit: number): Promise<boolean>; reset(key: string): Promise<void> }): BetterAuthPlugin`。既定は `consumeThrottle`・`resetThrottle`。
  - `throttleRules: Array<{ path: string; keys: (ctx: { email?: string; ip: string; userId?: string }) => Array<{ key: string; limit: number; resetOnSuccess?: boolean }> }>`。
    - `/sign-in/email`：`login:ip`・`login:mail`（成功で数え直す）・`login:account`。
    - `/sign-up/email`：`signup:ip`。
    - `/send-verification-email`：`resend:ip`。
    - `/change-email`：`emailchange:ip`。
    - `/request-password-reset`：`reset:ip`。
    - `/change-password`：パスワードの確認。
    - Task 7 で `/two-factor/verify-totp`・`/two-factor/verify-backup-code`・`/two-factor/enable`・`/two-factor/disable` を足す。
  - 制限に当たったときは `APIError("TOO_MANY_REQUESTS", { code: "THROTTLED" })` を返す。画面は今の「しばらくしてから」の文言を出す。

- [ ] **Step 1: 失敗するテストを書く。** `tests/id/account-throttle.test.ts` に、メモリーの store を渡した表のテストを書く。
  - `login:mail` は 5 回目までは通り、6 回目で `THROTTLED`。
  - 成功すると `login:mail` だけ数え直し、`login:account` は数え直さない。
  - `/sign-up/email` は `signup:ip:<ip>` で 10 回。
- [ ] **Step 2: 失敗を確かめる。** `pnpm run test:unit` が FAIL。
- [ ] **Step 3: 実装する。** `lib/id/account-throttle.ts` を書く。
  - 数えるのは `hooks.before`（`createAuthMiddleware`）、成功時の数え直しは `hooks.after`。
  - IP は `clientIp(ctx.headers)`。メールは `normalizeEmail(body.email)`。
- [ ] **Step 4: 通ることを確かめる。**
  - `pnpm run test:unit` が PASS。
  - `pnpm exec playwright test e2e/account.spec.ts` の制限とアカウントの列挙のテストが PASS。
- [ ] **Step 5: コミットする。** `git commit -m "アカウントごとの試行回数の制限を Better Auth のプラグインで保つ"`

### Task 4: OIDC プロバイダー（oauth-provider・jwt・今の URL）

**Files:**
- Modify: `lib/auth.ts`（`jwt`・`oauthProvider`・`oidcCompat` を足す）
- Create: `lib/id/oidc-compat.ts`
- Create: `lib/id/client-import.ts`
- Create: `scripts/import-clients.ts`
- Modify: `next.config.ts`（`rewrites`）
- Rewrite: `app/.well-known/openid-configuration/route.ts`（ファイルが無ければ Create。今どこで答えているかを先に確かめる）
- Delete: `app/oauth/authorize`・`token`・`jwks`・`userinfo` の各 `route.ts`、`lib/id/authorization.ts`・`pkce.ts`・`prompt.ts`・`jwt.ts`・`config.ts`・`clients.ts`。`logout` は Task 5。
- Modify: `lib/auth-client.ts`（`oauthProviderClient()`）
- Modify: `playwright.config.ts`（`OIDC_CLIENTS` を、global setup で `importClients` を使って DB に入れる）
- Modify: `e2e/helpers/db.ts`（`expireAuthCode` を Better Auth の表に向ける）
- Test: `tests/id/client-import.test.ts`、既存の `e2e/oidc.spec.ts`・`e2e/sso.spec.ts`

**Interfaces:**
- Produces:
  - `importClients(prisma, clientsJson: string): Promise<{ created: number; updated: number }>`（`lib/id/client-import.ts`）。
    - 入力は今の `OIDC_CLIENTS` の配列：`id`・`name`・`secretHash`・`redirectUris`・`postLogoutRedirectUris`。
    - それを `oauthClient` に upsert する。中身は `clientId=id`、`clientSecret=secretHash`、`scopes=["openid","email","profile"]`、`skipConsent=true`、`enableEndSession=true`、`tokenEndpointAuthMethod="client_secret_basic"`、`grantTypes=["authorization_code"]`、`responseTypes=["code"]`。
    - 何度実行しても同じ結果になる。
  - `findClientPostLogoutUris(clientId: string): Promise<string[] | null>`（Task 5 が使う）。
  - `oidcCompat(): BetterAuthPlugin`。`/oauth2/authorize` の `hooks.before` で、セッションのユーザーが `emailVerified === false` なら次のように答える。
    - `prompt=none` なら `redirect_uri?error=interaction_required&state=…`。
    - それ以外は `/account?verify=required`（言語つき）。
- 設定の値：
  - `jwt({ jwks: { keyPairConfig: { alg: "ES256" } }, jwt: { issuer: ID_ISSUER } })`。
  - `oauthProvider` の主な値：
    - `loginPage: "/login"`、`consentPage: "/login"`（同意は出さないので使われない）
    - `scopes: ["openid","email","profile"]`
    - `grantTypes: ["authorization_code"]`
    - `allowDynamicClientRegistration: false`
    - `storeClientSecret: { hash: hashToken, verify: (s, h) => hashToken(s) と h を timingSafeEqual で比べる }`
    - `idTokenExpiresIn: 300`、`accessTokenExpiresIn: 300`、`codeExpiresIn: 300`
  - `next.config.ts` の rewrites：
    - `/oauth/authorize` → `/api/auth/oauth2/authorize`
    - `/oauth/token` → `/api/auth/oauth2/token`
    - `/oauth/userinfo` → `/api/auth/oauth2/userinfo`
    - `/oauth/jwks` → `/api/auth/jwks`
  - discovery（自前の Route Handler）：
    - `oauthProviderOpenIdConfigMetadata` で作った文書を土台にし、エンドポイントの URL を今の `/oauth/*` に置き換えて返す。
    - `grant_types_supported: ["authorization_code"]`、`prompt_values_supported: ["none","login"]`、`end_session_endpoint: <issuer>/oauth/logout` を含める。
    - registration・introspection・revocation は載せない。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/id/client-import.test.ts`：メモリーの擬似 prisma で、`importClients` が今の形の JSON から上の値の行を作る。2 回目は `{ created: 0, updated: 1 }`。
  - `e2e/oidc.spec.ts` に `legacy client secret is accepted at /oauth/token` を足す。
    - global setup のシークレットで、`client_secret_basic` のコード交換が 200 になる。
    - シークレットを 1 文字変えると 401 で `error: "invalid_client"`。
  - 既存の discovery のテストは、`toEqual` を上の値に合わせて直す。
- [ ] **Step 2: 失敗を確かめる。** `pnpm run test:unit` と `pnpm exec playwright test e2e/oidc.spec.ts` が FAIL。
- [ ] **Step 3: 実装する。** `client-import.ts`、`scripts/import-clients.ts`（`OIDC_CLIENTS` を読んで `importClients`）、`oidc-compat.ts`、`lib/auth.ts` のプラグイン、rewrites、discovery を書き、古いファイルを消す。
- [ ] **Step 4: ログイン画面を OIDC の続きに対応させる。** `oauthProviderClient()` を `authClient` に足す。`login-form.tsx` では、`signIn.email` の結果に続きの URL があればそこへ移る。
- [ ] **Step 5: 通ることを確かめる。** `pnpm run test:unit`、`pnpm exec playwright test e2e/oidc.spec.ts e2e/sso.spec.ts` が PASS。
  - oidc.spec で直してよいのは、アクセストークンの形を前提にしたアサーションだけ（JWT として開く所）。userinfo を呼んで `sub`・`email`・`name` が返ることは保つ。
  - `prompt=none`・`prompt=login`・メール未確認・PKCE なしの拒否・登録にない `redirect_uri` で 400 を返すテストは、そのまま通すこと。
- [ ] **Step 6: コミットする。** `git commit -m "OIDC を Better Auth の oauth-provider に替え、今の /oauth/* と discovery を保つ"`

### Task 5: ログアウト（RP-Initiated Logout）

**Files:**
- Rewrite: `app/oauth/logout/route.ts`
- Rewrite: `lib/id/logout.ts`
- Modify: `app/[locale]/actions.ts`（`confirmLogoutAction`）
- Test: 既存の `e2e/logout.spec.ts`（全部通す）

**Interfaces:**
- Consumes: Task 4 の `findClientPostLogoutUris`。
- Produces: `resolvePostLogoutRedirect(params: URLSearchParams): Promise<string | null>`。登録と完全一致した `post_logout_redirect_uri` に `state` を付けて返す。それ以外は null。
- 動き：
  - `id_token_hint` がある場合：Better Auth の jwks で検証し、`aud` が登録済みのクライアントで、`sub` が今のセッションのユーザーなら、`auth.api.signOut` してから戻す。
  - `id_token_hint` が無い場合、または別の人のものの場合：セッションがあれば `/logout`（確認の画面）へ送る。無ければ戻す（今のテストのとおり）。

- [ ] **Step 1: 失敗を確かめる。** `pnpm exec playwright test e2e/logout.spec.ts` が FAIL。
- [ ] **Step 2: 実装する。** `lib/id/logout.ts` と `route.ts` を書き直す。ID トークンの検証は `jose` の `createRemoteJWKSet` ではなく、`auth.api.getJwks()` の結果を `createLocalJWKSet` で使う（同じプロセスなので）。
- [ ] **Step 3: 通ることを確かめる。** `pnpm exec playwright test e2e/logout.spec.ts` が PASS（10 本）。
- [ ] **Step 4: コミットする。** `git commit -m "RP-Initiated Logout を Better Auth のセッションと jwks で保つ"`

### Task 6: パスキー

**Files:**
- Modify: `lib/auth.ts`、`lib/auth-client.ts`（`passkey()`・`passkeyClient()`）
- Create: `app/[locale]/account/passkey-section.tsx`（一覧・追加・名前・削除）
- Create: `app/[locale]/login/passkey-button.tsx`
- Modify: `app/[locale]/login/login-form.tsx`（メール欄に `autoComplete="username webauthn"`、conditional UI）
- Modify: `messages/*.json`
- Create: `e2e/helpers/webauthn.ts`
- Test: `e2e/passkey.spec.ts`

**Interfaces:**
- Consumes: Task 4 の OIDC の続き（`oauthProviderClient`）。
- Produces: `addVirtualAuthenticator(page: Page): Promise<{ authenticatorId: string; remove(): Promise<void> }>`（`e2e/helpers/webauthn.ts`）。CDP の `WebAuthn.enable` と `WebAuthn.addVirtualAuthenticator` を、`{ protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true }` で呼ぶ。
- 設定：`passkey({ rpID, rpName: "Sparklingstadt ID", origin: ID_ISSUER, authenticatorSelection: { residentKey: "required", userVerification: "required" } })`。

- [ ] **Step 1: 失敗するテストを書く。** `e2e/passkey.spec.ts`：
  - `registers a passkey on the account page and signs in with it`：
    1. `signedInUser` でログインし、`/account` でパスキーを追加すると一覧に 1 件出る。
    2. ログアウトしてから `/login` で「パスキーでログイン」を押すと `/account` に入れる。
  - `passkey sign-in from authorize returns a code`：authorize から `/login` に来てパスキーでログインすると、`redirect_uri?code=…&state=<同じ>` に戻る。
  - `prompt=login then passkey returns a code with a fresh auth_time`：ログイン中に `prompt=login` で来てパスキーでログインし直すと、ID トークンの `auth_time` が前の値より大きい。
  - `passkey login with unconfirmed email does not get a code`：未確認のユーザーがパスキーでログインして authorize に来ると、`/account?verify=required` に送られる。
  - `passkey login does not ask for the 2FA code`：二要素認証がオンでも、パスキーなら TOTP の画面を経ない。Task 7 のあとに有効にする。それまでは `test.fixme`。
  - `deleting the passkey stops it from signing in`。
- [ ] **Step 2: 失敗を確かめる。** `pnpm exec playwright test e2e/passkey.spec.ts` が FAIL。
- [ ] **Step 3: 実装する。** プラグイン、`/account` の欄、ログインのボタンと conditional UI、3 言語の文言を足す。パスキーの追加は `authClient.passkey.addPasskey({ name })`、ログインは `authClient.signIn.passkey()`。
- [ ] **Step 4: 通ることを確かめる。** `pnpm exec playwright test e2e/passkey.spec.ts` が PASS（fixme の 1 本を除く）。
- [ ] **Step 5: コミットする。** `git commit -m "パスキーの登録とパスキーでのログインを足す"`

### Task 7: 二要素認証

**Files:**
- Modify: `lib/auth.ts`、`lib/auth-client.ts`（`twoFactor()`・`twoFactorClient({ onTwoFactorRedirect })`）
- Modify: `lib/id/account-throttle.ts`（`/two-factor/*` の規則）
- Create: `app/[locale]/account/two-factor-section.tsx`（オン：パスワード→QR→コードの確認→バックアップコード。オフ。バックアップコードの作り直し）
- Create: `app/[locale]/two-factor/page.tsx`、`two-factor-form.tsx`（ログインの 2 段目。TOTP かバックアップコード）
- Modify: `messages/*.json`、`package.json`（QR を描くライブラリ。選ぶのは作る人）
- Create: `e2e/helpers/totp.ts`
- Test: `e2e/two-factor.spec.ts`、`e2e/passkey.spec.ts` の fixme を外す

**Interfaces:**
- Consumes: Task 3 の `throttleRules`、Task 4 の OIDC の続き。
- Produces: `totp(secret: string, at?: number): string`（`e2e/helpers/totp.ts`）。RFC 6238、SHA-1、6 桁、30 秒。`otpauth://` URI から取り出した base32 の secret を受ける。
- 設定：
  - `twoFactor({ issuer: "Sparklingstadt ID", twoFactorPage: "/two-factor", backupCodeOptions: { amount: 10 }, allowPasswordless: false })`。
  - `skipVerificationOnEnable` は false（コードの確認でオンになる）。
  - `twoFactorClient` の `onTwoFactorRedirect` は、OIDC の続きの情報を保ったまま `/two-factor`（言語つき）へ移る。

- [ ] **Step 1: 失敗するテストを書く。** `e2e/two-factor.spec.ts`：
  - `enables 2FA with a TOTP and shows 10 backup codes once`：
    - バックアップコードが 10 個出る。
    - `/account` を開き直すともう出ない。
    - 状態が「オン」。
  - `password sign-in asks for the TOTP and succeeds with it`。
  - `a wrong TOTP is refused and the 6th try is throttled`：5 回失敗すると、6 回目は正しいコードでも「しばらくしてから」。
  - `a backup code works once`：同じバックアップコードの 2 回目は拒否される。
  - `authorize with password and 2FA does not issue a code before the TOTP`：
    - authorize からパスワードでログインした直後の URL が `/two-factor` で、`redirect_uri` への 302 はまだ無い。
    - TOTP を入れたあと `code` が出る。
  - `password reset keeps 2FA`：再設定してから新しいパスワードでログインすると `/two-factor` に来る。
  - `disabling 2FA needs the password and then sign-in skips the code`。
- [ ] **Step 2: 失敗を確かめる。** `pnpm exec playwright test e2e/two-factor.spec.ts` が FAIL。
- [ ] **Step 3: 実装する。** プラグイン、制限の規則（`/two-factor/verify-totp` と `/two-factor/verify-backup-code` は `2fa:account:<userId>` で 5 回、`/two-factor/enable`・`/two-factor/disable` はパスワードの確認の規則）、画面、3 言語の文言を足す。
- [ ] **Step 4: 通ることを確かめる。**
  - `pnpm exec playwright test e2e/two-factor.spec.ts e2e/passkey.spec.ts` が PASS（fixme を外した 1 本も含む）。
  - `pnpm run test:unit` が PASS。
- [ ] **Step 5: コミットする。** `git commit -m "二要素認証（TOTP とバックアップコード）を足す"`

### Task 8: 取り込み・古いものの削除・手順書

**Files:**
- Create: `lib/id/legacy-import.ts`
- Create: `scripts/import-legacy.ts`（`package.json` に `"import:legacy"` を足す）
- Create: `prisma/migrations/<timestamp>_drop_legacy_tables/migration.sql`（`users`・`sessions`・`email_tokens`・`auth_codes` を消す。`throttles` は残す）
- Modify: `prisma/schema.prisma`（`Legacy*`・`EmailToken`・`AuthCode` を消す）
- Delete: 使われなくなった `lib/id/*`・`scripts/oidc-keygen.ts`・`scripts/oidc-client.ts` と、それらの単体テスト
- Modify: `README.md`（エンドポイント、環境変数、クライアントの登録 `pnpm run import:clients`、切り替えの手順、二要素認証をすべて失ったときに DB で外す SQL）、`.env.example`
- Test: `e2e/legacy-import.spec.ts`

**Interfaces:**
- Consumes: Task 4 の `importClients`。
- Produces: `importLegacy(prisma, env: { OIDC_CLIENTS?: string; OIDC_SIGNING_KEY?: string }): Promise<{ users: number; clients: number; key: "imported" | "skipped" }>`。
  - 今の `users` の各行から、同じ `id` で `user`（`email`・`name=display_name`・`emailVerified = email_verified_at is not null`）を作る。
  - `account` に `providerId: "credential"`・`accountId: id`・`password: password_hash` を作る。
  - 何度実行しても同じ結果になる（ある行は飛ばす）。
  - 署名鍵は、jwt プラグインの鍵の表に同じ `kid` で入れられれば `"imported"`、入れられなければ `"skipped"`（新しい鍵が自動で作られる）。

- [ ] **Step 1: 失敗するテストを書く。** `e2e/legacy-import.spec.ts` の `a legacy user keeps id and password after import`：
  1. 古い形の `users` の行（`hashPassword` で作ったハッシュ）を SQL で入れる。マイグレーションを消す前の段階で行う。
  2. `importLegacy` を実行する。
  3. `/login` でそのパスワードでログインできる。
  4. authorize で得た ID トークンの `sub` が、入れた `id` と同じ。
  5. 2 回目の `importLegacy` は `{ users: 0, … }`。
- [ ] **Step 2: 失敗を確かめる。** `pnpm exec playwright test e2e/legacy-import.spec.ts` が FAIL。
- [ ] **Step 3: 実装する。** `lib/id/legacy-import.ts` と `scripts/import-legacy.ts` を書く。
- [ ] **Step 4: 通ることを確かめる。** `pnpm exec playwright test e2e/legacy-import.spec.ts` が PASS。
- [ ] **Step 5: 古いものを消す。** 古い表のマイグレーションとコードを消し、`legacy-import.spec.ts` を、マイグレーションの前の状態を作るヘルパーで動くように直す（作る人の判断。難しければこの spec はコミット 1 つ前に残し、README に「取り込み済み」と書いてもよい）。
- [ ] **Step 6: README と `.env.example` を直す。** 本番の切り替えの手順は設計書の 5 章のとおりに書く。
- [ ] **Step 7: 全体を確かめる。** `pnpm run test:regression`（lint・unit・build・e2e）が PASS し、`rg -n "FFPF|Candy Rain" app lib messages` が 0 件。
- [ ] **Step 8: コミットする。** `git commit -m "持ち主のアカウントとクライアントの取り込みを足し、古い実装と表を消す"`
