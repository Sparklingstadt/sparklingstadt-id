# Sparklingstadt ID を Better Auth で作り直し、パスキーと二要素認証を足す

この文書は、`sparklingstadt-id` の中身を自前の実装から Better Auth に置き換え、パスキー（主に指紋）と二要素認証を足すための設計です。typle-r を Better Auth に移す作業は別のプロジェクトとして、この後に typle-r のリポジトリで設計します。

## 1. なぜ作るか

- 持ち主は、ログインを指紋（パスキー）でできるようにし、二要素認証も使いたい。
- 指紋の確認は、各サービスではなく ID サーバーで行う。そうすれば、Sparklingstadt ID を使うサービスがすべて同時に対応できる。
- 持ち主は、ID サーバーと typle-r の両方を Better Auth にそろえると決めた。パスキーと二要素認証は Better Auth のプラグインで足せる。自前で持つセキュリティのコード（トークンの発行、PKCE、セッション、試行回数の制限）も減らせる。
- 利用者は持ち主だけなので、今が一番安く作り直せる。

2026-11-21 の設計（`2026-11-21-sparklingstadt-id-design.md`）では、二要素認証を「目標でないもの」としていた。この文書でそれを変える。それ以外の約束（issuer、SSO、ログアウト、クレーム、3 言語、画面のパス）は、ここに書いた違いを除いて前の設計のままとする。

## 2. 目標・目標でないもの・失敗とみなすもの

**目標**

- ID サーバーのログインと OIDC プロバイダーを Better Auth 1.7 系で動かす。使うのは本体（メール＋パスワード、メール確認、パスワード再設定、メールアドレスの変更、セッション、レート制限）と、プラグインの `@better-auth/oauth-provider`・`jwt`・`@better-auth/passkey`・`twoFactor`。
- パスキーでログインできる。パスワードを入れずに、端末の指紋（Touch ID、Android の指紋、Windows Hello など）だけで入れる。
- 二要素認証（TOTP の認証アプリ＋バックアップコード）を、利用者が自分でオン・オフできる。オンにすると、パスワードでのログインにコードの入力が加わる。
- **クライアントの側は何も変えなくてよい。** issuer、クライアント ID、クライアントのシークレット、redirect URI、持ち主の `sub`、ID トークンのクレームが今と同じなので、typle-r・ffpf-zhuelog などの登録済みのクライアントはそのまま動く。

**目標でないもの（今回は作らない）**

- typle-r の Better Auth 化（別のプロジェクト）。
- 各サービスでのパスキーや二要素認証。指紋の確認は ID サーバーでだけ行う。
- ソーシャルログイン、退会、同意画面、リフレッシュトークン、動的クライアント登録（前の設計と同じ）。
- 二要素認証を全員に強制すること。SMS やメールでのワンタイムコード。「この端末を信頼する」。
- 持ち主以外のアカウントやデータの移行。

**失敗とみなすもの（動いていても）**

- どれかのクライアントで、設定の変更やアカウントのつなぎ直しが要る（`sub`・シークレット・URL のどれかが変わった）。
- 二要素認証をオンにしたのに、パスワードだけでログインできる道が残る。そうした道には、OIDC の authorize からのログインやパスワード再設定の直後も含む。
- パスキーをすべて失ったときに、ログインする手段がなくなる。
- 画面が日本語・簡体字・繁体字の 3 言語でなくなる、または FFPF などの古い名前が出る。

## 3. 作り方（Approaches）

1. **Better Auth で作り直す（採用）**。`lib/id/*` の自前の OIDC・セッション・パスワード・制限の処理を、Better Auth の本体とプラグインに置き換える。画面と 3 言語の対応、メールの文面、issuer は残す。自前のセキュリティのコードはほぼなくなり、パスキーと二要素認証はプラグインを足すだけになる。
2. **ログインの部分だけ Better Auth にし、`/oauth/*` は自前のまま残す**。トークンの発行の仕方は今と同じにできる。ただし自前のコードと Better Auth のつなぎ目が残り、両方を Better Auth にそろえるという目的から半分外れる。
3. **Better Auth を使わず、パスキーだけ自前で足す（SimpleWebAuthn など）**。Better Auth にそろえるという持ち主の決定に合わないので外した。

持ち主が 1 を選んだ。利用者が持ち主だけで、つなぎ目を残す理由がない。

## 4. 作るもの

### 4.1 Better Auth の構成

- `better-auth`・`@better-auth/oauth-provider`・`@better-auth/passkey` を 1.7 系の同じ版で入れる。DB は今の Neon、Prisma アダプター（Prisma 7）を使う。
- Better Auth のハンドラーは `app/api/auth/[...all]/route.ts`（Better Auth の Next.js での既定）に置く。
- 環境変数：
  - 新しく `BETTER_AUTH_SECRET` を足す。セッションの署名と、jwks の秘密鍵の暗号化に使う。
  - `ID_ISSUER` を Better Auth の `baseURL`（の origin）にも使う。
  - `OIDC_CLIENTS`・`OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS` は、切り替えのときの取り込み（4.6）にだけ使い、その後は外す。
  - `RESEND_API_KEY`・`MAIL_FROM`・`MAIL_LOG` は今のまま。

### 4.2 OIDC プロバイダー（`@better-auth/oauth-provider` ＋ `jwt`）

**外から見たときの約束（今と同じにする）**

- issuer は `https://id.sparklingstadt.com`。
- `/.well-known/openid-configuration` をルートで返す。
- 今の URL（`/oauth/authorize`・`/oauth/token`・`/oauth/jwks`・`/oauth/userinfo`・`/oauth/logout`）も今までどおり使える。discovery を読まず URL を直接書いているクライアントがあっても動くようにするため。Better Auth の `/api/auth/oauth2/*`（と jwks）へ、Next.js の rewrites か薄い Route Handler でつなぐ。discovery に載せる URL を今の `/oauth/*` にするか Better Auth のものにするかは、作る人が決める。ただし両方とも動くこと。

**フローの約束**

- 認可コード＋PKCE（S256 のみ、必須）、`state`・`nonce`。
- `client_secret_basic` と `client_secret_post`。
- `prompt=none`：ログインしていなければ `login_required`。
- `prompt=login`：ログイン中でも、もう一度ログインさせる。
- メールが未確認なら、コードを出さずに `/account?verify=required` へ送る。`prompt=none` なら `interaction_required` を返す。今の `app/oauth/authorize/route.ts` の手順 5 と同じ。

**ID トークン**

- ES256 で署名する（jwt プラグインの `keyPairConfig` を ES256）。
- クレームは `iss`・`sub`・`aud`・`iat`・`exp`・`auth_time`・`nonce`・`email`・`email_verified`・`name`。`role` は返さない。userinfo は `sub`・`email`・`email_verified`・`name`。
- `sub` は Better Auth の `user.id`。持ち主の行は今の `users.id`（cuid）を引き継ぐ（4.6）。

**クライアントが頼っているもの（2026-11-26 に各リポジトリで確認）**

- 確認したクライアントは typle-r、ffpf-zhuelog、candy-rain-official-store、candy-rain-stores。
- どれも `scope=openid email profile` を送り、ID トークンを ES256 と JWKS で検証して使う。アクセストークンを JWT として検証したり userinfo を前提にしたりするクライアントはない。
- 使っている URL：
  - ffpf-zhuelog は discovery を読まず、`/oauth/authorize`・`/oauth/token`・`/oauth/jwks`・`/oauth/logout` を直接書いている。今の URL を残すのはこのためで、必須。
  - typle-r と candy-rain の 2 つは Auth.js で、discovery を読む。

ここから決まること：

- 各クライアントには `openid email profile` の scope を許す。
- `email` と `name` のクレームは、この scope の要求で出ればよい。今の実装のように scope を見ずに固定する必要はない。
- アクセストークンの形（JWT か不透明か）は、プラグインの既定のままでよい。

**クライアントと同意**

- 登録済みのクライアントは、すべて同意画面を出さない（`skipConsent`）。同意画面は作らない。
- クライアントの登録は、環境変数から Better Auth の DB の表に移す。
- シークレットは今と同じ「SHA-256 の 16 進」で照合する（`storeClientSecret` に `hash`・`verify` を渡す）。今の `secretHash` をそのまま取り込めるので、クライアントのシークレットは変わらない。

**ログアウト**

- RP-Initiated Logout（end-session）を使う。`post_logout_redirect_uri` は登録と完全に一致するときだけ戻す。一致しないとき、または無いときは `/signed-out`（言語つき）を出す。
- `id_token_hint` がない場合は確認の画面（`/logout`）を出す。これは今の動き。プラグインの end-session がそのとおりに動かないところは、今の `/oauth/logout` の Route Handler を残してプラグインの API を呼ぶ形にしてよい。

**使わない機能**

- リフレッシュトークン、動的クライアント登録、client_credentials、introspect、revoke は、使えないようにする（discovery にも載せない）。どうしても設定で消せないものは、作る人の判断で残してよい。

### 4.3 アカウント（Better Auth 本体）

**登録とメール**

- メール＋パスワードで登録する（今と同じく誰でも登録できる）。
- パスワードの規則は今の `lib/id/validation.ts` のまま。
- メール確認は必須。確認前でもログインはできるが、OIDC のコードは出さない（4.2）。
- 確認・再設定・メールアドレス変更のメールは、Better Auth の `sendVerificationEmail`・`sendResetPassword`・`changeEmail` のフックから、今の `mailer.ts` と `mail-templates.ts` で 3 言語のまま送る。メールの言語は、今と同じく画面の言語で決める。
- メールアドレスの変更は、新しいアドレスへの確認メールで完了する。

**パスワード**

- ハッシュは今の `lib/password.ts`（scrypt、`scrypt$N$r$p$salt$hash`）を Better Auth の `emailAndPassword.password.hash`・`verify` に渡して使い続ける。持ち主のパスワードは変わらない。
- パスワードの変更・再設定で、ほかのセッションをすべて消す（今の `sessionVersion` の代わり）。

**セッション**

- 期間は 30 日（今と同じ）。Cookie の名前は作る人が決める（今の `sid_session` は引き継がない。切り替えで一度ログアウトしてよい）。

**表示名・制限・アカウントの列挙**

- 表示名は Better Auth の `user.name`。
- 試行回数の制限は 2 段にする（Claude の判断。Better Auth のレート制限は IP とパスでしか数えないため）。
  - **IP とパスごと**：Better Auth のレート制限を使う。Vercel のサーバーレスで効くよう、保存先は DB にする。
  - **メールアドレスやアカウントごと**：今の `throttles` 表と `lib/id/throttle.ts` を残す。今の数え方（`login:mail` 5 回、アカウントごと 30 回、パスワードの確認 5 回で成功すると数え直す など）を、Better Auth の `hooks.before`（またはプラグインの hook）から、同じ数え方のまま使う。
  - 同じ数え方を足すところ：二要素認証のコード入力（TOTP・バックアップコード、アカウントごと）。総当たりを防ぐため。
  - パスキーのログインには足さない（推測できる秘密がないため）。
- アカウントの有無が分からないこと（no enumeration）は今と同じに保つ。対象は、ログインの失敗、再設定の要求、登録済みのアドレスでの登録。

### 4.4 パスキー（`@better-auth/passkey`）

- `rpID` は `id.sparklingstadt.com`（開発では `localhost`）、`rpName` は「Sparklingstadt ID」、`origin` は `ID_ISSUER`。
- **登録**：ログイン中に `/account` の「パスキー」の欄から登録する。端末の指紋などの本人確認を求める（`userVerification: "required"`）。名前を付けられ、一覧と削除ができる。いくつでも登録できる。
- **ログイン**：`/login` に「パスキー（指紋）でログイン」のボタンを置く。メール欄の自動入力のパスキー候補（conditional UI）も出す。パスキーでのログインは二要素認証を求めない（本人確認つきのパスキーは、それだけで二要素にあたる）。
- **OIDC からの流れ**：`/oauth/authorize` からログイン画面に来た場合も、パスキーでログインしたあと、元の authorize に戻ってコードが出ること。
- **失ったとき**：パスキーをすべて失っても、メール＋パスワード（＋二要素認証）でログインでき、パスワードを忘れても再設定できる。パスキーだけのアカウント（パスワードなし）は作れない。

### 4.5 二要素認証（`twoFactor`）

- 方式は TOTP（認証アプリ）とバックアップコード（10 個、1 回ずつ）。SMS・メールのコードは使わない。
- **オンにする**：`/account` の「二要素認証」の欄で行う。
  1. パスワードを入れる。
  2. QR コード（と手入力用の文字列）を出す。
  3. アプリのコードを 1 回入れて確かめたら、オンになる。
  4. バックアップコードはそのときに一度だけ見せる。作り直すこともできる。
- **オフにする**：パスワードを入れてオフにする。
- **ログイン**：オンのとき、パスワードでのログインは、続けてコード（またはバックアップコード）の画面を通らないと完了しない。OIDC の authorize から来た場合も、コードの画面のあと元の authorize に戻る。
- **パスワード再設定**：再設定のあとのログインでも、二要素認証は求める（再設定では外れない）。TOTP の端末もバックアップコードもすべて失った場合は、持ち主が DB で外す。README に手順を書く。

### 4.6 切り替え（データ）

利用者は持ち主だけなので、移すのは持ち主の行だけ。そのほかは作り直す。

1. Better Auth の表（`user`・`session`・`account`・`verification`・`jwks`・`passkey`・`twoFactor`・`oauthClient` など。プラグインが求めるもの）を Prisma のマイグレーションで足す。表の名前は作る人が決める。
2. **取り込みのスクリプト**（1 回だけ実行。リポジトリに残し、再実行しても壊れないようにする）が、次のものを移す。
   - 今の `users` から持ち主の行：`id` はそのまま `user.id` に、`email`、`display_name` は `name` に、`email_verified_at` は `emailVerified` に。
   - パスワードのハッシュ：`account`（`providerId: "credential"`）の `password` へ。
   - `OIDC_CLIENTS` の各クライアント：ID、名前、`secretHash`、`redirectUris`、`postLogoutRedirectUris` を `oauthClient` へ。同意を出さない設定にする。
   - 署名鍵：今の `OIDC_SIGNING_KEY` を jwt プラグインの鍵の表に入れ、同じ `kid` で署名を続ける。うまく入れられない場合は新しい鍵でもよい（クライアントは JWKS を読み直すので動く）。
3. 今の表（`users`・`sessions`・`email_tokens`・`auth_codes`。`throttles` は 4.3 のとおり残す）と `lib/id/*` の置き換えた部分を消す。消すのは取り込みのあとの別のマイグレーションでよい。
4. 切り替えると、今のログイン（ID サーバーのセッション）は全部切れる。持ち主はもう一度ログインし、パスキーと二要素認証を登録する。各サービスのセッションはそのまま。

### 4.7 テスト

- 今の単体テストと Playwright のテスト（登録、確認、ログイン、再設定、メール変更、SSO、`prompt=none`・`prompt=login`、ログアウト、discovery、各エンドポイント）を、新しい実装に向けて直し、すべて通す。
- 足すテスト：
  - パスキーの登録と、パスキーでのログイン。Playwright の Chromium の仮想認証器（CDP の `WebAuthn.addVirtualAuthenticator`）を使う。
  - authorize から来てパスキーでログインし、コードが出る。
  - 二要素認証のオン・オフ、コードありのログイン、バックアップコードでのログイン（同じコードは 2 回使えない）。
  - 二要素認証がオンのとき、authorize からのパスワードログインがコードなしでは完了しない。
  - クライアントのシークレットが今の値で通る。
  - 今の `/oauth/*` の URL と、Better Auth の URL の両方で、フローが最後まで通る。
- 取り込みのスクリプトのテスト：今の形の行から移したユーザーが、今のパスワードでログインでき、`sub` が今の `users.id` と同じになる。

## 5. 本番の切り替え（持ち主が行う）

1. Vercel に `BETTER_AUTH_SECRET` を足す。
2. デプロイし、マイグレーションと取り込みのスクリプトを実行する。
3. typle-r などのクライアントで「Sparklingstadt ID でログイン」が今までどおり動くことを確かめる。確かめる点は、同じアカウントで入れることと、設定を何も変えずに済むこと。
4. `/account` でパスキーを登録し、二要素認証をオンにする。
5. 古い環境変数（`OIDC_CLIENTS`・`OIDC_SIGNING_KEY`・`OIDC_PREVIOUS_PUBLIC_KEYS`）と古い表を消す。

## 6. 作る人に任せること

- 画面の見た目と文言（パスキー・二要素認証の欄、コードの画面）。今の画面の作りにそろえる。
- QR コードを描く方法（ライブラリの選び方）。
- ファイルの分け方、Better Auth の表とカラムの名前、Cookie の名前。
- 今の `/oauth/*` の URL を Better Auth へつなぐ方法（rewrites か Route Handler か）と、discovery に載せる URL。
- Better Auth のプラグインが前の約束どおりに動かないところを、設定で直すか薄い自前のコードで補うか（どちらでも、2・4.2 の約束を守ること）。
