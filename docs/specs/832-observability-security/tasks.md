# Tasks — エージェントの判断ログと安全対策（可観測性・セキュリティ）

Issue: [#832](https://github.com/4geru/tweet-bookmark/issues/832) ／ requirements.md ／ design.md（末尾の「決定事項（2026-10-08）」が正）

範囲: フェーズ1・2 全部＋フェーズ3 のうち 入力の区切り・停止スイッチ・クイズの時間切れ→規則・Webhook 二重処理防止・写真の7日削除・ベースイメージ固定。**回数上限（C4）と `npm audit` は締切後**（対象外）。

`P` = `project-google-cloud-japan-ai-hackathon-vol5`。凡例: [x] 実装・確認済み ／ [ ] 未（本番に触れるため PM／ユーザーの確認後）。

## 実装タスク

### T0 土台（ログ・エージェント記録）

- [x] **T0-1** `backend/src/log.ts`（新規）: `logEvent`・`hashId`（SHA-256 先頭8桁）・`withLogContext`/`getLogContext`（AsyncLocalStorage）・`parseTraceHeader`。1行 JSON、null→`"none"`、例外は name/message のみ（stack は ERROR のみ）、危険な項目名（userId・text・座標など）は落とし userId 形式の値はマスク。完了条件: try-observability の A1/A2/A8/A9。**A1 A2 A8 A9**
- [x] **T0-2** `backend/src/agentRun.ts`（新規）: `runAgent`（runId・`agent_run` を finally で1行・時間切れ・`onFinish`）・`withToolLog`（`tool_call`）・`withLlmLog`（`llm_call`）・`logGuard`。完了条件: try-observability の A3〜A7・C6。**A3 A4 A5 A6 A7**
- [x] **T0-3** `backend/src/server.ts`: Webhook 入口で `X-Cloud-Trace-Context` を `withLogContext`、`handleEvent` で `userIdHash` の文脈と `webhook_received`、`reply`/`push` を包んで `reply_sent`、`console.*` を `logEvent` に置換（`lineAuth.ts`・`ekispert.ts` も）。完了条件: `src` に `console.*` が残らない（log.ts の出力口を除く）。**A1 A2 A6**

### T1 クイズ

- [x] **T1-1** `backend/src/quizAgent.ts`: `generateQuizWithAgent` を `runAgent` で包む（45秒の時間切れ）・`findRelatedSpecies` を `withToolLog`・`decision`（候補・選択・提案・差し替え・理由・公式データ件数）・`candidate_replaced`/`schema_invalid` の `guard`・結果に `runId`/`guard`。**A3 A4 A5 A6 C6**
- [x] **T1-2** `backend/src/server.ts` `obtainQuiz`: エージェントの失敗・時間切れ・形式不正は `generateRuleQuiz`（規則の出題）に切り替え `guard="fallback_rule"`（失敗した `runId` つき）。停止スイッチ（`quiz`）なら `agent_run(outcome=kill_switch)` を残して規則で出題。**C5 C6**
- [x] **T1-3** `backend/src/server.ts` `savePendingQuiz`/`handleAnswerQuiz`: `pendingQuiz` に `runId`/`guard` を保存し、回答トランザクション（読み取りが先・書き込みが後を維持）で `quizHistory` に `runId`・`selectionReason`・`consideredCategories`（`toHistoryCandidates`: 選択肢と正解番号を落とす）・`guard` を引き継ぐ。完了条件: try-observability の B2、トランザクション順序の静的確認。**B1 B2**

### T2 駅の水族館

- [x] **T2-1** `backend/src/stationAquariumAgent.ts`: `runStationAquariumAgent` を `runAgent` で包む（既存の25秒を `timeoutMs` に移行）・3ツールを `withToolLog`（駅名・座標はログに出さず、分数だけ）・`decision`（シナリオ・起点駅・分数・丸め・ツールの順・件数・水族館名）。**A3 A4 A5 A9**
- [x] **T2-2** `backend/src/server.ts` `saveStationAgentRun` + `firestore.rules`: `users/{uid}/agentRuns/{runId}` に判断の記録（入力の自由文は残さない）・`expireAt`（30日）。ルールは本人の get/list のみ。`scripts/verify-auth-rules.mjs` に agentRuns・`config/runtime`・`webhookEvents` のケースを追加。**B3 B5**

### T3 ガード・LLM ログ

- [x] **T3-1** `backend/src/guards.ts`（新規）: `truncateUserText`（200文字・コードポイント単位）・`buildUserInput`（`<user_message>` で区切り、`<` `>` を全角化）・`INJECTION_GUARD_NOTICE`。意図判定・雑談・駅エージェントの指示文末尾に一節、入力は `buildUserInput` 経由。`server.ts` で切り詰め時に `guard="input_truncated"`。**C1 C2**
- [x] **T3-2** `backend/src/guards.ts` + `server.ts`: 停止スイッチ（Firestore `config/runtime` を60秒キャッシュ・読めなければ止めない）。クイズ→規則、駅→定型文、雑談→定型文、写真の識別→定型文。`guard="kill_switch"`。**C5**
- [x] **T3-3** `backend/src/guards.ts` `claimWebhookEvent` + `server.ts` `handleEvent`: `webhookEvents/{webhookEventId}` を `create()`、既にあれば `webhook_duplicate` を出して処理しない（`expireAt`=1日）。ID 無し・Firestore 障害時は処理を続ける。**C7**
- [x] **T3-4** `llm_call` を意図判定・雑談・写真の識別（`identifyFish.ts`）・規則の出題（`quiz.ts` の `quiz_retry`）・ヒント（`quizHint.ts`）に追加。`identifyFish` の種名ログは `identify_extracted`、`quiz_hint` は `logEvent` 化。**A7**

### T4 運用設定ファイル・イメージ

- [x] **T4-1** `backend/ops/metrics/*.json`（8指標: `agent_runs`・`agent_failures`・`agent_latency`・`agent_input_tokens`・`agent_output_tokens`・`guard_interventions`・`llm_calls`・`error_logs`）、`ops/alerts/*.json`（失敗率30%超かつ5件以上／ERROR 15分10件超）、`ops/dashboard.json`（4グラフ）、`ops/images-lifecycle.json`（`line-images/` を7日で削除）。**A10 C8**
- [x] **T4-2** `backend/Makefile`: `metrics`・`dashboard`・`alerts`・`images-lifecycle`・`ttl-policies`・`logs-agent`・`logs-guard`（定義のみ。実行は P1）。**A10 C8 B5**
- [x] **T4-3** `backend/Dockerfile`: 2か所の `FROM` を `node:22.22.0-bookworm-slim@sha256:dd9d2197…`（`docker buildx imagetools inspect` と Docker Hub の両方で一致を確認）に固定。**C9**

### T5 レッドチーム試験

- [x] **T5-1** `backend/scripts/try-prompt-injection.ts`（新規）: 試験文18件・機械的な判定（スキーマ内・キャラ2種・口調・指示文の漏洩・乗っ取りの兆候・駅の関係ない質問は `not_found`）・`--dry` で判定の自己検査・`--max-calls`（既定10）で LLM 回数を制限。**C3**
- [x] **T5-2** 実行: 雑談7件（1・3・4・5・6・11・13）＋意図判定2件（7・8）＝LLM 9 回。結果は全て合格。駅エージェント（試験9・17 など）は MCP キー依存のため **P5** で実行。**C3**

### T6 LIFF

- [x] **T6-1** `frontend/shared/firestore-client.js`（`getQuizHistory`）・`firestore-mock.js`・`card.html`: 「これまでのクイズ（なぜこの問題？）」に、理由の一文と検討したカテゴリのチップ（選ばれたものを強調、公式データに基づくものに ✓）。古い履歴は「記録なし」。`make build-liff` で `dist-liff/` に反映。**B4**

### T7 確認スクリプト

- [x] **T7-1** `backend/scripts/try-observability.ts`（新規・LLM 不使用・18項目）: 構造化ログの形・ハッシュ・個人情報の除外・trace の引き継ぎ・`runAgent`（成功・失敗・時間切れ・停止スイッチ）・`withToolLog`・`withLlmLog`・入力の区切り・停止スイッチの読み込み（60秒・fail-open）・二重処理防止の判定・B2・`console.*` 不在・トランザクション順序。**A1〜A9 B2 C1 C2 C5〜C7**
- [x] **T7-2** `npx tsc --noEmit` と `try-quiz-level.ts`・`try-quiz-answer.ts`・`try-quiz-plan.ts` が通ることを確認。

## 本番で行う操作（PM／ユーザーの確認後。実装はしない）

デプロイは #829 とまとめて行う。順序は P1 → P2 → P3 → P4 → P5 → P6。

- [ ] **P1 ルールと TTL**: `cd backend && make deploy-rules`（agentRuns の読み取りを許可）→ `make ttl-policies`（`agentRuns`・`webhookEvents` の `expireAt` に TTL）。確認: `node scripts/verify-auth-rules.mjs` が全ケース期待どおり。**B3 B5 C7**
- [ ] **P2 デプロイ**: `make deploy`（型チェック込み。Dockerfile のダイジェスト固定もここで効く）→ `cd ../frontend && make deploy-liff-dev` で LIFF 開発サイトに反映して確認 → 問題なければ `CONFIRM_785_DONE=yes make deploy-liff`。**C9 B4**
- [ ] **P3 運用設定**: Cloud Logging の `_Default` バケットで Log Analytics を有効化（コンソール）→ `make metrics` → `make dashboard` → 通知チャネルを作り（`gcloud beta monitoring channels create`／コンソール）`make alerts NOTIFICATION_CHANNEL=projects/kaiyukan-gacha-hackathon/notificationChannels/<ID>` → `make images-lifecycle`（写真の7日削除）。**A10 C8**
- [ ] **P4 停止スイッチの初期化**: Firestore コンソールで `config/runtime` を作成 `{ disabledAgents: [], maintenanceMessage: "" }`（空のままでも動く。`disabledAgents` に `"station"` / `"quiz"` / `"chat"` / `"identify"` を入れると1分以内に効く）。確認: `station` を入れて駅の質問を送り定型文になること → 空に戻す。**C5**
- [ ] **P5 実機・デプロイ後の確認**: ①LINE でクイズ・駅の質問・雑談・写真を実行 ②Logs Explorer の下記クエリが各1件以上出る ③`gcloud logging read 'jsonPayload.event="agent_run"' --format=json | rg 'U[0-9a-f]{32}'` が0件 ④同じ Webhook を署名つきで2回送り2回目が `webhook_duplicate` ⑤`npx tsx scripts/try-prompt-injection.ts --target=station --only=7,8,9,17 --max-calls=8`（駅エージェント。実行する場合の LLM 回数に注意）⑥LIFF のカード詳細で「なぜこの問題？」が開く。**A1〜A9 B1〜B4 C5 C7**
- [ ] **P6 デモ録画**: design 6.3 の流れ。guard の行は停止スイッチ（P4）を一時的に入れて出す。

### Logs Explorer のクエリ（共通の前置き）

```
resource.type="cloud_run_revision"
resource.labels.service_name="kaiyukan-gacha-bot"
```

| # | 見たいもの | 追加する条件 |
| --- | --- | --- |
| ① | エージェントの判断の一覧 | `jsonPayload.event="agent_run"` |
| ② | クイズが検討して選んだ回 | ① ＋ `jsonPayload.agent="quiz"` |
| ③ | コードが介入した回 | `jsonPayload.event="guard"` |
| ④ | 1回の判断の全部 | `jsonPayload.runId="<12桁>"` |
| ⑤ | 1件のやり取りの旅 | `trace="projects/kaiyukan-gacha-hackathon/traces/<ID>"` |
| ⑥ | 失敗・時間切れ | ① ＋ `jsonPayload.outcome!="ok"` |
| ⑦ | 再送を止めた回 | `jsonPayload.event="webhook_duplicate"` |

## 締切後・対象外

- C4 回数上限（`users/{uid}/usage/{日付}`）。当面は停止スイッチで代える
- `npm audit`（C9 の後半）。直せない指摘は理由を README に記録
- 駅の `agentRuns` の LIFF 表示（デモでは Firestore コンソール）
