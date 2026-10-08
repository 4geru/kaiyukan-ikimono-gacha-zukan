Issue: https://github.com/4geru/tweet-bookmark/issues/785

# 設計: LIFF × Firestore 認証（LINE Login + セキュリティルール）

要件は [requirements.md](requirements.md)（承認済み）。調査は [liff-firebase-custom-token-auth.md](../../research/liff-firebase-custom-token-auth.md)。

## 0. 設計前の実環境確認（2026-09-19、gcloud / REST）

| 確認項目 | 結果 | 設計への影響 |
|---|---|---|
| Firebase Authの初期化 | **未初期化**（Identity Toolkit の `config` が `CONFIGURATION_NOT_FOUND`） | `signInWithCustomToken` が失敗する。**手順0で初期化が必要** |
| `roles/editor` に `iam.serviceAccounts.signBlob` | **含まれない**（`actAs` 等のみ） | Cloud Runのサービスアカウントに `roles/iam.serviceAccountTokenCreator`（自分自身に対して）の付与が必要 |
| Cloud Runのサービスアカウント | `904272649235-compute@developer.gserviceaccount.com` | 上記の付与先 |
| Cloud Runの環境変数 | `GCS_BUCKET_NAME` とシークレット3つ。`GACHA_LIFF_URL` は未設定 | `make deploy` の `--set-env-vars` に追加しても既存値を消さない |
| Node / fetch | Dockerfile は Node 22（`fetch` 組み込み） | LINE verify APIの呼び出しに追加パッケージ不要 |

## 1. 全体構成

```
LIFF(ミニアプリ)  frontend/shared/*
  ① liff.init → liff.getIDToken()
  ② POST {AUTH_API_URL}  { idToken }        ──▶  Cloud Run  src/lineAuth.ts
                                                   a. JWTのaudを（未検証で）読み、許可リストと照合
                                                   b. POST api.line.me/oauth2/v2.1/verify（client_id=aud）→ sub
                                                   c. getAuth().createCustomToken(sub)
  ③ ◀── { customToken }
  ④ signInWithCustomToken(auth, customToken)
  ⑤ onSnapshot(users/{uid}/collection)  ──▶  Firestore（rules: request.auth.uid == userId）
```

## 2. バックエンド: `POST /auth/line`

### 2.1 ファイル構成

- **新規** `backend/src/lineAuth.ts`: 検証・カスタムトークン発行のハンドラ、CORSミドルウェア、設定読み込み
- **変更** `backend/src/server.ts`: `/webhook` の隣に登録する。`express.json()` は**このルートにだけ**付ける（グローバルにするとLINE署名検証に使う生ボディを壊す）

```ts
app.options("/auth/line", corsMiddleware);
app.post("/auth/line", corsMiddleware, express.json(), handleLineAuth);
```

### 2.2 リクエスト／レスポンス

| | 内容 |
|---|---|
| リクエスト | `POST /auth/line`、`Content-Type: application/json`、`{ "idToken": "<LIFFのIDトークン>" }` |
| 成功 | `200 { "customToken": "..." }` |
| `idToken` なし・文字列でない | `400 { "error": "missing_id_token" }` |
| `aud` が許可リスト外（またはJWTとして読めない） | `401 { "error": "invalid_audience" }`（LINE APIは呼ばない） |
| LINEが期限切れと返す（`IdToken expired`） | `401 { "error": "id_token_expired" }` |
| その他のLINE検証失敗（署名不正など） | `401 { "error": "invalid_id_token" }` |
| LINE APIへの到達失敗・5xx | `502 { "error": "line_api_unavailable" }` |
| カスタムトークン発行失敗（IAM等） | `500 { "error": "token_issue_failed" }`（原因はサーバーログのみ） |

エラー本文にはLINEの応答をそのまま含めない。

### 2.3 処理

1. `idToken` のペイロード（JWTの2番目のセグメント、base64url）から `aud` を**署名検証せずに**読む。目的は「どのチャネルIDで検証するか」を選ぶことだけで、認可には使わない
2. `aud` が許可リストに無ければ 401（`invalid_audience`）
3. `POST https://api.line.me/oauth2/v2.1/verify`（`application/x-www-form-urlencoded`、`id_token` と `client_id=aud`）。署名・有効期限・`aud` 一致をLINE側で検証させる
4. 応答の `sub` がLINE userId。`createCustomToken(sub)`（追加クレームなし）を返す

### 2.4 設定（環境変数）

| 変数 | 値 | 用途 |
|---|---|---|
| `LINE_LOGIN_CHANNEL_IDS` | `2011666396,2011666398` | 許可するチャネルID（カンマ区切り）。未設定なら起動時にエラーにせず、`/auth/line` が常に401（`/webhook` を巻き込まない） |
| `AUTH_ALLOWED_ORIGINS` | `https://kaiyukan-gacha-dev.web.app,https://kaiyukan-gacha-hackathon.web.app` | CORSで許可するオリジン |

`backend/Makefile` の `deploy` は `--set-env-vars` の区切りを変えて追加する（値にカンマを含むため）。

```make
--set-env-vars="^@^GCS_BUCKET_NAME=$(BUCKET_IMAGES)@LINE_LOGIN_CHANNEL_IDS=2011666396,2011666398@AUTH_ALLOWED_ORIGINS=https://kaiyukan-gacha-dev.web.app,https://kaiyukan-gacha-hackathon.web.app"
```

`backend/env.sample` にも同じ2変数を追記する。

### 2.5 CORS

手書きの小さなミドルウェア（`cors` パッケージは追加しない）。

- `Origin` が `AUTH_ALLOWED_ORIGINS` に含まれるときだけ `Access-Control-Allow-Origin: <そのOrigin>` と `Vary: Origin` を返す。含まれなければヘッダーを付けない（ブラウザ側で拒否される）
- プリフライト（`OPTIONS`）には `Access-Control-Allow-Methods: POST` / `Allow-Headers: Content-Type` / `Max-Age: 3600` を付けて `204`
- 認証情報（Cookie）は使わないので `Allow-Credentials` は付けない

### 2.6 ログ

`idToken` とカスタムトークンは出力しない。出力するのはエラー種別・LINE APIのHTTPステータス・`aud`（チャネルID）まで。`sub`（userId）も出さない。

## 3. フロントエンド

### 3.1 設定・モジュールの変更

| ファイル | 変更 |
|---|---|
| `shared/config.js` | `AUTH_API_URL`（Cloud Runの `/auth/line`）を追加。`CDN_VERSIONS.firebase` は既存の `10.14.1` を使い `firebase-auth.js` も同じバージョンで読む |
| `shared/liff-client.js` | `getIdToken()`（`liff.getIDToken()`）と `reloginForFreshToken()` を追加。`?debugUserId=` は**localhost / 127.0.0.1のときだけ**有効にする（要件の未確定事項の決定。他のホストでは無視して通常のLIFF経由にする） |
| `shared/firestore-client.js` | 認証を組み込む（3.2） |

### 3.2 `firestore-client.js` の認証

- `getDbHandle()` が `firebase-auth.js` も読み込み、`getAuth(app)` を返す（永続化は既定のまま。IndexedDB → localStorage → メモリの順にフォールバックされるので、WebViewで保存できなくても動く）
- 新設 `ensureSignedIn(userId)`（**モックのときは何もしない**）
  1. `await auth.authStateReady()`
  2. `auth.currentUser?.uid === userId` ならそのまま返す（ページ遷移後は永続化されたセッションを再利用し、`/auth/line` を呼ばない）
  3. それ以外は、`getIdToken()` → `POST AUTH_API_URL` → `signInWithCustomToken`
- `getUserDoc` / `getCollectionEntry` / `watchCollection` は、Firestoreにアクセスする前に `ensureSignedIn(userId)` を呼ぶ
- **`watchCollection` は認証失敗も `onError` に流す**（`ensureSignedIn` の失敗を捕まえて `onError(error)` を呼び、購読解除関数は何もしない関数を返す）。これにより要件の「認証に失敗しても図鑑を『すべて未発見』で出す」（`zukan.html` の既存の失敗時挙動）がそのまま成立する。`card.html` / `collection.html` は従来どおり例外を受けてエラー画面を出す

### 3.3 IDトークンの期限切れ

`/auth/line` が `id_token_expired` を返したら、`liff.logout()` → `liff.login({ redirectUri: location.href })` でトークンを取り直す。無限ループ防止のため、`sessionStorage` に再ログイン済みフラグを持ち、1回試して駄目ならエラーにする（`sessionStorage` が使えない場合は再ログインせずエラーにする）。

## 4. Firestoreセキュリティルール（`backend/firestore.rules`）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(userId) {
      return request.auth != null && request.auth.uid == userId;
    }

    match /users/{userId} {
      allow get: if isOwner(userId);          // list（他人の一覧）は許可しない

      match /collection/{animalId} {
        allow get, list: if isOwner(userId);
      }
      // pendingQuiz は正解を含むため、ここに書かない（= 拒否）。ワイルドカードで許可しない
    }

    match /{document=**} {
      allow read, write: if false;            // animalMaster などその他はすべて拒否
    }
  }
}
```

- 書き込みはすべて拒否（Admin SDKはルールの対象外なのでBotの書き込みは影響しない）
- ルールのデプロイは `backend/firebase.json`（`firestore.rules` を指す）を新設し、`backend/Makefile` に `deploy-rules`（`npx firebase-tools deploy --only firestore:rules`）を追加する。元に戻すときは全拒否のルールに戻して再デプロイする

## 5. 検証（実環境。エミュレータは使えない）

新規 `backend/scripts/verify-auth-rules.mjs`（ローカル実行専用）。

1. Admin SDK で `firebase-adminsdk-fbsvc` サービスアカウントを `serviceAccountId` に指定し、ユーザーの資格情報でなりすまして、テスト用uid（`test-owner` / `test-other`）のカスタムトークンを発行する
2. Identity Toolkit の REST（`accounts:signInWithCustomToken`、Web APIキー）でIDトークンに交換する
3. Firestore REST にそのIDトークンで問い合わせ、次を確認する

| ケース | 期待 |
|---|---|
| 認証なしで `users/{owner}/collection` を読む | 403 |
| `test-other` で `users/{owner}/collection` を読む | 403 |
| `test-owner` で自分の `collection` / `users/{owner}` を読む | 200 |
| `test-owner` で自分の `pendingQuiz` を読む | 403 |
| `test-owner` で自分の `collection` に書く | 403 |
| `/auth/line` に `aud` が許可外のJWTを送る | 401 `invalid_audience` |
| `/auth/line` にボディなしで送る | 400 |

テスト用のドキュメントは `users/test-owner/…` に作り、確認後に削除する（実ユーザーのデータは触らない）。実際のLIFF IDトークンを使う通し確認は、開発のミニアプリで手動（図鑑に15種が出る）。

## 6. 初期設定・デプロイ順序

**手順0（一度だけ）**

1. Firebase Authの初期化: Firebaseコンソール → Authentication →「始める」（ログイン方法は何も有効にしなくてよい。カスタムトークンには不要）
2. IAM: Cloud Runのサービスアカウントに、自分自身に対する `roles/iam.serviceAccountTokenCreator` を付与

   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     904272649235-compute@developer.gserviceaccount.com \
     --member=serviceAccount:904272649235-compute@developer.gserviceaccount.com \
     --role=roles/iam.serviceAccountTokenCreator --project kaiyukan-gacha-hackathon
   ```

**デプロイ（この順で）**

| 順 | 内容 | 補足 |
|---|---|---|
| 1 | バックエンド（`/auth/line`、環境変数） | `cd backend && make deploy` |
| 2 | `/auth/line` の疎通（400・不正な `aud` → 401・CORS） | `createCustomToken` の実発行は本物のIDトークンが要るため、IAMバインディングの存在をここで確認し、実発行は5の通し確認で確かめる |
| 3 | フロント（開発サイト） | `make deploy-liff-dev` |
| 4 | ルール | `cd backend && make deploy-rules` |
| 5 | 検証スクリプトと、開発のミニアプリでの通し確認 | 15種が図鑑に出る |
| 6 | 本番Hosting | 5が通ってから `CONFIRM_785_DONE=yes make deploy-liff` |

3〜4の間（フロントは新しく、ルールはまだ全拒否）は図鑑が空になるだけで、他人のデータが見えることはない。

## 7. 影響する既存ファイル

`backend/src/server.ts`（ルート追加）／`backend/Makefile`・`env.sample`／`backend/firestore.rules`（書き換え）／`backend/firebase.json`（新規）／`frontend/shared/{config,liff-client,firestore-client}.js`。`zukan.html` の表示ロジックは変更なし。

## 8. リスク・トレードオフ

- `/auth/line` は認証なしで公開されるが、LINEの署名検証を通ったIDトークンにしかトークンを発行しない。レート制限はハッカソンの規模では入れない
- 許可するチャネルIDは環境変数で持つので、Review用を使う場合はここに追加するだけで済む
- 未審査ミニアプリのPublishedでは、通常の同意画面（`openid`）が出る。`sub` の取得には十分
- uidをLINE userIdそのものにするので、カスタムトークンが漏れると当該ユーザーの `collection` が読める（有効期限1時間・読み取りのみ・書き込みなし）

## 9. requirements の未確定事項の決定

| 未確定事項 | 決定 |
|---|---|
| Firebase Authの有効化 | 未初期化と判明。手順0で初期化する |
| `signBlob` 権限 | Editorには無い。手順0で `serviceAccountTokenCreator` を自分自身に付与する |
| CORSの実装 | 手書きミドルウェア（2.5）。`express.json()` は `/auth/line` だけ（2.1） |
| `?debugUserId=` | localhost / 127.0.0.1 限定にする（3.1） |
| WebViewでのセッション維持 | 既定の永続化＋フォールバック。維持できなくても各ページで再サインインできる（3.2） |
