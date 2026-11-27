# Sparklingstadt ID

Sparklingstadt のサービス共通のログイン窓口です。OpenID Connect（認可コードフロー + PKCE）のプロバイダーとして動き、ユーザーの登録・メール確認・ログイン・パスワード再設定・マイページを持ちます。ID サーバーでログインすれば、登録したどのクライアント（サービス）にも、パスワードを聞かずに入れます（SSO）。

- issuer：`https://id.sparklingstadt.com`（末尾スラッシュなし）
- Next.js 16 / Prisma 7 / Postgres（Neon）/ Vercel
- 言語：日本語（既定）・簡体字・繁体字。トップ（`/`）はマイページ（`/account`）へ送ります。

## エンドポイント

| パス | 役割 |
| --- | --- |
| `GET /.well-known/openid-configuration` | discovery |
| `GET /oauth/authorize` | 認可。`prompt=login`・`prompt=none` に対応。ログイン中ならパスワードなしでコードを返す |
| `POST /oauth/token` | コードを ID トークン・アクセストークンに換える（`client_secret_basic` / `client_secret_post`、PKCE は S256 のみ） |
| `GET /oauth/jwks` | 署名の公開鍵（JWKS） |
| `GET /oauth/userinfo` | アクセストークンで現在のプロフィール（`sub`・`email`・`email_verified`・`name`）を返す |
| `GET /oauth/logout` | RP-Initiated Logout 1.0。ログイン中の利用者の ID トークンが `id_token_hint` にあれば、そのままログアウトする。なければ確認の画面（`/logout`）を出す。`post_logout_redirect_uri` が登録と完全一致のときだけ戻す |

画面は `/signup`・`/login`・`/account`・`/verify`・`/forgot`・`/reset`・`/logout`・`/signed-out`（日本語は接頭辞なし、`/zh-cn/…`・`/zh-tw/…`）です。ID トークンは ES256 で署名し、クレームは `iss`・`sub`・`aud`・`iat`・`exp`・`auth_time`・`nonce`・`email`・`email_verified`・`name` です。`role` は返しません。

## 環境変数

| 名前 | 内容 |
| --- | --- |
| `ID_ISSUER` | issuer の origin（例 `https://id.sparklingstadt.com`） |
| `DATABASE_URL` | Postgres の接続文字列 |
| `DATABASE_URL_UNPOOLED` | 任意。マイグレーション（`prisma.config.ts`）だけが `DATABASE_URL` より先に使う直結の接続文字列 |
| `OIDC_SIGNING_KEY` | ID トークンの署名鍵（ES256 の秘密 JWK） |
| `OIDC_PREVIOUS_PUBLIC_KEYS` | 任意。鍵を替えたときの古い公開鍵の JSON 配列。JWKS に残す |
| `OIDC_CLIENTS` | 登録するクライアントの JSON 配列 |
| `RESEND_API_KEY` | メールを送る Resend の API キー |
| `MAIL_FROM` | メールの差出人（例 `Sparklingstadt ID <no-reply@sparklingstadt.com>`） |
| `MAIL_LOG` | 任意。E2E 用。メールを送らず、このファイルに JSON Lines で書く |

雛形は `.env.example` にあります。

## クライアントの登録

1. シークレットとクライアントの JSON を作ります。

   ```sh
   pnpm run oidc:client my-service
   ```

   `secret=…`（クライアントに渡す平文のシークレット）と、`secretHash` を含む JSON が出ます。シークレットは保存せず、ハッシュだけをサーバーに置きます。

2. その JSON に `redirectUris` と `postLogoutRedirectUris` を足し、`OIDC_CLIENTS`（配列）に入れます。

   ```json
   [
     {
       "id": "my-service",
       "name": "my-service",
       "secretHash": "<oidc:client が出したハッシュ>",
       "redirectUris": ["https://my-service.example.com/api/auth/callback/sparklingstadt"],
       "postLogoutRedirectUris": ["https://my-service.example.com/signed-out"]
     }
   ]
   ```

   `redirect_uri` と `post_logout_redirect_uri` は、登録した値と完全に一致したときだけ使えます。

3. `OIDC_CLIENTS` を DB（Better Auth の `oauthClient` の表、`ba_oauth_clients`）に取り込みます。サーバーはこの表を読みます。何度実行しても同じ結果になり、取り込んだクライアントのシークレットは変わりません。

   ```sh
   pnpm run oidc:import-clients
   ```

## 署名鍵

作り方：

```sh
pnpm run oidc:keygen
```

出力の 1 行（JWK）を `OIDC_SIGNING_KEY` に入れます。

交換するとき：新しい鍵を作って `OIDC_SIGNING_KEY` を替える前に、古い鍵の**公開鍵**（`d` を除いた JWK）を `OIDC_PREVIOUS_PUBLIC_KEYS`（JSON 配列）に足します。すると発行済みのトークンの検証が続き、JWKS には新旧の鍵が並びます。古いトークンの寿命（ID トークン・アクセストークンは 5 分）が過ぎたら、古い公開鍵を外します。

## 本番の設定

1. Vercel に `sparklingstadt-id` のプロジェクトと Neon の DB を作り、`id.sparklingstadt.com` をつなぎます（DNS）。
2. Resend で `sparklingstadt.com` を確認し、`RESEND_API_KEY` と `MAIL_FROM` を入れます。
3. 鍵とクライアントのシークレットを作り、`OIDC_CLIENTS` にクライアントを入れて、環境変数（上の表）を Vercel に設定します。
4. DB に表を作ります。

   ```sh
   pnpm run db:deploy
   pnpm run oidc:import-clients
   ```

5. 試行回数の制限は、クライアントの IP を `x-forwarded-for` から読みます（`lib/id/client-ip.ts`）。デプロイ先は Vercel だけを前提にしています。Vercel はこのヘッダーをクライアントの 1 つのアドレスで上書きするので信用できます。ほかの環境では、クライアントがヘッダーを書き換えられるため、アドレス 1 つだけの正しい値でなければ「不明」として数えます。
6. デプロイします。自分のアカウントを登録し、サービスを順に移します。

## 二要素認証を DB で外す

二要素認証（認証アプリの TOTP とバックアップコード）は、マイページで利用者が自分でオン・オフします。パスワードの再設定では外れません。認証アプリの端末もバックアップコードもすべて失い、パスキーでもログインできない場合は、持ち主が DB で外します。

1. 本人であることを確かめてから、Neon の SQL エディターなどで次を実行します（`<メールアドレス>` を置き換えます）。

   ```sql
   delete from ba_two_factors where user_id = (select id from ba_users where email = '<メールアドレス>');
   update ba_users set two_factor_enabled = false where email = '<メールアドレス>';
   ```

2. そのアカウントはパスワードだけでログインできるようになります。ログインしたら、マイページで二要素認証をもう一度オンにします（新しい QR コードとバックアップコードが出ます）。

## 開発

1. `.env.example` を `.env.local` にコピーします（Next.js と Prisma の設定が読むファイルです）。
2. `.env.local` に次を設定します。
   - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id`（`compose.yaml` の Postgres）
   - `DATABASE_URL_UNPOOLED` は同じ値にするか、行ごと消します（マイグレーションはこちらを先に使うので、雛形のままにしない）。
   - `ID_ISSUER=http://localhost:3000`
   - `OIDC_SIGNING_KEY`：`pnpm run oidc:keygen` の出力
   - `OIDC_CLIENTS`：`pnpm run oidc:client <id>` で作った JSON を配列に入れ、`redirectUris` を足す
   - `MAIL_LOG=/tmp/sparklingstadt-id-mail.jsonl`：`RESEND_API_KEY` なしで試すとき。メールはこのファイルに書かれ、確認リンクを読める
3. 起動します。

```sh
pnpm install
docker compose up -d --wait          # Postgres 17（127.0.0.1:55432）
pnpm run db:deploy
pnpm run oidc:import-clients         # OIDC_CLIENTS を DB へ
pnpm run dev
```

| コマンド | 内容 |
| --- | --- |
| `pnpm run test:unit` | 単体テスト |
| `pnpm run test:e2e` | Playwright の E2E（`pnpm run build` のあと。サーバー・クライアント・署名鍵は自動で用意） |
| `pnpm run test:regression` | lint・単体・ビルド・E2E をまとめて実行（CI と同じ） |
