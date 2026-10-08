Issue: https://github.com/4geru/tweet-bookmark/issues/831

# Tasks: クイズの作り置き（事前生成プール）

[design.md](./design.md) 15章の T1〜T7。上から順に実装し、1つ終わるごとにチェックを付ける。

- [x] **T1** プールの読み込み・検査・マスの引き方（純粋関数）＋在庫レポート — `backend/src/quizPool.ts`・`backend/scripts/report-quiz-pool.ts`
- [x] **T2** 選択のエージェントと規則（5秒打ち切り・候補外は規則） — `backend/src/quizPoolSelector.ts`
- [x] **T3** ログ指標・Makefile・.dockerignore — `backend/ops/metrics/quiz_source.json`・`quiz_delivery_latency.json`・`backend/Makefile`・`backend/.dockerignore`
- [x] **T4** 出題・回答への接続、停止スイッチ `quiz_pool` — `backend/src/server.ts`・`backend/src/guards.ts`
- [x] **T5** 確認スクリプト（読み込み・同じ問題を出さない・選択の検証と打ち切り・停止スイッチ） — `backend/scripts/try-quiz-pool.ts`
- [ ] **T6** デプロイ・実機確認（design 10.2）・`make metrics`・before/after の計測 — **PM が行う（実装しない）**
- [ ] **T7** 記事2本・動画のセリフ（design 12章、T6 の実測値で） — **PM が別途行う（実装しない）**
