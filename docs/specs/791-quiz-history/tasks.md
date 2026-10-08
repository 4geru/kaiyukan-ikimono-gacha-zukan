Issue: https://github.com/4geru/tweet-bookmark/issues/791

# タスク: クイズの出題履歴（quizHistory）と「過去5問と被らない」出題

承認済みの [design.md](./design.md) を上から順に実装する。1つ終えるごとにチェックを付ける。

## 1. カテゴリ選定ロジック

- [x] `backend/src/quiz.ts`: `QUIZ_HISTORY_WINDOW` / `QuizHistoryEntry` / `QuizCategoryPlan` / `planQuizCategory` を追加する（design §3）
- [x] `backend/scripts/try-quiz-plan.ts`（新規）: `planQuizCategory` を `assert` で検証する（design §8: 履歴0件→候補13件 / 直近が不正解→retry / 5件→候補8件で直近5件を含まない / 3件→候補10件 / 6問連続でも直近5問と被らない）
- [x] `try-quiz-plan.ts` を実行して全ケースが通ることを確認する（`npx tsx` はサンドボックス下で `listen EPERM` になるため、解除して実行する）

## 2. ADK エージェント

- [x] `backend/src/quizAgent.ts`: `generateQuizWithAgent` の第2引数を `candidateCategories` に変え、既出カテゴリの除外・リセット処理と `AgentQuizResult.categoriesWereReset` を削除する。冒頭コメント（14行目付近・30行目付近）を新しい仕様に合わせる（design §5）
- [x] `backend/scripts/try-quiz-agent.ts`: CLI 引数を「除外するカテゴリ」として扱い、`QUIZ_CATEGORIES` から除いた候補を `generateQuizWithAgent` に渡す

## 3. サーバー（Bot 本体）

- [x] `backend/src/server.ts`: `quizHistoryCollection(userId, animalId)` と `getRecentQuizHistory(userId, animalId)`（`askedAt` 降順・最大5件、失敗時は `console.warn` して `[]`）を追加する（design §4.1）
- [x] `backend/src/server.ts`: `handleStartQuiz` を `planQuizCategory` 経由に書き換える。`findAnimalById` と `getRecentQuizHistory` は並列のまま。`retry` は従来の出し直し経路、`fresh` は `generateQuizWithAgent(animal, plan.candidates)`。`QuizSelectionState` / `getQuizSelectionState` を削除する
- [x] `backend/src/server.ts`: `savePendingQuiz` から `categoriesWereReset` の引数・フィールド・コメントを削除する
- [x] `backend/src/server.ts`: `handleAnswerQuiz` のトランザクションを design §4.2 の形にする（`historyRef` はトランザクション外で `.doc()`、`quizHistory` へ `category` / `question` / `askedAt` / `isCorrect` を追加、`colRef` の書き込みは `updatedAt` のみ）。`FieldValue` が他で使われていなければ import も整理する
- [x] `backend/src/server.ts`: `handleSelectFish` の初回登録から `askedQuizCategories: []` を削除する
- [x] `backend/scripts/try-firestore.ts`: サンプルデータから `askedQuizCategories` を削除する
- [ ] `cd backend && npm run typecheck` が通ることを確認する

## 4. Firestore セキュリティルール

- [x] `backend/firestore.rules`: `match /animals/{animalId}/quizHistory/{historyId}`（`allow get, list: if isOwner(userId)`）を追加し、冒頭コメントに許可パスを追記する（design §6）
- [x] `backend/scripts/verify-auth-rules.mjs`: quizHistory のケースを追加する（自分の履歴は読める / 他人の履歴は403 / 自分でも書き込みは403。`pendingQuiz` が読めないケースは既存のまま）。テスト用ドキュメントは `users/test-owner/…` に作って終了後に削除する
- [ ] `cd backend && make deploy-rules` でルールを反映し、`verify-auth-rules.mjs` を実行して全ケースが通ることを確認する

## 4.5 エージェント出力の排他制御（追補）

- [x] `backend/src/quiz.ts`: 純粋関数 `pickAllowedCandidate` を追加する（design §5 の追補）
- [x] `backend/src/quizAgent.ts`: 選ばれたカテゴリを `pickAllowedCandidate` で強制する（差し替え時は `console.warn` と `selectionReason` への追記、候補内が0件なら例外）
- [x] `backend/scripts/try-quiz-plan.ts`: `pickAllowedCandidate` のケースを追加して実行し、通ることを確認する

## 5. デプロイと実機確認

- [ ] `cd backend && make deploy` でデプロイする
- [ ] 実機（LINE）で確認する（design §8）
  - [ ] 回答後に `users/{userId}/animals/{animalId}/quizHistory/{id}` が1件増え、`choices`（3件）と `correctIndex` が入っている
  - [ ] 不正解 → 同カテゴリで出し直し → 回答で、同カテゴリの履歴が2件になる
  - [ ] 正解した次の出題が、直近5問のカテゴリのいずれとも異なる
  - [ ] 何問か続けても直近5問のカテゴリと被らない（`make logs` に「候補外のカテゴリ」の warn が出ていれば、差し替えで守られている）
  - [ ] 同じ回答 postback の再送で履歴が増えない
  - [ ] 返信内容（正誤・キャラクターの掛け合い・クイックリプライ）が従来と変わらない

## 6. 完了後

- [ ] `backend` 側の確定事項（`quizHistory` のデータモデル、「過去5問と被らない」ルール、廃止したフィールド）を `project-google-cloud-japan-ai-hackathon-vol5/CLAUDE.md` に転記する（「クイズ」の説明と Firestore の記述を更新）
- [ ] `docs/specs/791-quiz-history/` を削除する
- [ ] Issue #791 をクローズする（`/issue-done`）
