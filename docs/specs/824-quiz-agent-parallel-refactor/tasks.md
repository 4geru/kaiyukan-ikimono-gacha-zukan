# Tasks — #824 クイズエージェント並列化

Issue: [#824](https://github.com/4geru/tweet-bookmark/issues/824) / design: [design.md](./design.md) 8 章（決定事項 2026-10-07）

## 設計・準備
- [x] design.md に決定事項と方式 W の設計を追記
- [x] tasks.md 作成

## 実装（`backend/src/`）
- [x] `quizAgentShared.ts`: 共通ロジック（実在名の事前取得、生成プロンプト、選択プロンプト、結果組み立て、シャッフル）
- [x] `quizAgentParallel.ts`: 方式 B（`Promise.allSettled` 並列 → 選ぶ LLM 1 回）
- [x] `quizAgentWorkflow.ts`: 方式 W（ADK `Workflow`）
- [x] 返り値 `AgentQuizResult` 互換を確認
- [x] `npx tsc --noEmit` が通る
- [x] 1 回ずつ動作確認（B・W が 1 問生成できる）

## 計測
- [x] `scripts/measure-quiz-agent-latency.ts`（改善前・B・W、同条件、各 3 回程度）
- [x] 計測実行（ジンベエザメ＋もう 1 種）
- [x] `measurement.md` に保存（計測前の予想を含む）

- [x] 原因切り分け `scripts/probe-quiz-single-call.ts`（思考トークンが支配的と判明）
- [ ] ユーザー判断待ち: `thinkingBudget=0` / 軽量モデルを B・W に適用して再計測するか

## 執筆
- [x] 記事を 1 本に統合（`articles/quiz-agent-adk-category-selection.md` を書き換え、`published: false`）
- [x] 数字は measurement.md のものだけを使う
- [x] 「シリーズの他の記事」節（#822・#823、リンクは公開後に差し替え）

## ユーザー判断待ち（実装しない）
- [ ] `server.ts` をどの方式（B / W / 現行維持）に切り替えるか
- [ ] 切り替え後、`quizAgent.ts` の旧実装（`findRelatedSpecies` ツール版）を削除するか
- [ ] 記事公開前の `/article-review`、リンク差し替え
