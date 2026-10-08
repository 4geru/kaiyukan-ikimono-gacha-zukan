Issue: https://github.com/4geru/tweet-bookmark/issues/785

# 要件定義: LIFF × Firestore 認証（LINE Login + セキュリティルール）

Part of #779。Issue #785 の3点（LINE Loginでのユーザー識別／Firestoreデータモデル／LINE側とLIFF側のリアルタイム同期）のうち、**データモデル（[779design.md](../779-ikimono-gacha-zukan/design.md) 1.3節）とバックエンドの書き込みは実装済み**。本ドキュメントは残りの「LIFFのブラウザからFirestoreを安全に読む」部分（認証とセキュリティルール）を扱う。

調査メモ: [liff-firebase-custom-token-auth.md](../../research/liff-firebase-custom-token-auth.md) / [line-miniapp-setup.md](../../research/line-miniapp-setup.md)

## 背景・現状

- LIFF（LINEミニアプリ）の図鑑ページを開いても、発見済みの生きものが表示されない。原因は**ブラウザがFirebase Authにログインしておらず、`firestore.rules` が全拒否**のため（認証なしで `users/{id}/collection` を読むと `403 PERMISSION_DENIED` になることを確認済み。データ自体は正しく保存されている）
- LIFFで取得できるLINE userIdと、Firestoreの `users/{lineUserId}` のIDは同じ値（BotとLIFFが同一Provider）
- LIFF IDは発行済み（Developing / Published）、フロントは Firebase Hosting の開発サイトにデプロイ済み

## 決定事項

### 1. 認証方式: Firebase Authのカスタムトークン

バックエンドがLINEのIDトークンを検証し、LINE userIdをuidとするFirebase Authのカスタムトークンを発行する。ブラウザは `signInWithCustomToken` でログインし、これまでどおり `onSnapshot` でFirestoreを直接購読する。

- 採用理由: 779/784のdesignの前提（クライアントが `users/{id}/collection` を直接 `onSnapshot`）と、実装済みの `frontend/shared/firestore-client.js` をそのまま活かせ、リアルタイム同期の要件も満たせる
- 不採用: バックエンドAPI経由の読み取り（ルールは全拒否のまま済むが、リアルタイム同期がポーリングになりクライアントも書き換えになる）

### 2. トークン検証はIDトークン + LINE verify API

`POST https://api.line.me/oauth2/v2.1/verify`（`id_token` と `client_id`）で検証し、応答の `sub` をuidにする。アクセストークン検証はuserIdを返さないため使わない。

### 3. 許可するLINEチャネル

LINEミニアプリの内部チャネルはチャネルIDがそれぞれ別のため、許可リスト方式にする。

| 内部チャネル | チャネルID |
|---|---|
| Developing | `2011666396` |
| Published | `2011666398` |

Review用は審査を申請するまで対象外。

### 4. スコープ外

- レアリティ抽選（#783）、魚博士ランク算出、知識ロック解除の書き込み（いずれも別Issue）
- LIFF IDの発行・Endpoint URLの設定（完了済み）
- `users/{userId}` 以外のコレクション設計の変更

## 受け入れ基準（EARS形式）

### 認証エンドポイント（`POST /auth/line`）

- WHEN LIFFのクライアントがIDトークンを送る THEN system SHALL LINEのverify APIで検証し、`sub` をuidとするFirebaseカスタムトークンを返す
- IF リクエストにIDトークンが無い THEN system SHALL 400を返す
- IF IDトークンの `aud` が許可リスト（決定事項3）に無い THEN system SHALL 401を返し、verify APIを呼ばない
- IF LINEの検証が失敗する（署名不正・期限切れ等） THEN system SHALL 401を返し、期限切れの場合はクライアントが再ログインを判断できるよう区別できるエラー内容を返す
- system SHALL 許可チャネルIDを環境変数で設定できるようにし、コードに直書きしない
- system SHALL IDトークンとカスタムトークンをログに出力しない
- system SHALL CORSで許可するオリジンをFirebase Hostingの2サイト（`kaiyukan-gacha-dev.web.app` / `kaiyukan-gacha-hackathon.web.app`）に限定する
- system SHALL 既存の `/webhook`（LINE署名検証）の動作に影響を与えない

### フロントエンド（LIFF）

- WHEN LIFFの初期化が完了する THEN system SHALL IDトークンを取得して `/auth/line` に送り、返ったカスタムトークンで `signInWithCustomToken` を行ってからFirestoreの購読を始める
- IF IDトークンが期限切れで `/auth/line` が拒否する THEN system SHALL `liff.login()` でトークンを取り直す
- IF 認証に失敗する THEN system SHALL 図鑑を「すべて未発見」で表示し、読み込めなかったことをユーザーに伝える（現在の `zukan.html` の失敗時の挙動を維持する）
- WHILE ローカル（localhost）で `?debugUserId=` を使う THE system SHALL 従来どおりモックデータで動作する
- WHERE localhost以外で `?debugUserId=` が付いている THE system SHALL Firestoreの認証を得られないため、他人のデータを読めない（ルールで担保する）

### Firestoreセキュリティルール

- WHEN 認証済みユーザーが `users/{userId}` またはその `collection/{animalId}` を読む AND `request.auth.uid == userId` THEN system SHALL 読み取りを許可する
- IF 未認証、または `request.auth.uid` が `userId` と異なる THEN system SHALL 読み取りを拒否する
- system SHALL クライアントからの書き込みをすべて拒否する（バックエンドのAdmin SDKはルールの対象外のため影響しない）
- system SHALL `users/{userId}/pendingQuiz` をクライアントから読めないようにする（正解 `correctIndex` を含むため）。許可するパスは明示し、`users/{userId}/{document=**}` のようなワイルドカードは使わない
- system SHALL `animalMaster` などその他のコレクションをクライアントから読めないようにする

### 表示（エンドツーエンド）

- WHEN 認証済みのLIFFで図鑑ページを開く THEN system SHALL そのユーザーの発見済みの生きものを表示する（現在の検証ユーザーでは15種）
- WHEN LINEのBotが新しい生きものを発見済みにする THEN system SHALL 開いている図鑑ページに購読で自動反映する
- WHEN 図鑑ページ以外（カード・コレクション帳）を開く THEN system SHALL 同じ認証で `collection` / `users` を読める

### IAM・運用

- system SHALL Cloud Runのサービスアカウントが `createCustomToken` を実行できる権限（`iam.serviceAccounts.signBlob` を含むロール）を持つようにする
- system SHALL デプロイ順を「バックエンド（`/auth/line`）→ フロント → ルール」とし、ルールを先に締めた／開けた状態でフロントが壊れないようにする
- WHEN 本受け入れ基準がすべて満たされる THEN system SHALL 本番Hostingのデプロイガード（`CONFIRM_785_DONE`）の前提を満たしたものとして扱う

## 検証方法（受け入れテスト）

エミュレータ（Java）は使えないため、実環境で検証する。

- 認証なしで `users/{id}/collection` を読むと拒否される（REST）
- 別のuidのトークンで他人の `collection` を読むと拒否される
- 自分のuidのトークンで `collection` を読める。`pendingQuiz` は読めない
- 開発のミニアプリで、発見済みの生きものが図鑑に表示される
- IDトークンの `aud` が許可リスト外なら `/auth/line` が401を返す

## 未確定事項（設計フェーズで詰める）

- Firebase AuthがFirebaseコンソールで有効化済みか（APIは有効だが、カスタムトークンでのサインインは実装時に確認）
- Cloud Runのサービスアカウントに `signBlob` 権限があるか。無ければ `roles/iam.serviceAccountTokenCreator` の付与が必要
- CORSの実装方法（`cors` パッケージか手書きか）と、`express.json()` を `/auth/line` だけに付ける構成
- 本番でも残る `?debugUserId=` の分岐を、localhost限定にするかどうか
- カスタムトークン発行後のFirebaseセッション（IndexedDBに保存される）をLIFFのWebViewで維持できるか
