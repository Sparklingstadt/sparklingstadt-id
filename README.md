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
| `OIDC_SIGNING_KEY` | 任意。前の実装の署名鍵（ES256 の秘密 JWK）。`pnpm run import:legacy` が 1 回だけ使う（切り替えのときだけ）。サーバーは読まない |
| `RESEND_API_KEY` | メールを送る Resend の API キー |
| `MAIL_FROM` | メールの差出人（例 `Sparklingstadt ID <no-reply@sparklingstadt.com>`） |
| `MAIL_LOG` | 任意。E2E 用。メールを送らず、このファイルに JSON Lines で書く |

`OIDC_PREVIOUS_PUBLIC_KEYS` は使いません（古い鍵は `ba_jwks` に残り、JWKS に並びます）。

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
   pnpm run import:clients
   ```

**`OIDC_CLIENTS` から外したクライアントは、再び取り込んでも DB に残り、有効なままです。** 使えなくするには DB で無効にするか、消します（消すと、そのクライアントのトークンと同意も消えます）。

```sql
update ba_oauth_clients set disabled = true where client_id = '<クライアント ID>';
-- 完全に消すとき
delete from ba_oauth_clients where client_id = '<クライアント ID>';
```

一覧に載っているクライアントを取り込むと、`disabled` は `false` に戻ります。

## 署名鍵

ID トークンの署名鍵（ES256）は Better Auth の jwt プラグインが `ba_jwks` に作り、秘密鍵は `BETTER_AUTH_SECRET` で暗号化して置きます。最初のトークンを発行するときに、鍵がなければ自動で作られます。署名には一番新しい鍵を使い、古い鍵の公開鍵も JWKS（`/oauth/jwks`）に並びます。

前の実装の鍵を引き継ぐ（同じ `kid` で署名を続ける）のは、`pnpm run import:legacy` の仕事です（下の「本番の切り替え」）。同じ方法で、新しい鍵に替えることもできます。新しい鍵（`kid` は公開鍵の RFC 7638 サムプリント）を作って `OIDC_SIGNING_KEY` に入れ、`pnpm run import:legacy` を実行すると、その鍵が一番新しい鍵になり、古い鍵は JWKS に残ります。

## 本番の切り替え（前の実装から）

前の実装（自作の OIDC）から Better Auth へ移すための、1 回だけの手順です。持ち主のアカウント（`id` はそのまま。各クライアントが持つ `sub` が変わりません）、パスワードのハッシュ、`OIDC_CLIENTS`、署名鍵（`kid` もそのまま）を移します。ログインのセッションは切れるので、移したあとにもう一度ログインします。各サービス側のセッションはそのままです。

**手元から本番の DB を操作するときの約束。** `prisma.config.ts`（マイグレーション）は `.env.local` を読み、`DATABASE_URL_UNPOOLED` を `DATABASE_URL` より先に使います。手元の開発用の値が本番に混ざらないように、次のどちらかにします。

- 本番の値を、同じシェルで明示的に設定する（`DATABASE_URL` と `DATABASE_URL_UNPOOLED` の両方。同じ DB を指すこと）。
- 作業のあいだ `.env.local` を別の名前にしておく。

`import:legacy` は `.env.local` を読みません。次の値をシェルで明示的に設定するか、本番の値だけを書いた 1 つのファイルを `--env-file=<パス>` で渡します（どれか 1 つでも足りなければ止まります）。どの値がどこから来たか（値そのものではなく、シェルかファイルか）と、つなぐ DB のホスト名が出るので、本番の DB と同じか確かめます。

| 名前 | 値 |
| --- | --- |
| `DATABASE_URL` | 本番の DB |
| `BETTER_AUTH_SECRET` | **Vercel の値とバイト単位で同じもの**（空白や改行も含めて）。違うと、取り込んだ署名鍵をサーバーが復号できず、トークンの発行がすべて失敗する |
| `OIDC_SIGNING_KEY` | 今の本番の署名鍵（Vercel の値） |
| `OIDC_CLIENTS` | 今の本番のクライアント（Vercel の値） |
| `ID_ISSUER` | 本番の issuer |

手順（スペック 5 章の順）：

1. Vercel に `BETTER_AUTH_SECRET` を足します（まだ再デプロイしない）。`OIDC_CLIENTS` と `OIDC_SIGNING_KEY` はそのまま残します。
2. 表を足します。足すだけなので、今動いている古いコードは `ba_*` の表を使わず、影響を受けません。

   ```sh
   pnpm run db:deploy
   ```

3. 取り込みを実行します。

   ```sh
   pnpm run import:legacy --env-file=production.env   # またはシェルに明示的に設定して引数なしで
   ```

   `users` の行を `ba_users`・`ba_accounts` に移し、`OIDC_CLIENTS` を取り込み、`OIDC_SIGNING_KEY` を `ba_jwks` に同じ `kid` で入れます。結果は `{"users":1,"clients":N,"key":"imported"}` のような 1 行です。何度実行しても同じ結果になります。
   - `key` が `"skipped"` のときは、鍵が正しくないか、同じ `kid` がすでにあります（新しい鍵が自動で作られ、クライアントは JWKS を読み直すので動きます）。
   - **同じメールアドレスの別の `ba_users` の行があると、取り込みはエラーで止まります**（両方の `id` が表示されます）。手順 1 から 3 のあいだに新しい `/signup` で同じアドレスを登録したときなどです。持ち主の `sub` を変えないため、飛ばさずに止めます。その `ba_users` の行を消して（`delete from ba_users where id = '<表示された新しい方の id>';`。パスワードやセッションも一緒に消えます）、もう一度実行します。
   - **`BETTER_AUTH_SECRET` が Vercel と違う値で鍵を取り込んでしまったとき**：その鍵が一番新しい鍵になり、サーバーは復号できず、トークンの発行がすべて失敗します。その行を `kid`（取り込んだ `OIDC_SIGNING_KEY` の `kid`）で消して、正しい値で取り込み直します。

     ```sql
     delete from ba_jwks where id = '<kid>';
     ```

4. 新しいコードをデプロイします。
5. `https://<issuer>/api/auth/ok` が 200 を返すことを確かめます。続けて、typle-r などのすべてのクライアントで「Sparklingstadt ID でログイン」が、同じアカウントで、設定を何も変えずに動くことを確かめます。動かなければ、Vercel の「Instant Rollback」で前のデプロイに戻せます（古い表はまだあるので、古いコードはそのまま動きます）。
6. `/account` でパスキーを登録し、二要素認証をオンにします。ログインのセッションは切れているので、先にログインし直します。
7. すべて確かめたら、別の PR で古いものを消します。`docs/cutover/drop-legacy-tables.sql`（`users`・`sessions`・`email_tokens`・`auth_codes` を消す SQL。`throttles` は残る）をマイグレーションにし、`schema.prisma` から `Legacy*`・`EmailToken`・`AuthCode` を消し、Vercel の古い環境変数（`OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS`、`OIDC_CLIENTS`）を消します。その SQL は、`users` に `ba_users` にない行が残っていると `users holds accounts that are not in ba_users yet: run "pnpm run import:legacy" first` と言って止まります（データは消えません）。

## 本番の設定

1. Vercel に `sparklingstadt-id` のプロジェクトと Neon の DB を作り、`id.sparklingstadt.com` をつなぎます（DNS）。
2. Resend で `sparklingstadt.com` を確認し、`RESEND_API_KEY` と `MAIL_FROM` を入れます。
3. `BETTER_AUTH_SECRET` を作り（`openssl rand -base64 32`）、環境変数（上の表）を Vercel に設定します。クライアントのシークレットを作り、`OIDC_CLIENTS` に入れます。
4. DB に表を作ります。

   ```sh
   pnpm run db:deploy
   pnpm run import:clients
   ```

   前の実装から移すときは、上の「本番の切り替え」の手順にします。

5. 試行回数の制限は、クライアントの IP を `x-forwarded-for` から読みます（`lib/id/client-ip.ts`）。デプロイ先は Vercel だけを前提にしています。Vercel はこのヘッダーをクライアントの 1 つのアドレスで上書きするので信用できます。ほかの環境では、クライアントがヘッダーを書き換えられるため、アドレス 1 つだけの正しい値でなければ「不明」として数えます。
6. デプロイします。
7. デプロイのあと、`https://<issuer>/api/auth/ok` が 200 を返すことを確かめます（`BETTER_AUTH_SECRET` が足りないことは、ビルドでは分からず（ビルドは仮の値で通る）、最初のリクエストで初めて出ます）。続けて、自分のアカウントを登録（前の実装から移すときは上の「本番の切り替え」）し、サービスを順に移します。

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
   - `BETTER_AUTH_SECRET`：32 文字以上の適当な値
   - `OIDC_CLIENTS`：「クライアントの登録」の JSON（`redirectUris` は `http://localhost:…`）
   - `MAIL_LOG=/tmp/sparklingstadt-id-mail.jsonl`：`RESEND_API_KEY` なしで試すとき。メールはこのファイルに書かれ、確認リンクを読める
3. 起動します。

```sh
pnpm install
docker compose up -d --wait          # Postgres（127.0.0.1:55432）
pnpm run db:deploy
pnpm run import:clients              # OIDC_CLIENTS を DB へ
pnpm run dev
```

| コマンド | 内容 |
| --- | --- |
| `pnpm run import:clients` | `OIDC_CLIENTS` を DB に取り込む |
| `pnpm run import:legacy` | 前の実装の持ち主のアカウントと署名鍵を取り込む（切り替えのときだけ） |
| `pnpm run test:unit` | 単体テスト |
| `pnpm run test:e2e` | Playwright の E2E（`pnpm run build` のあと。サーバー・クライアント・署名鍵は自動で用意） |
| `pnpm run test:regression` | lint・単体・ビルド・E2E をまとめて実行（CI と同じ） |
