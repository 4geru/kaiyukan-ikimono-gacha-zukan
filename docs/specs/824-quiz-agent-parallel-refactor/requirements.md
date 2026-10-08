# Requirements — 解説記事: クイズエージェントの複数候補生成を並列化して速くする

Issue: [#824](https://github.com/4geru/tweet-bookmark/issues/824)（親: [#821](https://github.com/4geru/tweet-bookmark/issues/821)）

## 目的

ADK のクイズエージェント（`backend/src/quizAgent.ts` の `generateQuizWithAgent`）の待ち時間を、**実際にリファクタして縮め**、その前後（改善前の何が遅いか → 何を変えたか → 計測結果）を Zenn 記事として公開できる状態にする。コード変更と記事の両方を成果物とする。

## 前提（コードで確認済みの事実）

- 現状は、候補カテゴリ全部（`QUIZ_CATEGORIES` は 13 件）の完成形三択クイズを **1 回の LLM 出力（`consideredCategories`）でまとめて作り**、同じ出力内で 1 つを選ぶ（`category` / `selectionReason`）。`quizAgent.ts` は 206 行、単一の `Agent`（既定モデル `gemini-2.5-flash`、環境変数 `QUIZ_AGENT_MODEL` で上書き可）＋ `findRelatedSpecies` ツール 1 つ。
- 候補は呼び出し元（`server.ts` の `generateQuizWithAgent(animal, plan.candidates)`、333 行目付近）が `planQuizCategory` で決める（過去 5 問と被らないもの）。候補外の選択は `pickAllowedCandidate` で関数的に差し替える。
- 呼び出し結果の `quiz` / `selectionReason` / `consideredCategories` は `savePendingQuiz` で pendingQuiz に保存される（自律性の可視化に使う）。
- 候補の並びは提示順バイアス対策として毎回シャッフルしている。
- 待ち時間は `docs/2026-09-19-03-20-adk-quiz-integration.md` に「ローカルで約 24 秒（`findRelatedSpecies` 呼び出しを含む場合）」と記録されている。Cloud Run 上は未計測。
- `backend/scripts/try-quiz-agent.ts` が所要時間（ms）と全候補・選択結果を表示する。生き物名と除外カテゴリを引数で指定できる。
- 既存下書き `articles/quiz-agent-adk-category-selection.md`（`published: false`、設計解説）がある。見出しは「全部作ってから選ぶ」「提示順バイアス」「候補外選択への防御」「実在種のグラウンディング」「決定論的経路との使い分け」「実測レイテンシと 2 段階応答」など。
- 本リファクタの具体案（ParallelAgent / サブエージェント / `Promise.all` 等）は **Design で決める**。ここでは決めない。

## 想定読者

- ADK（TypeScript）で LLM エージェントを作り始めた人
- 「複数案を作らせて選ばせる」構成が遅くて困っている人
- 並列化・ツール呼び出し順の見直しで体感待ち時間を縮めたい人

## 受け入れ基準（EARS）

### A. リファクタ（性能・互換性・計測）

1. WHEN リファクタ前の実装を計測する THEN system SHALL `scripts/try-quiz-agent.ts`（またはその拡張）で、同じ生き物・同じ候補・同じモデルで複数回（回数は Design で決める）計測し、中央値とばらつきを記録する。過去記録の約 24 秒をそのまま「改善前」として使わない
2. WHEN リファクタ後の実装を計測する THEN system SHALL 改善前と同条件で計測し、改善前後の所要時間を並べて比較できる形（表）で記録する
3. WHEN 計測結果が目標値に届かない THEN system SHALL 届かなかった事実とその理由を記事に書き、目標を後から動かさない
4. WHEN `generateQuizWithAgent` を呼ぶ THEN system SHALL 関数シグネチャ（`animal`, `candidateCategories`）と戻り値の型 `AgentQuizResult`（`quiz` / `selectionReason` / `consideredCategories`）を維持し、`server.ts` 側の呼び出しを変更せずに動く
5. WHEN エージェントが出題を決める THEN system SHALL 「全部の候補カテゴリについて完成形クイズを作ってから 1 問を選ぶ」という見せ方を維持し、`consideredCategories` と `selectionReason` を従来どおり pendingQuiz に保存できる
6. IF `candidateCategories` に含まれないカテゴリが選ばれた THEN system SHALL 従来どおり候補内のカテゴリに差し替え、警告ログを出す
7. IF 並列実行中の一部の生成が失敗または不正な出力を返した THEN system SHALL 失敗した候補を除いた残りで選択を続行する。全候補が失敗した場合は従来と同様にエラーを投げる（候補を何件以上で続行とするかは Design で決める）
8. WHEN 同じ生き物で複数回出題する THEN system SHALL 提示順バイアス対策（選ぶ段階での候補順シャッフル等）を損なわない
9. WHEN `類似した仲間` / `同じ水槽にいる魚` を作る THEN system SHALL 実在しない種を捏造しない（`findRelatedSpecies` の結果に基づく）という既存のグラウンディング要件を満たす
10. WHEN リファクタを完了する THEN system SHALL 型チェック（`tsc`）と既存テストが通り、`try-quiz-agent.ts` で実際に 1 問生成できることを確認する

### B. 記事

11. WHEN 記事にコード・数値・カテゴリ数・モデル名を載せる THEN system SHALL リファクタ後の実コードおよび本リファクタで取った計測結果と一致させ、一致しない記述は修正または削除する
12. WHEN 記事に所要時間を載せる THEN system SHALL 計測条件（モデル、生き物、候補数、実行回数、ローカル実行であること）を併記する。Cloud Run 上の値は実測しない限り載せない
13. WHEN 読者が冒頭を読む THEN system SHALL 「何が遅かったか」「どう速くしたか」「何秒から何秒になったか」が分かる
14. WHEN 記事で改善前後を説明する THEN system SHALL 前後の違い（1 回の出力にまとめて作る → 並列に作って選ぶ）を、表または図で一目で分かるようにする
15. WHEN 記事で全体の流れを図示する THEN system SHALL 関数単位のシーケンス図ではなく、段階単位の「リクエストの旅」の図にし、図にクラス名・メソッド名を書かない
16. WHEN 並列化の副作用（トークン消費・API 呼び出し回数・レート制限・コスト、候補間の独立性による質の変化）がある THEN system SHALL 記事でトレードオフとして触れる（測れたものは数値で、測っていないものは「未計測」と明記）
17. WHEN 記事をまとめる THEN system SHALL 既存下書き `quiz-agent-adk-category-selection.md`（「全部作ってから選ぶ」設計）を本記事に統合して1本にし、「設計 → 24秒かかった → 並列化で何秒になったか」の流れで書く
18. WHEN 記事を仕上げる THEN system SHALL シリーズ（#821 親、#822 提出記事、#823 駅すぱあと MCP 記事）への導線を置き、未公開記事のリンク先は後で差し替えられる形にする
19. WHEN 執筆が完了する THEN system SHALL `/article-review` で複数観点レビューを行い、客観的な指摘を反映する
20. IF 記事に API キー・トークン・非公開 URL が含まれる THEN system SHALL 削除する
21. WHEN 記事を置く THEN system SHALL `articles/` 配下に `published: false` で作成し、Zenn への公開はユーザーが判断する

## スコープ外

- 駅すぱあと MCP 側のエージェント（#823）の変更
- 「正解後・初回」以外の経路（不正解時に同カテゴリへ再挑戦する決定論的経路 `generateQuizForAnimal`）の変更
- 2 段階応答（ローディング表示 → pushMessage）の仕組み自体の変更
- Cloud Run 上での実機レイテンシ計測・デプロイ
- Zenn への公開操作

## 未決の論点（ユーザー判断を仰ぐ）

1. **既存下書きの扱い**: (a) 前編として残し本記事を後編にする / (b) 本記事に統合して 1 本にする / (c) 下書きは「設計」、本記事は「速度改善」と独立させ相互リンクのみ
2. **性能目標値**: 現状の約 24 秒はコードからは根拠を持てない過去記録のため、断定しない。候補: (a) 半減（約 12 秒）/ (b) 10 秒台前半 / (c) 数値目標は置かず「改善前後を測って正直に書く」。なお LINE reply token の失効回避は pushMessage 方式で既に対処済み
3. **並列化の方式**: ParallelAgent / サブエージェント / `Promise.all` でカテゴリごとに生成 → 選ぶ役へ渡す、のどれにするか、カテゴリ 13 件を 1 件ずつ並列にするかグループ化するか（Design で比較して決める。記事で比較表にする案もある）
4. **選ぶ役の実装**: 選択も LLM に任せる（自律性の見せ方を維持）か、生成済み候補を渡す軽量 LLM 呼び出しにするか。後者はもう 1 回の LLM 往復が増える
5. **`findRelatedSpecies` の扱い**: 必要な 2 カテゴリ（類似した仲間 / 同じ水槽にいる魚）だけ・先に（LLM 呼び出し前に）決定論的に実行する案と、ツール呼び出しのままにする案
6. **モデル・スキーマの軽量化**: 並列化と同時に行うか（改善要因が混ざり、記事の因果が曖昧になる）、別段階として分けて計測するか
7. **計測の粒度**: 実行回数、対象の生き物（ジンベエザメ固定か複数か）、改善要因ごとの段階計測（1 段階ずつ測る）を行うか
8. **品質の確認**: 並列化でクイズの質（カテゴリの偏り・ダジャレへの収束）が変わるかを、どこまで確認して記事に載せるか

## 決定事項（2026-10-07 ユーザー回答）

- 未決論点 1（既存下書きの扱い）: **(b) 本記事に統合して1本にする**。タイトルは結果（改善前後の秒数）を入れる型にする
- 記事の型はシリーズ共通方針に従う: 結果入りタイトル・冒頭 TL;DR・比較は表（Zenn 人気記事の調査結果、`823-ekispert-mcp-agent-article/design.md`「記事の方向性」）
- 未決論点 2〜8 は Design で比較して決め、提示する
