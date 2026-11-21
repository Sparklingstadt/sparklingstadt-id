# Sparklingstadt ID（id.sparklingstadt.com）

FFPF ID（ffpf-portal）と Candy Rain ID（candy-rain-oidc）の 2 つの OpenID Connect プロバイダーを、`https://id.sparklingstadt.com` の 1 つにまとめる。この文書は、ID サーバーの中身と、各サービスを移す順番を決める。各サービスのつなぎ替えの細部は、そのサービスのリポジトリで別の設計にする。

> この文書は、新しいリポジトリ `sparklingstadt-id` を作るまでの仮置きとして ffpf-zhuelog に置く。リポジトリを作ったら、そちらの `docs/superpowers/specs/` に移す。

## 1. なぜ作るか

- OIDC のプロバイダーが 2 つあり、作りも利用者の持ち方も違う（下の表）。
- 今後は FFPF の名前をやめ、すべてのサービスを Sparklingstadt の名前で出す。ログインの窓口も Sparklingstadt の名前で 1 つにし、1 人が 1 つのアカウントですべてのサービスに入れるようにする。

|                 | FFPF ID                                                                     | Candy Rain ID                                |
| --------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| 実装            | ffpf-portal（Next.js）の一部                                                | candy-rain-oidc（Go）                        |
| 利用者          | 自分の表 `ffpf_users`（メール＋パスワード、scrypt、メール確認、自分で登録） | ストアの `User` を読むだけ（bcrypt）         |
| 署名            | ES256                                                                       | RS256                                        |
| SSO・ログアウト | なし                                                                        | あり（`/logout`）                            |
| クライアント    | ffpf-zhuelog、typle-r                                                       | candy-rain-official-store、candy-rain-stores |

## 2. 目標・目標でないもの・失敗とみなすもの

**目標**

- `https://id.sparklingstadt.com` を issuer とする、1 つの OIDC プロバイダー「Sparklingstadt ID」。
- 1 人 1 アカウント。どれか 1 つのサービスでログインすれば、ほかのサービスにはパスワードなしで入れる（SSO）。どれかでログアウトすると、ID サーバーのログインも消える。
- 4 つのクライアント（ffpf-zhuelog、typle-r、candy-rain-official-store、candy-rain-stores）を順に移し、最後に FFPF ID と Candy Rain ID を止める。

**目標でないもの（今回は作らない）**

- 今のアカウントとデータの移行。今の利用者は持ち主（Sparklingstadt）だけなので、新しい ID で作り直す。
- 二要素認証、ソーシャルログイン、退会、同意画面、リフレッシュトークン、動的クライアント登録。これは FFPF ID の範囲外と同じ。
- プロフィール画像（Candy Rain ID の `/account`・`picture`）。必要になったら後で足す。
- ffpf-portal そのもの（告知のサイト）をどうするか。FFPF ID の部分を消すことだけを扱う。

**失敗とみなすもの（動いていても）**

- 利用者が、サービスごとに別のアカウントやパスワードを作らないといけない。
- 画面やメールに「FFPF」や「Candy Rain ID」の名前が残る。
- サービスの側が、自分でパスワードを持ち続ける、または自分の画面でメールアドレスを変えられる（持ち主が 2 か所になる）。メールアドレスと表示名の **写し** を持つのはよい（下の 5.1）。

## 3. 作り方（Approaches）

1. **新しい Next.js のアプリを作り、FFPF ID のコードを土台にする（採用）**。登録、メール確認、パスワード再設定、試行回数の制限、OIDC のエンドポイントは、テスト済みの FFPF ID の実装を移す。足りない SSO・ログアウトは、Candy Rain ID の Go の実装を参考に TypeScript で書く。技術は ffpf-zhuelog と同じ（Next.js・Prisma・Neon・Vercel）で、運用もそろう。
2. **candy-rain-oidc（Go）を育てる**。SSO・ログアウト・discovery はすでにあるが、自分の利用者の表、登録、メール確認、再設定を一から書く必要がある。ffpf-zhuelog で Go をやめた流れとも逆になる。
3. **出来合いのもの（Keycloak・Zitadel を自分で動かす、Auth0・Clerk）**。標準への対応は一番しっかりしているが、自分で動かすものは Vercel で動かずサーバーが要る。Auth0 と Clerk は利用者が増えるとお金がかかる。どちらも画面を自由にしにくい。

持ち主が 1 を選んだ。

## 4. ID サーバー（`sparklingstadt-id`）

断りがない限り、ffpf-portal の `docs/superpowers/specs/2026-10-27-ffpf-id-design.md` の「1. portal」と同じにする。以下は、そこからの違いだけを書く。

### 4.1 リポジトリと置き場所

- 新しい公開リポジトリ `Sparklingstadt/sparklingstadt-id`。Next.js（ffpf-zhuelog と同じ版）、Prisma 7、Neon Postgres（専用の DB）、Vercel の新しいプロジェクト。
- ドメインは `id.sparklingstadt.com`。issuer は `https://id.sparklingstadt.com`（末尾スラッシュなし）。
- このアプリはログインの窓口だけを持つ。告知などのほかの機能は持たない。トップ（`/`）はマイページ（`/account`）へ送る。

### 4.2 名前の置き換え

| FFPF ID                                 | Sparklingstadt ID                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ffpf_users` などの表、`Ffpf*` のモデル | `users`・`sessions`・`email_tokens`・`auth_codes`・`throttles`（モデル名は `User` など、接頭辞なし）                    |
| Cookie `ffpf_id_session`                | `sid_session`                                                                                                           |
| 環境変数 `FFPF_ID_*`・`FFPF_OIDC_*`     | `ID_ISSUER`・`OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS`・`OIDC_CLIENTS`・`RESEND_API_KEY`・`MAIL_FROM`・`MAIL_LOG` |
| 画面のパス `/<locale>/id/...`           | `/<locale>/...`（`/signup`・`/login`・`/account`・`/verify`・`/forgot`・`/reset`）                                      |
| 画面とメールの「FFPF ID」               | 「Sparklingstadt ID」                                                                                                   |

- 言語は FFPF ID と同じ 3 つ（ja・zh-cn・zh-tw）。既定は ja。
- メールの送り主は `MAIL_FROM`（例 `Sparklingstadt ID <no-reply@sparklingstadt.com>`）。Resend で `sparklingstadt.com` のドメインを確認する。

### 4.3 FFPF ID に足すもの

**SSO**

- ID サーバーのログイン（`sid_session`、30 日）を、すべてのクライアントで共通に使う。ログイン中に `/oauth/authorize` が来たら、パスワードを聞かずにコードを出す。これは FFPF ID ですでに動いている。
- `prompt=login` は FFPF ID と同じ。`prompt=none` にも対応する。ログインしていなければ `redirect_uri?error=login_required&state=…` で戻す（Auth.js などが黙って確かめるときに使う）。

**ログアウト（RP-Initiated Logout 1.0）**

- `GET /oauth/logout`。引数は `client_id`、`post_logout_redirect_uri`、`state`、`id_token_hint`（任意）。
- `post_logout_redirect_uri` は、そのクライアントに登録した値と完全に一致するときだけ戻す。一致しない、または無いときは、「ログアウトしました」の画面を出す。
- `sid_session` の行と Cookie を消す。各クライアントのセッションは、それぞれのクライアントが自分で消してから、ここへ送る（バックチャネルのログアウトは作らない。ほかのタブのサービスには、次に ID サーバーへ来たときにログインを求める）。
- discovery に `end_session_endpoint` を載せる。
- クライアントの登録（`OIDC_CLIENTS` の要素）に `postLogoutRedirectUris`（配列）を足す。

**discovery**

- FFPF ID の項目に、`end_session_endpoint` と、`prompt_values_supported: ["none","login"]` を足す。Auth.js のクライアント（Candy Rain の 2 つ）は discovery を使うので、`/.well-known/openid-configuration` は必ず正しく返す。

**クレーム**

- ID トークンと userinfo は FFPF ID と同じ（`sub`・`email`・`email_verified`・`name`）。
- `role` は返さない。管理者かどうかは、各サービスが自分の表で決める（Candy Rain の `User.role`、zhuelog の管理者、typle-r の `typle_admins`）。

### 4.4 環境変数

`ID_ISSUER`、`DATABASE_URL`、`OIDC_SIGNING_KEY`（ES256 の秘密鍵の JWK）、`OIDC_PREVIOUS_PUBLIC_KEYS`（任意）、`OIDC_CLIENTS`、`RESEND_API_KEY`、`MAIL_FROM`、`MAIL_LOG`（E2E 用、任意）。鍵とクライアントのシークレットは、`pnpm run oidc:keygen` と `pnpm run oidc:client <id>` で作る（FFPF ID と同じスクリプトを移す）。

### 4.5 テスト

- FFPF ID の Playwright のテスト（登録からログアウトまで、再設定、制限、OIDC の各エンドポイント）を移し、名前を直す。
- 足すもの：SSO（クライアント A でログインしたあと、クライアント B の authorize がパスワードなしでコードを返す）、`prompt=none`（ログインなしで `login_required`）、ログアウト（登録した戻り先へ戻る、登録にない戻り先では戻らない、ログアウト後の authorize がログインを求める）、discovery の `end_session_endpoint`。

## 5. クライアントの移し方

### 5.1 共通

- クライアントは FFPF ID のときと同じ約束（認可コード＋PKCE、`state`・`nonce`、`client_secret_basic`、ES256 を JWKS で検証、`email_verified == true` を確かめる）。
- サービス内のアカウント ID は `sid:<sub>`。今の `ffpf:` やストアの `User.id` は使わない（candy-rain-stores は例外。5.2 の 4）。
- メールアドレスと表示名は、ログインのたびに ID トークンから写して持ってよい（注文のメールや Stripe に要るため）。持ち主は ID サーバーで、サービスの画面では変えさせない。変えたいときは ID サーバーの `/account` へ案内する。リフレッシュトークンは無いので、ログインの外で最新の値は取らない（作る人の判断）。
- ログアウトでは、サービスのセッションを消してから `end_session_endpoint` へ送る。
- ボタンの文言は「Sparklingstadt ID でログイン」。
- 移した直後から、そのサービスの FFPF ID または Candy Rain ID のログインを消す。利用者がいないので、両方を並べて残す期間は設けない。

### 5.2 サービスごと（詳細は各リポジトリで設計する）

| 順  | サービス                  | 今のログイン                                                                                                                                         | 移したあと                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ffpf-zhuelog              | FFPF ID（自前の実装、`FfpfAccount`）                                                                                                                 | `FfpfAccount` を `SidAccount`（id＝sub）に置き換え、`ffpf:` を `sid:` にする。パスワード会員・ゲスト・デモ・GitHub（管理者）は残す                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | typle-r                   | GitHub と FFPF ID（Go）。`/admin` は FFPF ID だけ                                                                                                    | FFPF ID を Sparklingstadt ID に置き換える。`typle_admins` の行は Sparklingstadt ID のメールアドレスで入れ直す                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | candy-rain-official-store | Candy Rain ID（Auth.js）。パスワードはストアの `User.passwordHash`                                                                                   | `User` に `idSub`（unique）を足し、ログインのたびに `sub` で引く。無ければ作る（`email` は ID トークンから写す）。`passwordHash` と、ストアの登録・パスワード変更の画面をやめる。`role` はストアの `User.role` のまま。切り替えのときに今の `User` と、それにひもづく注文・カートは消す（利用者がいないため。メールアドレスでつなぐ仕組みは作らない）。持ち主は新しい ID で一度ログインしたあと、SQL で自分の行を `ADMIN` にする（README に手順を書く）。`firstName`・`lastName` は ID の `name` と合わないので、どう埋めるかはストアの設計で決める |
| 4   | candy-rain-stores         | Candy Rain ID（Auth.js）。自分の DB を持ち、`Store.ownerSub`・`buyerSub` に OIDC の `sub` をそのまま入れている（ストアの `User` の表は使っていない） | issuer とクライアント ID を変えるだけ。`sub` は今と同じくそのまま入れる（`sid:` は付けない。issuer が 1 つなので見分ける必要がない）。今の店・カート・注文は消す（利用者がいないため）。`buyerEmail`・`contactEmail` は今のまま                                                                                                                                                                                                                                                                                                                     |

ffpf-zhuelog を最初にするのは、FFPF ID と同じ作りのクライアントがすでに自前で書かれていて、issuer を変えるだけでほぼ動き、ID サーバーの確かめに向いているから。

### 5.3 止めるもの

- 4 つが移ったら、ffpf-portal の FFPF ID の部分（`/id`・`/oauth`・表・環境変数）を消す。
- candy-rain-oidc の Vercel のプロジェクトを止め、リポジトリをアーカイブする。

## 6. 本番の設定（持ち主が行う）

1. Vercel に `sparklingstadt-id` のプロジェクトと Neon の DB を作り、`id.sparklingstadt.com` をつなぐ（DNS）。
2. Resend で `sparklingstadt.com` を確認し、`RESEND_API_KEY` と `MAIL_FROM` を入れる。
3. 鍵とクライアントのシークレットを作り、`OIDC_CLIENTS` に 4 つのクライアントを入れて、デプロイする。
4. 自分のアカウントを登録し、5.2 の順にサービスを移す。

## 7. 作る人に任せること

- 画面の見た目。FFPF ID の画面を土台にし、Sparklingstadt の名前にする。
- FFPF ID のコードを移すときの、ファイルの分け方と細かな名前。
- ログアウトの画面の文言。
