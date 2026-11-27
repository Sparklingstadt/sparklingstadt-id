# Sparklingstadt ID

Sparklingstadt のサービス共通のログイン窓口です。OpenID Connect（認可コードフロー + PKCE）のプロバイダーとして動き、ユーザーの登録・メール確認・ログイン（パスワード・パスキー）・二要素認証・パスワード再設定・マイページを持ちます。認証の部分は [Better Auth](https://www.better-auth.com/) 1.7.28（`lib/auth.ts`）です。ID サーバーでログインすれば、登録したどのクライアント（サービス）にも、パスワードを聞かずに入れます（SSO）。

- issuer：`https://id.sparklingstadt.com`（末尾スラッシュなし）
- Next.js 16 / Prisma 7 / Postgres（Neon）/ Better Auth / Vercel
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

`/oauth/*` は、Better Auth の OIDC プロバイダー（`/api/auth/oauth2/*`・`/api/auth/jwks`）へ同じ動きでつないだ URL です。クライアントに渡す URL は変わりません（discovery が載せる URL もこの `/oauth/*`）。そのほか、Better Auth 自身の API が `/api/auth/*` にあります（メール・パスワードの登録とログイン、パスキー、二要素認証、セッション）。生きているかの確認は `GET /api/auth/ok`（200 と `{"ok":true}`）です。

画面は `/signup`・`/login`・`/account`・`/verify`・`/forgot`・`/reset`・`/logout`・`/signed-out`（日本語は接頭辞なし、`/zh-cn/…`・`/zh-tw/…`）です。ID トークンは ES256 で署名し（鍵は Better Auth の jwt プラグインの表 `ba_jwks`）、クレームは `iss`・`sub`・`aud`・`iat`・`exp`・`auth_time`・`nonce`・`email`・`email_verified`・`name` です。`role` は返しません。

## 環境変数

| 名前 | 内容 |
| --- | --- |
| `ID_ISSUER` | issuer の origin（例 `https://id.sparklingstadt.com`） |
| `DATABASE_URL` | Postgres の接続文字列 |
| `DATABASE_URL_UNPOOLED` | 任意。マイグレーション（`prisma.config.ts`）だけが `DATABASE_URL` より先に使う直結の接続文字列 |
| `BETTER_AUTH_SECRET` | Better Auth が署名・暗号化（メールのリンク、二要素認証の秘密、署名鍵の秘密鍵）に使う秘密。32 文字以上のランダムな値（`openssl rand -base64 32`）。**本番で必須。** 替えると、暗号化した二要素認証の秘密と署名鍵が読めなくなる |
| `OIDC_CLIENTS` | クライアントの JSON 配列。サーバーは読まず、`pnpm run import:clients` が DB へ取り込むときだけ使う |
| `RESEND_API_KEY` | メールを送る Resend の API キー |
| `MAIL_FROM` | メールの差出人（例 `Sparklingstadt ID <no-reply@sparklingstadt.com>`） |
| `MAIL_LOG` | 任意。E2E 用。メールを送らず、このファイルに JSON Lines で書く |

前の実装の `OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS` は使いません（署名鍵は `ba_jwks` にあります）。

雛形は `.env.example` にあります。

## クライアントの登録

1. シークレットを作り、そのハッシュ（SHA-256 の 16 進）を求めます。シークレットはクライアントに渡し、サーバーにはハッシュだけを置きます。

   ```sh
   SECRET="$(openssl rand -base64 32)"; echo "secret=$SECRET"
   printf %s "$SECRET" | shasum -a 256 | cut -d' ' -f1   # secretHash
   ```

2. `OIDC_CLIENTS`（JSON 配列）にクライアントを足します。

   ```json
   [
     {
       "id": "my-service",
       "name": "my-service",
       "secretHash": "<上のハッシュ>",
       "redirectUris": ["https://my-service.example.com/api/auth/callback/sparklingstadt"],
       "postLogoutRedirectUris": ["https://my-service.example.com/signed-out"]
     }
   ]
   ```

   `redirect_uri` と `post_logout_redirect_uri` は、登録した値と完全に一致したときだけ使えます。

3. `OIDC_CLIENTS` を DB（`ba_oauth_clients`）に取り込みます。サーバーはこの表を読みます。何度実行しても同じ結果になり、取り込んだクライアントのシークレットは変わりません。

   ```sh
   pnpm run import:clients --env-file=production.env   # またはシェルに明示的に設定して引数なしで
   ```

   `import:clients` は `.env.local` を読みません。`DATABASE_URL` と `OIDC_CLIENTS` をシェルで明示的に設定するか、1 つのファイルを `--env-file=<パス>` で渡します（足りなければ止まります）。どの値がどこから来たか（値そのものではなく、シェルかファイルか）と、つなぐ DB のホスト名が出るので、取り込む先の DB か確かめます。

**`OIDC_CLIENTS` から外したクライアントは、再び取り込んでも DB に残り、有効なままです。** 使えなくするには DB で無効にするか、消します（消すと、そのクライアントのトークンと同意も消えます）。

```sql
update ba_oauth_clients set disabled = true where client_id = '<クライアント ID>';
-- 完全に消すとき
delete from ba_oauth_clients where client_id = '<クライアント ID>';
```

一覧に載っているクライアントを取り込むと、`disabled` は `false` に戻ります。

## 署名鍵

ID トークンの署名鍵（ES256）は Better Auth の jwt プラグインが `ba_jwks` に作り、秘密鍵は `BETTER_AUTH_SECRET` で暗号化して置きます。最初のトークンを発行するときに、鍵がなければ自動で作られます。署名には一番新しい鍵を使い、古い鍵の公開鍵も JWKS（`/oauth/jwks`）に並びます。

前の実装の鍵は、切り替えのときに同じ `kid` のまま `ba_jwks` に取り込んであります。鍵を自動で入れ替える設定（jwt プラグインの `jwks.rotationInterval`）はしていないので、同じ鍵で署名を続けます。

## 本番の切り替え（前の実装から・済み）

前の実装（自作の OIDC）から Better Auth への切り替えは済んでいます。持ち主のアカウント（`id` はそのまま）、パスワードのハッシュ、クライアント、署名鍵（`kid` もそのまま）を、1 回だけのスクリプト `pnpm run import:legacy` で Better Auth の表に移しました。手順は設計書（`docs/superpowers/specs/2026-11-26-better-auth-migration-design.md` の 4.6・5 章）にあります。

そのあと、古い表（`users`・`sessions`・`email_tokens`・`auth_codes`）はマイグレーション `20261127120000_drop_legacy_tables` で消し、取り込みのスクリプトと前の実装の環境変数（`OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS`）の読み取りも消しました。`throttles` は今も使っています。このマイグレーションは、`users` に `ba_users` にない行が残っていると止まります（データは消えません）。その場合は、このマイグレーションの 1 つ前のコミットで `pnpm run import:legacy` を実行してから当て直します。

**手元から本番の DB を操作するときの約束。** `prisma.config.ts`（マイグレーション）は `.env.local` を読み、`DATABASE_URL_UNPOOLED` を `DATABASE_URL` より先に使います。手元の開発用の値が本番に混ざらないように、次のどちらかにします。

- 本番の値を、同じシェルで明示的に設定する（`DATABASE_URL` と `DATABASE_URL_UNPOOLED` の両方。同じ DB を指すこと）。
- 作業のあいだ `.env.local` を別の名前にしておく。

`import:clients` に本番の値を渡すファイルは `vercel env pull production.env --environment=production` で作れます。その場合、次の点を直してから使います。

- 値は単一引用符で囲みます（`OIDC_CLIENTS='[{"id":"…"}]'`）。二重引用符で囲んだ値の中に `"` があると、ファイルの読み込み（Node.js の `parseEnv`）がそこで値を切り、JSON として読めなくなります。`DATABASE_URL` の `&` も、シェルに貼るときは単一引用符が要ります。
- 同じ名前の行が 2 つあると後ろの行が使われます。Vercel で「Sensitive」にした変数は空の行（`NAME=""`）で書き出されるので、足した行と重ならないよう空の行を消します。
- 使い終わったファイルはすぐ消します（本番のシークレットが入っています）。

## 本番の設定

1. Vercel に `sparklingstadt-id` のプロジェクトと Neon の DB を作り、`id.sparklingstadt.com` をつなぎます（DNS）。
2. Resend で `sparklingstadt.com` を確認し、`RESEND_API_KEY` と `MAIL_FROM` を入れます。
3. `BETTER_AUTH_SECRET` を作り（`openssl rand -base64 32`）、環境変数（上の表）を Vercel に設定します。クライアントのシークレットを作り、`OIDC_CLIENTS` に入れます。
4. DB に表を作ります。`db:deploy` は上の「手元から本番の DB を操作するときの約束」のとおりに、`import:clients` は本番の `DATABASE_URL` と `OIDC_CLIENTS` を明示して実行します（`.env.local` は読みません）。

   ```sh
   pnpm run db:deploy
   pnpm run import:clients --env-file=production.env
   ```

5. 試行回数の制限は、クライアントの IP を `x-forwarded-for` から読みます（`lib/id/client-ip.ts`）。デプロイ先は Vercel だけを前提にしています。Vercel はこのヘッダーをクライアントの 1 つのアドレスで上書きするので信用できます。ほかの環境では、クライアントがヘッダーを書き換えられるため、アドレス 1 つだけの正しい値でなければ「不明」として数えます。
6. デプロイします。ログインできるのは本番のドメイン（`ID_ISSUER`）だけです。Vercel のプレビューデプロイ（`*.vercel.app`）では、Better Auth が Origin を `ID_ISSUER` と比べて断り、パスキーも `rpID`（`ID_ISSUER` のホスト名）が合わないため、ログインできません。プレビューは画面を見るためだけに使います。
7. デプロイのあと、`https://<issuer>/api/auth/ok` が 200 を返すことを確かめます（`BETTER_AUTH_SECRET` が足りないことは、ビルドでは分からず（ビルドは仮の値で通る）、最初のリクエストで初めて出ます）。続けて、自分のアカウントを登録し、サービスを順に移します。

## 二要素認証を DB で外す

二要素認証（認証アプリの TOTP とバックアップコード）は、マイページで利用者が自分でオン・オフします。パスワードの再設定では外れません（パスキーは、再設定ですべて消えます。もう一度登録します。パスキーを足すときは、パスワードを入れる決まりです。盗まれたセッションの Cookie だけでは足せません。サーバーが、同じセッションが 5 分以内にパスワードを確かめたことを求め、登録で使い切ります。間違いは、ほかのパスワード確認と合わせて 5 回 / 15 分までです）。TOTP のコードは、30 秒の有効期間のうちなら同じコードをもう一度使えます（使ったコードを覚えておく仕組みはありません。スペックも求めていません）。間違ったコードはアカウントごとに 5 回までです。認証アプリの端末もバックアップコードもすべて失い、パスキーでもログインできない場合は、持ち主が DB で外します。

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
   - `BETTER_AUTH_SECRET`：32 文字以上の適当な値
   - `OIDC_CLIENTS`：「クライアントの登録」の JSON（`redirectUris` は `http://localhost:…`）
   - `MAIL_LOG=/tmp/sparklingstadt-id-mail.jsonl`：`RESEND_API_KEY` なしで試すとき。メールはこのファイルに書かれ、確認リンクを読める
3. 起動します。

```sh
pnpm install
docker compose up -d --wait          # Postgres（127.0.0.1:55432）
pnpm run db:deploy
pnpm run import:clients --env-file=.env.local   # OIDC_CLIENTS を DB へ（.env.local は名指ししたときだけ読む）
pnpm run dev
```

| コマンド | 内容 |
| --- | --- |
| `pnpm run import:clients` | `OIDC_CLIENTS` を DB に取り込む（値はシェルか `--env-file=<パス>` から。`.env.local` は読まない） |
| `pnpm run test:unit` | 単体テスト |
| `pnpm run test:e2e` | Playwright の E2E（`pnpm run build` のあと。サーバー・クライアント・署名鍵は自動で用意） |
| `pnpm run test:regression` | lint・単体・ビルド・E2E をまとめて実行（CI と同じ） |
