Issue: https://github.com/4geru/tweet-bookmark/issues/785

# タスク: LIFF × Firestore 認証

[design.md](design.md) を上から順に実装する。1タスク完了ごとにチェックを付ける。「（あなた）」はユーザー操作が必要なもの。

## 0. 初期設定

- [x] Firebase Authの初期化（コンソール「始める」。Identity Toolkit の `config` が 200 になったことを確認済み）
- [x] IAM: Cloud Runのサービスアカウントに、自分自身への `roles/iam.serviceAccountTokenCreator` を付与し、バインディングを確認する

## 1. バックエンド（`/auth/line`）

- [x] `backend/src/lineAuth.ts`: 設定読み込み（`LINE_LOGIN_CHANNEL_IDS` / `AUTH_ALLOWED_ORIGINS`）、`aud` の読み取りと許可リスト照合、LINE verify API 呼び出し、`createCustomToken`、エラー応答（design 2.2）
- [x] `lineAuth.ts`: CORSミドルウェア（design 2.5）
- [x] `backend/src/server.ts`: `/auth/line`（`OPTIONS` と `POST`、`express.json()` はこのルートだけ）を登録
- [x] `npm run typecheck`
- [x] `backend/Makefile`（`--set-env-vars` の区切り変更と2変数の追加）と `backend/env.sample` を更新
- [x] ローカルで確認（ダミーのLINE環境変数で起動）: ボディなし→400、許可外の `aud`→401 `invalid_audience`、許可オリジンのプリフライトに CORS ヘッダーが付く、許可外オリジンには付かない、`/webhook` の署名検証が従来どおり動く
- [x] `cd backend && make deploy`
- [x] Cloud Run で疎通確認（400 / 401 / CORS）と、IAMバインディングの存在確認

## 2. フロントエンド

- [x] `shared/config.js`: `AUTH_API_URL` を追加
- [x] `shared/liff-client.js`: `getIdToken()` / `reloginForFreshToken()` を追加し、`?debugUserId=` をlocalhost / 127.0.0.1限定にする
- [x] `shared/firestore-client.js`: `firebase-auth.js` の読み込み、`ensureSignedIn`、3つの読み取り関数への組み込み、`watchCollection` が認証失敗を `onError` に流す（design 3.2）、期限切れ時の1回だけの再ログイン（design 3.3）
- [x] ローカル（モック経路）で `zukan.html` の3状態（正常 / 読み込み中 / 失敗）が壊れていないことをPlaywrightで確認
- [x] `make deploy-liff-dev`

## 3. ルール

- [x] `backend/firestore.rules` を design 4節の内容に書き換える
- [x] `backend/firebase.json` を新規作成し、`backend/Makefile` に `deploy-rules` を追加
- [x] `backend/scripts/verify-auth-rules.mjs` を作成（design 5節の7ケース。テスト用ドキュメントは `users/test-owner/…` に作って終了後に削除）
- [x] `cd backend && make deploy-rules`
- [x] 検証スクリプトを実行し、全ケース（13件）が期待どおりになる。加えて、偽のLIFF＋本物のFirebase Auth/ルールでブラウザのE2E（図鑑17種・カード遷移・`/auth/line` は1回のみ）も確認済み

## 4. 通し確認（開発のミニアプリ）

- [ ] （あなた）開発の図鑑（`https://miniapp.line.me/2011666396-dgz7LpbK/zukan.html`）を開き、発見済みの15種が表示される
- [ ] （あなた）カードをタップして `card.html` が開き、知識ページが表示される
- [ ] （あなた）LINEのBotで新しい生きものを発見し、開いている図鑑に自動で反映される

## 5. 本番・後片付け

- [ ] （あなた）本番Hostingのデプロイ: `cd frontend && CONFIRM_785_DONE=yes make deploy-liff`（権限チェックで私からは実行できなかったため）
- [ ] 本番のミニアプリでも図鑑が表示されることを確認
- [ ] requirements / design の確定事項を `project-google-cloud-japan-ai-hackathon-vol5/CLAUDE.md`（構成・アーキテクチャ・未実装TODO）に転記し、`docs/specs/785-liff-firebase-auth/` を削除する（tasks.md も残さない）
- [ ] `frontend/Makefile` の `deploy-liff` のコメント（#785完了までのガード）を、完了後の運用に合わせて整理する
- [ ] （あなた）GitHub Issue #785 の更新・クローズ
