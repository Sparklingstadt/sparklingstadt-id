# Sparklingstadt ID サーバー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `https://id.sparklingstadt.com` で動く OIDC プロバイダー「Sparklingstadt ID」を、新しいリポジトリ `sparklingstadt-id` に作る。

**Architecture:** ffpf-portal の FFPF ID（`lib/ffpf-id/`・`app/[locale]/id/`・`app/oauth/`・`app/.well-known/`・`scripts/oidc-*.ts`・テスト）を、名前を変えて新しい Next.js のアプリに移す。そのうえで、`prompt=none`、RP-Initiated Logout（`/oauth/logout`）、discovery の `end_session_endpoint` を足す。ほかの機能（告知・ブログ・管理画面）は持ってこない。

**Tech Stack:** Next.js 16.4（ffpf-portal と同じ版）、React 19、next-intl 4、Prisma 7 + `@prisma/adapter-pg`、Neon Postgres、Playwright、`node --test`、pnpm 11.25.0、Vercel。

**Spec:** `docs/superpowers/specs/2026-11-21-sparklingstadt-id-design.md`（土台：ffpf-portal の `docs/superpowers/specs/2026-10-27-ffpf-id-design.md`）

**移す元：** `/Users/liyur_qie/rossarte/ffpf-portal`（main、`94031d5` 時点）。以下、「元の `X`」はこのリポジトリのファイル。

**範囲外：** 4 つのクライアントのつなぎ替えと、FFPF ID・Candy Rain ID を止めること（設計書の 5 章）。それぞれのリポジトリで別に計画する。

## Global Constraints

- issuer は `https://id.sparklingstadt.com`（末尾スラッシュなし）。値は環境変数 `ID_ISSUER` から読む。
- 環境変数は `ID_ISSUER`・`DATABASE_URL`・`OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS`（任意）・`OIDC_CLIENTS`・`RESEND_API_KEY`・`MAIL_FROM`・`MAIL_LOG`（E2E 用、任意）。`FFPF_` で始まる名前は残さない。
- Cookie はログインが `sid_session`（30 日、`HttpOnly`・`SameSite=Lax`・`Path=/`・HTTPS では `Secure`）、言語が `NEXT_LOCALE`。
- 表は `users`・`sessions`・`email_tokens`・`auth_codes`・`throttles`。モデルは `User`・`Session`・`EmailToken`・`AuthCode`・`Throttle`。enum は `EmailTokenPurpose`。列は元の `prisma/schema.prisma` の `Ffpf*` と同じ。
- 言語は `ja`・`zh-cn`・`zh-tw` で、既定は `ja`、`localePrefix: "as-needed"`、`localeDetection: false`（元の `i18n/routing.ts` と同じ）。
- 画面のパスは `/signup`・`/login`・`/account`・`/verify`・`/forgot`・`/reset`（言語の接頭辞は `as-needed`）。`/` は `/account` へ送る。
- 画面・メール・エラーページ・`<title>` に出す名前は「Sparklingstadt ID」。`FFPF`・`ffpf` の文字はリポジトリのどこにも残さない（Task 1 の検査が守る）。
- ID トークンのクレームは元と同じ（`iss`・`sub`・`aud`・`iat`・`exp`・`auth_time`・`nonce`・`email`・`email_verified: true`・`name`）。`role` は返さない。
- 署名は ES256。トークンとコードの寿命、試行回数の制限、パスワードの規則は元と同じ。

## Review Focus

1. **別のクライアントに登録された戻り先でのログアウト**：`client_id=A` に B の `post_logout_redirect_uri` を付けても戻らず、「ログアウトしました」の画面になる（Task 5 のテスト `rejects another client's post-logout URI`）。
2. **ログインしていないときのログアウト**：Cookie が無くても、登録した戻り先へ `state` 付きで戻る。何度押しても同じ（Task 5 の `logout without a session still redirects`）。
3. **`prompt=none` でメールが未確認**：確認画面へは送らず、`error=interaction_required` で戻す（Task 4 の `prompt=none with unverified email`）。
4. **`prompt=none login` を一緒に送る**：`error=invalid_request` で戻す（Task 4 の `prompt none and login together`）。
5. **パスワードの再設定で古くなったセッションでの `prompt=none`**：`error=login_required` で戻す（Task 4 の `prompt=none with a revoked session`）。

---

### Task 1: リポジトリの土台と、名前を変えたライブラリ

**Files:**

- Create: `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`postcss.config.mjs`、`prisma.config.ts`、`.env.example`、`.gitignore`、`AGENTS.md`、`CLAUDE.md`
- Create: `prisma/schema.prisma`、`prisma/migrations/<timestamp>_init/migration.sql`
- Create: `lib/prisma.ts`、`lib/id/{accounts,authorization,client-ip,clients,config,jwt,mail-templates,mailer,pkce,prompt,session,throttle,tokens,validation}.ts`
- Create: `i18n/{routing,navigation,request}.ts`、`proxy.ts`
- Create: `scripts/oidc-keygen.ts`、`scripts/oidc-client.ts`
- Test: `tests/id/*.test.ts`（元の `tests/ffpf-id/*.test.ts` を移す）、`tests/no-ffpf-name.test.ts`

**Interfaces:**

- Produces: `lib/id/` は元の `lib/ffpf-id/` と同じ export（`getOidcConfig()`、`getCurrentUser()`、`createSession()`、`destroySession()`、`revokeSessions()`、`issueAuthCode()`、`redeemAuthCode()`、`authorizeError()`、`redirectToClient()`、`findClient()`、`authenticateClient()`、`isRegisteredRedirect()`、`parseBasicCredentials()`、`signJwt()`、`verifyJwt()`、`wantsLogin()`、`authorizePathWithoutPrompt()` など）。名前だけが変わる：Prisma のモデルは `User`・`Session`・…、`getPrisma().user` など。
- `OidcClient` に `postLogoutRedirectUris: string[]` を足す（Task 5 が使う。JSON に無ければ `[]`。あれば http(s) の URL の配列でなければ例外）。

- [ ] **Step 1:** 元の `package.json` から、FFPF ID に要る依存だけを残した `package.json` を作る（`next`・`react`・`react-dom`・`next-intl`・`@prisma/client`・`@prisma/adapter-pg`・`pg`・Tailwind・shadcn に要るもの。`next-auth`・MDX・`yaml`・Cloudflare・ブログの workspace は入れない）。scripts は元の `dev`・`build`・`start`・`lint`・`test:unit`（`tests/**/*.test.ts`）・`test:e2e`・`oidc:keygen`・`oidc:client`・`db:*`・`postinstall`、それに `test:regression`（`lint && test:unit && build && test:e2e`）。`packageManager` は `pnpm@11.25.0`。
- [ ] **Step 2:** `prisma/schema.prisma` を、元の `Ffpf*` のモデルを Global Constraints の名前にしたものにし、`pnpm prisma migrate dev --name init` で最初のマイグレーションを作る。
- [ ] **Step 3:** `lib/ffpf-id/` を `lib/id/` に、`tests/ffpf-id/` を `tests/id/` に移し、環境変数・Cookie・モデル・文言を Global Constraints の名前に変える。`clients.ts` のエラーメッセージの `FFPF_OIDC_CLIENTS` は `OIDC_CLIENTS` に。
- [ ] **Step 4: 失敗するテストを書く** — `tests/id/clients.test.ts` に：

```ts
test("postLogoutRedirectUris defaults to []", () => {
  const [c] = parseClients(
    JSON.stringify([
      {
        id: "a",
        name: "A",
        secretHash: "0".repeat(64),
        redirectUris: ["https://a.example/cb"],
      },
    ]),
  );
  assert.deepEqual(c.postLogoutRedirectUris, []);
});
test("postLogoutRedirectUris must be http(s) URLs", () => {
  assert.throws(
    () =>
      parseClients(
        JSON.stringify([
          {
            id: "a",
            name: "A",
            secretHash: "0".repeat(64),
            redirectUris: ["https://a.example/cb"],
            postLogoutRedirectUris: ["javascript:alert(1)"],
          },
        ]),
      ),
    /OIDC_CLIENTS\[0\]\.postLogoutRedirectUris/,
  );
});
```

`tests/no-ffpf-name.test.ts`：`git ls-files` の全ファイル（`docs/` と `pnpm-lock.yaml` を除く）を読み、`/ffpf/i` に当たるファイルが 0 であること。

- [ ] **Step 5:** `pnpm run test:unit` → 上の 3 つが FAIL。
- [ ] **Step 6:** `parseClients` に `postLogoutRedirectUris` を足す。残っている `ffpf` を直す。
- [ ] **Step 7:** `pnpm run test:unit` → 全部 PASS。`pnpm run lint` → 警告 0。
- [ ] **Step 8:** Commit `chore: Sparklingstadt ID の土台と、FFPF ID から移したライブラリ`

### Task 2: アカウントの画面とメール

**Files:**

- Create: `app/layout.tsx`、`app/page.tsx`（`/account` へ redirect）、`app/[locale]/layout.tsx`、`app/[locale]/{signup,login,account,verify,forgot,reset}/…`、`app/[locale]/_components/…`、`app/[locale]/actions.ts`、`app/globals.css`
- Create: `messages/{ja,zh-cn,zh-tw}.json`（元の `FfpfId` 名前空間を `Id` にして、「FFPF ID」を「Sparklingstadt ID」に）
- Create: `playwright.config.ts`、`e2e/account.spec.ts`（元の `e2e/ffpf-id.spec.ts` を移す）

**Interfaces:**

- Consumes: Task 1 の `lib/id/*`。
- Produces: ログイン画面 `/login?next=<path>[&reauth=1]`、マイページ `/account`（`?verify=required` を受ける）。Task 3 と Task 4 がここへ送る。

- [ ] **Step 1:** 元の `app/[locale]/id/**` を `app/[locale]/**` に移し、`/id/...` へのリンクと `getPathname({ href: "/id/..." })` を Global Constraints のパスに直す。元の `/id`（マイページ）は `/account` に。ヘッダーは「Sparklingstadt ID」の名前と、言語の切り替え、ログイン中なら表示名だけにする（告知のサイトのナビは持ってこない）。
- [ ] **Step 2:** 元の `e2e/ffpf-id.spec.ts` を `e2e/account.spec.ts` に移し、パスと文言を直す。`playwright.config.ts` の `webServer` は Next.js だけ（ブログは無い）で、`MAIL_LOG` と E2E 用の `OIDC_CLIENTS`・`OIDC_SIGNING_KEY` を渡す。
- [ ] **Step 3:** E2E を足す：`/` を開くと `/account` に、未ログインならさらに `/login?next=%2Faccount` に着く。`/zh-cn/login` は簡体字で出る。
- [ ] **Step 4:** `pnpm run build && pnpm run test:e2e e2e/account.spec.ts` → PASS。
- [ ] **Step 5:** Commit `feat: アカウントの画面とメールを移す`

### Task 3: OIDC のエンドポイントを移す

**Files:**

- Create: `app/oauth/{authorize,token,jwks,userinfo}/route.ts`、`app/.well-known/openid-configuration/route.ts`
- Create: `e2e/oidc.spec.ts`（元の `e2e/oidc.spec.ts` を移す）

**Interfaces:**

- Consumes: Task 1 の `lib/id/*`、Task 2 のログイン画面のパス。
- Produces: `GET /oauth/authorize` の流れ（Task 4 が `prompt` の分岐を足す）、discovery の応答（Task 5 が項目を足す）。

- [ ] **Step 1:** 元の 5 つの route を移す。authorize のログインへの送り先は `getPathname({ href: "/login", locale })`、メール未確認の送り先は `getPathname({ href: "/account", locale })?verify=required`。エラーページの `<title>` と `<h1>` は「Sparklingstadt ID」。
- [ ] **Step 2:** 元の `e2e/oidc.spec.ts` を移し、パスを直す。
- [ ] **Step 3:** `pnpm run build && pnpm run test:e2e e2e/oidc.spec.ts` → PASS。
- [ ] **Step 4:** Commit `feat: OIDC のエンドポイントを移す`

### Task 4: `prompt=none`

**Files:**

- Modify: `lib/id/prompt.ts`、`app/oauth/authorize/route.ts`、`app/.well-known/openid-configuration/route.ts`
- Test: `tests/id/prompt.test.ts`、`e2e/oidc.spec.ts`

**Interfaces:**

- Produces: `parsePrompt(prompt: string | null): { login: boolean; none: boolean }`（`wantsLogin` を置き換える）。

- [ ] **Step 1: 失敗するテストを書く** — `tests/id/prompt.test.ts`：`parsePrompt(null)` → `{login:false,none:false}`、`parsePrompt("none")` → `{login:false,none:true}`、`parsePrompt("login consent")` → `{login:true,none:false}`、`parsePrompt("none login")` → `{login:true,none:true}`。
- [ ] **Step 2:** E2E を足す（`e2e/oidc.spec.ts`。リダイレクトを追わずに `Location` を見る）：
  - `prompt=none signed in` → `redirect_uri?code=…&state=s`
  - `prompt=none signed out` → `redirect_uri?error=login_required&state=s`
  - `prompt=none with unverified email` → `error=interaction_required`
  - `prompt none and login together` → `error=invalid_request`
  - `prompt=none with a revoked session`（ログイン → 別の Cookie でパスワード再設定 → 古い Cookie で authorize）→ `error=login_required`
- [ ] **Step 3:** `pnpm run test:unit` と E2E → 新しいものが FAIL。
- [ ] **Step 4:** `parsePrompt` を実装する。authorize では、クライアントの検証（手順 1・2）のあと、`none && login` なら `invalid_request`。`none` なら、未ログインで `login_required`、メール未確認で `interaction_required` を `authorizeError` で返し、ログインの画面へは送らない。discovery に `prompt_values_supported: ["none", "login"]` を足す。
- [ ] **Step 5:** テスト → PASS。
- [ ] **Step 6:** Commit `feat: 認可で prompt=none に対応する`

### Task 5: ログアウト（RP-Initiated Logout）

**Files:**

- Create: `lib/id/logout.ts`、`app/oauth/logout/route.ts`、`app/[locale]/signed-out/page.tsx`
- Modify: `app/.well-known/openid-configuration/route.ts`、`messages/*.json`（`Id.signedOut` の文言）
- Test: `tests/id/logout.test.ts`、`e2e/logout.spec.ts`

**Interfaces:**

- Consumes: Task 1 の `OidcClient.postLogoutRedirectUris`、`destroySession()`、`verifyJwt()`、`getOidcConfig()`。
- Produces: `resolvePostLogoutRedirect(config: OidcConfig, params: URLSearchParams): string | null` — 戻り先の完全な URL（`state` があれば付ける）か、戻さないなら `null`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/id/logout.test.ts`（クライアント A に `https://a.example/signout`、B に `https://b.example/signout` を登録した config）：
  - `client_id=a&post_logout_redirect_uri=https://a.example/signout&state=x` → `"https://a.example/signout?state=x"`
  - `rejects another client's post-logout URI`：`client_id=a&post_logout_redirect_uri=https://b.example/signout` → `null`
  - `client_id` 無し、`id_token_hint` が A 向けにこのサーバーが署名した ID トークン（期限切れでもよい）→ A の URI を受け付ける
  - `id_token_hint` の署名が違う → `null`
  - `client_id=a` と `id_token_hint` の `aud=b` が食い違う → `null`
  - `post_logout_redirect_uri` が無い → `null`
- [ ] **Step 2:** E2E を足す（`e2e/logout.spec.ts`）：
  - ログイン → `/oauth/logout?client_id=…&post_logout_redirect_uri=<登録した URI>&state=s` → その URI に `?state=s` で戻り、`sid_session` が消え、DB の `sessions` の行も無い。続く authorize はログインの画面へ。
  - `logout without a session still redirects`：Cookie 無しで同じ URL → 同じく戻る。
  - 登録していない戻り先 → `/signed-out` の画面（「ログアウトしました」）。
  - discovery に `end_session_endpoint: "<issuer>/oauth/logout"` がある。
- [ ] **Step 3:** テスト → FAIL。
- [ ] **Step 4:** `resolvePostLogoutRedirect` を実装する。`id_token_hint` は `verifyJwt` で署名と `iss` だけを確かめ、`exp` は見ない。route は `GET` だけで、まず `destroySession()`、次に戻り先があれば 302、無ければ言語の `/signed-out` へ 302。応答は `Cache-Control: no-store`。discovery に `end_session_endpoint` を足す。
- [ ] **Step 5:** テスト → PASS。
- [ ] **Step 6:** Commit `feat: RP-Initiated Logout を足す`

### Task 6: SSO の確かめと、運用の文書

**Files:**

- Create: `e2e/sso.spec.ts`、`README.md`、`.github/workflows/regression.yml`
- Modify: `.env.example`

- [ ] **Step 1:** E2E を足す（`e2e/sso.spec.ts`）：E2E 用の `OIDC_CLIENTS` にクライアントを 2 つ（`client-a`・`client-b`）入れる。A の authorize でログインしてコードを受け取ったあと、同じブラウザーで B の authorize を開くと、ログイン画面を経ずに B の `redirect_uri?code=…` に戻る。B のコードを B のシークレットで交換した ID トークンの `sub` は、A のものと同じ。
- [ ] **Step 2:** `pnpm run test:e2e e2e/sso.spec.ts` → PASS（Task 3 までで動くはず。落ちたら Task 3 に戻って直す）。
- [ ] **Step 3:** `README.md` を書く。何をするサーバーか、エンドポイントの表（discovery・authorize・token・jwks・userinfo・logout）、環境変数の表（Global Constraints の 8 つ）、クライアントの登録（`pnpm run oidc:client <id>` と `OIDC_CLIENTS` の JSON。`postLogoutRedirectUris` を含む例）、鍵の作り方と交換、本番の設定の手順（設計書の 6 章：Vercel のプロジェクトと Neon、`id.sparklingstadt.com` の DNS、Resend で `sparklingstadt.com` を確認、`pnpm run db:deploy`）。
- [ ] **Step 4:** CI は元の `.github/workflows/regression.yml` を土台にし、Postgres のサービスで `pnpm run test:regression` を回す。
- [ ] **Step 5:** `pnpm run test:regression` → 全部 PASS。
- [ ] **Step 6:** Commit `docs: README と CI`

---

## 実行の前に持ち主に頼むこと

- GitHub に `Sparklingstadt/sparklingstadt-id` を作ること（公開）。作業はそれまでローカルの `git init` で進められる。
- 新しいリポジトリを置く場所（例 `/Users/liyur_qie/rossarte/sparklingstadt-id`）への書き込み。今のセッションの sandbox は ffpf-zhuelog の中にしか書けない。
- 本番の設定（Vercel・Neon・DNS・Resend）は持ち主が行う。このプランの中では本番に触らない。
