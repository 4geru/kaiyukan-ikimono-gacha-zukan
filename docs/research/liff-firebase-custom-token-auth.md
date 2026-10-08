# LIFF × Firestore 認証（カスタムトークン方式）調査メモ

調査日: 2026-09-19 / 関連: #785（LINE Login + Firestore永続化基盤）, #784（LIFFフロント）

## 結論

LIFFのブラウザからFirestoreを直接読む（`onSnapshot`）ために、**バックエンドがLINEのIDトークンを検証してFirebase Authのカスタムトークンを発行する**方式を採る。ルールは `request.auth.uid == userId` で自分の分だけ読み取り許可、書き込みは全拒否（Admin SDKはルール対象外）。

- 採用理由: 設計書の前提（クライアントが `users/{id}/collection` を直接 `onSnapshot`）と実装済みの `frontend/shared/firestore-client.js` をそのまま活かせる
- 不採用: バックエンドAPI経由の読み取り（ルールは全拒否のまま済むが、リアルタイム同期がポーリングになり、クライアント書き換えも必要）

## 認証フロー

```
LIFF(ミニアプリ)                Cloud Run (kaiyukan-gacha-bot)         LINE API      Firebase Auth
  liff.getIDToken() ──POST /auth/line──▶ ① aud を許可リストと照合
                                         ② POST /oauth2/v2.1/verify ──▶ sub(=userId) を返す
                                         ③ createCustomToken(sub) ────────────────▶ カスタムトークン
  ◀───────────── customToken ────────────
  signInWithCustomToken() → Firestoreを onSnapshot（ルール: request.auth.uid == userId）
```

## 調べて分かったこと

### LINE側

- **IDトークンで検証する**: `POST https://api.line.me/oauth2/v2.1/verify`（`id_token` と `client_id` を渡す）が `sub`（=LINE userId）などを返す。アクセストークンの検証API（`GET /oauth2/v2.1/verify`）はuserIdを返さず、プロフィールAPIの追加呼び出しが要るため使わない
- 主なエラー: `Invalid IdToken`（署名不正）/ `IdToken expired` / `Invalid IdToken Audience`（`client_id`不一致）
- **`client_id` は内部チャネルごとに別**: LINEミニアプリはDeveloping / Review / Publishedの3内部チャネルがあり、それぞれ別のチャネルIDを持つ。トークンを発行したチャネルのIDで検証しないと `Invalid IdToken Audience` になる → バックエンドは環境変数に許可するチャネルIDのリストを持ち、トークンの `aud` がリストにあることを確認してから、その値を `client_id` にして検証する
- `sub` はProviderごとに固有のuserId。Bot（Messaging API）と同じProvider内なら同じ値になる（Providerが同じことは確認済み: デフォルトのLINE公式アカウントを連携済み）
- スコープ: IDトークン取得には `openid` が必要。ミニアプリの「チャネル同意の簡略化」が有効な間は `openid` が自動で付く。ただし**未審査ミニアプリではこの簡略化はDevelopingとReviewでのみ有効**で、Publishedは通常の同意画面になる
- LIFFのIDトークンには有効期限がある。期限切れで `/auth/line` が400になった場合は `liff.login()` をやり直す

### Firebase側

- `getAuth().createCustomToken(uid)`。uidは任意の文字列（LINE userIdは `U` + 32桁hexでそのまま使える）。カスタムトークンの有効期限は**1時間**だが、`signInWithCustomToken` 後のFirebaseセッションはSDKが自動更新するので `onSnapshot` は切れない
- Cloud Run上で鍵ファイルなしに `createCustomToken` を呼ぶには、サービスアカウントに `iam.serviceAccounts.signBlob` が必要（`initializeApp()` でメタデータサーバーの資格情報を使う）
- 「LINE Login × Firebaseカスタムトークン」はFirebase公式ブログでも紹介されている定番パターン（LINEのuserIdをFirebaseのuidに再利用する）

## このプロジェクトの現状（2026-09-19時点、gcloudで確認）

| 項目 | 状態 |
|---|---|
| 有効なAPI | `identitytoolkit` / `securetoken` / `iamcredentials` / `firebaserules` / `firestore` は有効 |
| Cloud Runのサービスアカウント | `904272649235-compute@developer.gserviceaccount.com`（`roles/editor`） |
| signBlob権限 | Editorには含まれない可能性が高い → 自分自身への `roles/iam.serviceAccountTokenCreator` 付与が要る見込み。**実装時に実際に発行して確認する** |
| `firestore.rules` | 全拒否（`backend/firestore.rules`） |
| Firebase Web App | 登録済み（`frontend/shared/config.js` の `FIREBASE_CONFIG`） |
| バックエンド | Express。`/health` と `/webhook` のみ（`/auth/line` は未実装） |
| Java / firebase CLI | 未インストール → ルールのエミュレータテスト不可。デプロイ後に本物のトークンで検証する |

## ルール設計の要点

- `users/{userId}` と `users/{userId}/collection/{animalId}` だけ、`request.auth != null && request.auth.uid == userId` で読み取り許可。書き込みは全拒否
- **`users/{userId}/pendingQuiz` は読ませない**（正解 `correctIndex` が入っているため）。`users/{userId}/{document=**}` のようなワイルドカードで許可すると漏れるので、パスを明示する
- `animalMaster` はクライアントから読まない（フロントは公開マニフェストを使う）ので全拒否のまま
- ルール整備後は `?debugUserId=` で他人のデータを読むことはできなくなる（`design.md` 4節のリスクはルール側で解消される）。本番でのdebug分岐自体は、localhost限定にするか別途検討

## 実装で追加するもの

- **バックエンド**: `POST /auth/line`（IDトークン検証 → カスタムトークン発行）、CORS（LIFFページのオリジン = Endpoint URLのホストだけ許可）。`express.json()` は `/webhook` のLINE署名検証に影響しないよう、このルートだけに付ける。環境変数: 許可するLINEチャネルIDのリスト
- **フロント**: `liff-client.js` にIDトークン取得、`firestore-client.js` に `firebase-auth.js` の `signInWithCustomToken`（トークン取得後にFirestoreを購読）
- **ルール**: `firestore.rules` の書き換えとデプロイ
- **IAM**: Cloud Runのサービスアカウントへの `roles/iam.serviceAccountTokenCreator` 付与（要確認）

## 未確定・要確認

- Endpoint URL（未設定）。ホスティング先の選定は [line-miniapp-setup.md](line-miniapp-setup.md#endpoint-urlの決め方) 参照（推奨: Firebase Hosting）。CORSのオリジンはここで決まる
- ~~Developing / PublishedのチャネルID~~ → 取得済み: Developing `2011666396` / Published `2011666398`（許可リストに入れる）
- Firebase AuthがFirebaseコンソール側で「開始」済みか（APIは有効だが、実際にカスタムトークンでサインインできるかは実装時に確認）

## 参考

- [LINE Login v2.1 API reference（IDトークンの検証）](https://developers.line.biz/en/reference/line-login/)
- [LINE MINI Appの認可フロー](https://developers.line.biz/en/docs/line-mini-app/develop/channel-consent-simplification/)
- [LINE Developers Console Guide for LINE MINI App](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/)
- [Create Custom Tokens（Firebase）](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [Authenticate your Firebase users with LINE Login（Firebase Blog）](https://firebase.blog/posts/2016/11/authenticate-your-firebase-users-with-line-login/)
- [LINE LoginとFirebase Authenticationをカスタムトークンで連携（Zenn）](https://zenn.dev/kosukesaigusa/articles/line-login-with-firebase-auth-by-custom-token?locale=en)
