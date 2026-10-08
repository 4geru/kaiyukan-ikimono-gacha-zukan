# backend

LINE Bot の本体です。Cloud Run（Node.js / TypeScript、Express）で動き、LINE の Webhook を受けて、写真の読み取り・図鑑への登録・クイズ・駅から行ける水族館さがし・キャラクターの掛け合いを行います。図鑑ページ（LIFF）のログインもここで受けます。

起動とデプロイの手順は、ルートの [README](../README.md#ローカルでの動かし方とデプロイ) を見てください。

## src/

| ファイル | 役割 |
| --- | --- |
| `server.ts` | 入口。Webhook の受け取りと、写真・クイズ・駅・雑談への振り分け、`/auth/line`・`/auth/demo` |
| `identifyFish.ts` | 解説パネルの写真を Gemini で読み、海遊館の243種と全件照合して候補を返す |
| `quiz.ts` | 三択クイズの生成（13カテゴリ）と、選べるカテゴリの検証 |
| `quizAgent.ts` / `quizAgentShared.ts` | ADK のクイズのエージェント（候補を作って比べ、1問を選ぶ） |
| `quizAgentParallel.ts` / `quizAgentWorkflow.ts` | 並列化の検証用（本番では使っていない。`scripts/` の計測から呼ぶ） |
| `quizPool.ts` / `quizPoolSelector.ts` | 作り置きの問題（`data/quiz-pool/`）から1問を選ぶ |
| `quizLevel.ts` / `quizLevelAgent.ts` | 難しさ（5段階）。エージェントが理由つきで決め、コードが1段・8秒の枠をかける |
| `quizHint.ts` / `quizAnswer.ts` | まちがえたときのヒント（正解が入っていないかの検査）と、回答の判定 |
| `stationAquariumAgent.ts` | 駅から行ける水族館を探す ADK エージェント（駅すぱあと MCP を FunctionTool で包む） |
| `ekispert.ts` / `nearestAquarium.ts` / `aquariumData.ts` | 駅すぱあと REST API と、位置情報から最寄りの水族館、関西15館のデータ |
| `characters.ts` / `characterChat.ts` | 2人のキャラ（`sender` で名前とアイコンを切り替え）と、雑談の掛け合い |
| `flexMessages.ts` / `welcomeMessage.ts` | LINE の Flex Message と、友だち追加のウェルカムメッセージ |
| `guards.ts` | 入力の区切り・長さ、停止スイッチ、出力の後始末（URL 除去・口調と漏洩の確認） |
| `agentRun.ts` / `log.ts` | エージェントの判断の記録と、構造化ログ（利用者 ID はハッシュ） |
| `lineAuth.ts` | LIFF の ID トークンを検証して Firebase のトークンを発行。デモ用のトークンも |
| `firestore.ts` / `storage.ts` / `kaiyukanData.ts` | Firestore・Cloud Storage への接続と、海遊館データの読み込み |

## そのほか

| 場所 | 中身 |
| --- | --- |
| `data/` | 海遊館の生きもの（243種）・展示エリア、関西の水族館（15館）、作り置きの問題（`quiz-pool/`、15種・790問） |
| `scripts/` | データの取得・投入、作り置きの問題の作成と検証、計測、動作確認（`try-*`）、デモユーザーの作成など |
| `test/` | 自動テスト（`npm test`、Node 標準のテストランナー）。名前・水槽名の照合と候補カードの表示 |
| `ops/` | ログ指標・ダッシュボード・アラート、写真の自動削除の設定（`make metrics` などで作る） |
| `samples/` | Flex Message の見本 JSON |
| `firestore.rules` | Firestore のセキュリティルール（本人の記録だけ読める、書き込みは全拒否） |
| `env.sample` | 環境変数の見本 |
| `Makefile` | `make deploy`・`make logs` など |
