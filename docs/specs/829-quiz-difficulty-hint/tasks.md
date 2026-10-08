# Tasks — クイズの難易度レベルとヒント付き再挑戦

Issue: [#829](https://github.com/4geru/tweet-bookmark/issues/829) / 承認済み: [requirements.md](./requirements.md)・[design.md](./design.md)（2026-10-08 深掘り改訂版。章番号は改訂版のもの）

## 前提

- 方式は **B 案**（難易度コーチを別の軽い呼び出しで先に決める）。ヒントありの正解は規則ではレベル据え置き。学習状況は `users/{uid}.quizProfile`。2択の返信はヒントを最大6秒待って reply
- 呼び名: 1 ちびっこ／2 みならい研究員／3 研究員／4 ベテラン研究員／5 お魚博士。**初期値はレベル2**（未保存・読み取り失敗も2）
- パスはすべて `project-google-cloud-japan-ai-hackathon-vol5/backend/` からの相対
- 締切 2026-10-15。**優先度**: 【必須】＝これが無いと受け入れ基準を満たさない／【できれば】＝間に合わなければ削る（削った場合の代替を併記）
- 担当モデル: 判断・プロンプト・トランザクションを含むものは Sonnet、型どおりに書けば済むものは Haiku
- プロンプトの文面（design 5.2 の表・5.4 の補足・6.3・7.2・7.3）は**design の文面をそのまま定数にする**。実装者が言い回しを変えない（変えたい場合は PM に戻す）
- コマンドの注意: `npx tsx` はサンドボックス下で `listen EPERM` になることがある（その場合は解除して実行）。Gemini を呼ぶスクリプトは `.env` の `GEMINI_API_KEY` が要る

## レーン構成と順序

```
レーン0（共通の型・関数シグネチャを固める。全部スタブでコンパイルが通る状態にする）
   │
   ├── レーンA: 難易度（quizLevel.ts の中身・quizLevelAgent.ts・quiz.ts・quizAgent.ts）
   ├── レーンB: ヒントと表示（quizHint.ts・flexMessages.ts）
   └── レーンC: 回答判定と結合（quizAnswer.ts・server.ts・firestore.rules・verify-auth-rules.mjs）
   │
レーンV（A・B・C が揃ってから: 全体の tsc・評価スクリプト・デプロイ前の確認・デプロイ・実機）
```

| レーン | 触るファイル（このレーンだけが編集する） | 推奨モデル | 見積もり |
| --- | --- | --- | --- |
| 0 | `src/quizLevel.ts`（新規・型と定数）、`src/quizLevelAgent.ts`（新規・スタブ）、`src/quizHint.ts`（新規・スタブ）、`src/quiz.ts`・`src/quizAgent.ts`（引数と任意フィールドの追加だけ）、`src/flexMessages.ts`（`QuizToPresent` のフィールド追加だけ） | Sonnet | 1.5h |
| A | `src/quizLevel.ts`、`src/quizLevelAgent.ts`、`src/quiz.ts`、`src/quizAgent.ts`、`scripts/try-quiz-level.ts`（新規）、`scripts/try-quiz-level-agent.ts`（新規）、`scripts/try-quiz-category.ts` | Sonnet（A3・A6 は Haiku 可） | 5.5h |
| B | `src/quizHint.ts`、`src/flexMessages.ts`、`scripts/try-quiz-hint.ts`（新規）、`scripts/print-quiz-flex-sample.ts` | Sonnet（B4・B5 は Haiku） | 4h |
| C | `src/quizAnswer.ts`（新規）、`src/server.ts`、`firestore.rules`、`scripts/try-quiz-answer.ts`（新規）、`scripts/verify-auth-rules.mjs` | Sonnet（C1・C2 は Haiku 可） | 6h |
| V | なし（確認のみ。不具合はそのファイルのレーンへ戻す） | Sonnet | 3h |

合計 約20h（並列時の実時間は 0 → max(A,B,C) → V で約 10〜11h ＝ 2日）。

---

## レーン0: 共通の型・関数シグネチャ（最初に1人で行う）

ここで決めたインターフェースが各レーンの契約。**レーン A・B・C はこの名前・引数・戻り値を変えない**（変える必要が出たら作業を止めて PM に戻す）。

- [x] **0-1 `src/quizLevel.ts` を新規作成（型・定数・表示用の関数は本実装、判定の関数はスタブ）**【必須】 Sonnet
  - 対応基準: 1, 2, 6, 7, 15, 20
  - 下の「インターフェース」のとおり。`QUIZ_LEVELS`・`LEVEL_EXCLUDED_CATEGORIES`・`LEVEL_CATEGORY_NOTES`・`levelLabel`・`buildLevelGuidance` は design 5.1・5.2・5.4 の文面で本実装する（他レーンがすぐ使うため）。それ以外の関数は「据え置き・空・null を返す」最小のスタブ（中身はレーンA）
  - 完了条件: `cd backend && npx tsc --noEmit` が通る
- [x] **0-2 `src/quizLevelAgent.ts` を新規作成（スタブ）**【必須】 Sonnet
  - `decideQuizLevel` は常に `decidedBy: "rule", fallbackCause: "no_new_answers", direction: "keep"` の据え置きを返すスタブ
  - 完了条件: tsc が通る
- [x] **0-3 `src/quizHint.ts` を新規作成（スタブ）**【必須】 Sonnet
  - `generateQuizHint` は常に `{ hint: fallbackHint(level), hintSource: "fallback", hintRejectReason: "error", explanation: null, latencyMs: 0 }`。`checkHint` は `null`。`FALLBACK_HINT`・`FALLBACK_HINT_LEVEL1`・`fallbackHint` は design 7.1 の文面で確定
  - 完了条件: tsc が通る
- [x] **0-4 `src/quiz.ts`・`src/quizAgent.ts` に引数と任意フィールドだけを足す（中身は使わない）**【必須】 Sonnet
  - `QuizQuestion` に `level?`・`generatedBy?`・`promptVersion?`、`QUIZ_PROMPT_VERSION = "829-v1"`、`buildPrompt(…, level = DEFAULT_QUIZ_LEVEL, avoidNames = [])`、`generateQuizForAnimal(…, model = MODEL, level = DEFAULT_QUIZ_LEVEL, avoidNames = [])`、`generateQuizWithAgent(animal, candidateCategories, level = DEFAULT_QUIZ_LEVEL)`。既存の呼び出し元は変えない
  - 完了条件: tsc が通る。`git diff src/quiz.ts src/quizAgent.ts` が引数・型・定数の追加と import だけ
- [x] **0-5 `src/flexMessages.ts` の `QuizToPresent` に `level?: QuizLevel` と `eliminatedIndex?: number | null` を足す（表示はまだ変えない）**【必須】 Sonnet
  - 完了条件: tsc が通る
- [x] **0-6 レーン0の完了を確認して A・B・C を同時に開始**【必須】 Sonnet
  - 完了条件: `npx tsc --noEmit` が通る。各レーンにこのファイルの「インターフェース」節と design の該当章を渡す

### インターフェース（レーン0で置く。各レーンの契約）

```ts
// ---- src/quizLevel.ts（LLM・Firestore に依存しない純粋なモジュール。QuizCategory は quiz.ts から import type） ----
export type QuizLevel = 1 | 2 | 3 | 4 | 5;
export const DEFAULT_QUIZ_LEVEL: QuizLevel = 2;

export interface QuizLevelDef {
  level: QuizLevel; name: string; audience: string;   // 想定（design 5.2）
  wording: string; facts: string; distractors: string; // design 5.2 の表の指示文
}
export const QUIZ_LEVELS: Record<QuizLevel, QuizLevelDef>;
export const LEVEL_EXCLUDED_CATEGORIES: Record<QuizLevel, readonly QuizCategory[]>;              // design 5.4
export const LEVEL_CATEGORY_NOTES: Partial<Record<QuizLevel, Partial<Record<QuizCategory, string>>>>; // design 5.4

export interface QuizRecentEntry {
  level: QuizLevel; category: QuizCategory; isCorrect: boolean; hintUsed: boolean; attempts: 1 | 2;
  at: Date;            // Firestore の Timestamp は server.ts 側で Date と相互変換する
}
export type LevelFallbackCause = "no_new_answers" | "timeout" | "error" | "invalid_output" | null;
export type LevelGuard = "clamp" | "raise_without_evidence" | "lower_without_evidence" | "cooldown";
export interface LevelDecision {
  from: QuizLevel; to: QuizLevel; direction: "up" | "keep" | "down"; reason: string;
  decidedBy: "agent" | "rule"; fallbackCause: LevelFallbackCause;
  proposed: number | null; clamped: boolean; guard: LevelGuard | null; basis: string[];
  ruleTo: QuizLevel; answeredCountAtDecision: number; latencyMs: number;
  model: string | null; promptVersion: string;
}
export interface LastFinished { animalId: string; answerToken: number; at: number }
export interface QuizProfile {
  level: QuizLevel;
  recent: QuizRecentEntry[];          // 新しい順、最大5件
  answeredCount: number;
  lastChangeDirection: "up" | "down" | null;
  levelChangedAtCount: number | null;
  lastFinished: LastFinished | null;
  lastLevelDecision: LevelDecision | null;
}
export interface LevelCoachInput { /* design 6.2 のとおり（currentLevel / recent / signals / ruleSuggestion） */ }

export function isQuizLevel(n: unknown): n is QuizLevel;
export function levelLabel(level: QuizLevel): string;                                  // "レベル2 みならい研究員 ★★☆☆☆"
export function buildLevelGuidance(level: QuizLevel, category?: QuizCategory): string;  // design 5.2 の書式＋5.4 の補足1行
export function filterCategoriesForLevel(candidates: readonly QuizCategory[], level: QuizLevel): QuizCategory[]; // 0件なら元を返す
export function normalizeProfile(raw: unknown): QuizProfile;          // 未保存・壊れた値は level 2 ほか空
export function buildCoachInput(profile: QuizProfile, now: Date): LevelCoachInput;
export function clampLevel(from: QuizLevel, proposed: number): { to: QuizLevel; clamped: boolean };
export function applyLevelGuards(input: LevelCoachInput, to: QuizLevel): { to: QuizLevel; guard: LevelGuard | null };
export function ruleLevel(profile: QuizProfile): { to: QuizLevel; reason: string };
export function shouldKeepLevel(profile: QuizProfile): boolean;       // 初回 or 前回の決定から新しく終えた問題が無い
export function applyFinishedAnswer(profile: QuizProfile, entry: QuizRecentEntry, finished: LastFinished):
  Pick<QuizProfile, "recent" | "answeredCount" | "lastFinished">;     // 先頭に足して5件に切る・累計+1
export function levelChangeLine(from: QuizLevel, to: QuizLevel):
  { character: CharacterKey; expression: Expression; text: string } | null; // 変化なしは null（design 5.6）

// ---- src/quizLevelAgent.ts ----
export const QUIZ_LEVEL_COACH_INSTRUCTION: string;   // design 6.3 の文面
export const QUIZ_LEVEL_COACH_VERSION = "829-coach-v1";
export const COACH_BASIS: readonly string[];          // design 6.4
export async function runLevelCoach(input: LevelCoachInput): Promise<{ level: number; reason: string; basis: string[] }>; // 8秒で reject
export async function decideQuizLevel(
  profile: QuizProfile,
  deps?: { now?: Date; coach?: (input: LevelCoachInput) => Promise<{ level: number; reason: string; basis: string[] }> },
): Promise<LevelDecision>;                            // 例外を投げない

// ---- src/quizHint.ts ----
export type HintRejectReason = "contains_answer" | "reveals_other" | "too_long" | "empty" | "timeout" | "error";
export interface QuizHintResult {
  hint: string; hintSource: "llm" | "fallback";       // "pool" は #831 用に予約（ここでは型に入れない）
  hintRejectReason: HintRejectReason | null; explanation: string | null; latencyMs: number;
}
export const FALLBACK_HINT: string; export const FALLBACK_HINT_LEVEL1: string;
export function fallbackHint(level: QuizLevel): string;
export function normalizeForCheck(s: string): string;
export function checkHint(hint: string, quiz: Pick<QuizQuestion, "question" | "choices" | "correctIndex">, eliminatedIndex: number): HintRejectReason | null;
export async function generateQuizHint(
  animal: KaiyukanAnimal, quiz: QuizQuestion, eliminatedIndex: number, level: QuizLevel,
): Promise<QuizHintResult>;                           // 例外を投げない（6秒）

// ---- src/quiz.ts / src/quizAgent.ts（引数・任意フィールドの追加） ----
export const QUIZ_PROMPT_VERSION = "829-v1";
export interface QuizQuestion { /* 既存 */ level?: QuizLevel; generatedBy?: "live-single" | "live-agent" | "pool"; promptVersion?: string; }
export function buildPrompt(animal, category, groundingNames, level?: QuizLevel, avoidNames?: string[]): string;
export async function generateQuizForAnimal(animal, category, groundingNames?, model?, level?: QuizLevel, avoidNames?: string[]): Promise<QuizQuestion>;
export async function generateQuizWithAgent(animal, candidateCategories, level?: QuizLevel): Promise<AgentQuizResult>;

// ---- src/flexMessages.ts（フィールド追加。関数シグネチャは不変） ----
export interface QuizToPresent { /* 既存 */ level?: QuizLevel; eliminatedIndex?: number | null; }

// ---- src/quizAnswer.ts（レーンCが新規作成。server.ts からだけ使うのでレーン0では置かない） ----
export const DUPLICATE_WINDOW_MS = 10_000;
export interface PendingAnswerState {
  correctIndex: number; attempt: 1 | 2; eliminatedIndex: number | null;
  answerToken: number; prevAnswerToken: number | null; retryStartedAt: number | null;
}
export type AnswerOutcome =
  | { kind: "duplicate" }
  | { kind: "stale"; retryInProgress: boolean }
  | { kind: "invalid" }
  | { kind: "retry"; eliminatedIndex: number }
  | { kind: "finished"; isCorrect: boolean; attempts: 1 | 2; hintUsed: boolean; eliminatedIndex: number | null };
export function decideAnswerOutcome(args: {
  pending: PendingAnswerState | null; animalId: string; choiceIndex: number;
  token: number | undefined; now: number; lastFinished: LastFinished | null;
}): AnswerOutcome;                                    // 判定の順は design 3.4
```

---

## レーンA: 難易度（Sonnet、A3・A6 は Haiku 可）

- [x] **A1 `quizLevel.ts` の判定関数を本実装**【必須】 Sonnet
  - 対応基準: 1, 4, 5, 6b, 7, 20
  - `normalizeProfile`（レベル2既定）、`buildCoachInput`（design 6.2 の信号。`oscillating` は recent の level 直近4件で向きが2回以上変わる、`hoursAgo` は整数）、`clampLevel`、`applyLevelGuards`（design 6.5 の表の3つ）、`ruleLevel`、`shouldKeepLevel`、`applyFinishedAnswer`、`filterCategoriesForLevel`、`levelChangeLine`
  - 完了条件: tsc が通る
- [x] **A2 `scripts/try-quiz-level.ts` を新規作成（assert のみ。Gemini・Firestore に触れない）**【必須】 Sonnet
  - 既存 `scripts/try-quiz-plan.ts` の流儀（`node:assert/strict`、ケースごとに関数）
  - ケース: 丸め（+3→+1、0→1、6→5、2.6→3）／規則（design 6.6 の S2・S3・S8・S9・S10・S11・S12 の「規則」列と一致）／ガード（外した直後の上げ→`raise_without_evidence`、正解続きの下げ→`lower_without_evidence`、上げた直後1問での上げ→`cooldown`）／`buildCoachInput` の各信号（S4・S5・S6・S7 の profile から）／据え置き判定（初回・新しい回答なし）／`normalizeProfile(undefined).level === 2`／`applyFinishedAnswer` の5件切り／`filterCategoriesForLevel`（レベル1で5件除外・全部除外対象なら元に戻す・レベル3は不変）／`levelChangeLine` の上がる・5へ・下がる・変化なし
  - **偽のコーチで `decideQuizLevel` を確認**（`deps.coach`）: +2 を返す→clamp、NaN→`invalid_output`、例外→`error`、9秒待ち→`timeout`（テストでは時間を短くできるよう、タイムアウト値を `deps` で上書きできてもよい）
  - 完了条件: `npx tsx scripts/try-quiz-level.ts` が例外なく終わり「OK」を出す
- [x] **A3 `quiz.ts`・`quizAgent.ts` でレベルをプロンプトに反映**【必須】 Haiku 可
  - 対応基準: 2, 7
  - design 5.5 の表のとおり（`buildLevelGuidance(level, category)` の差し込み、スキーマ説明、`COMMON_QUIZ_RULES` の1行、`avoidNames` の1行、戻り値に `level`・`generatedBy`・`promptVersion`。`generateQuizWithAgent` の戻り値の quiz には `generatedBy: "live-agent"`）
  - 完了条件: tsc が通る。`npx tsx scripts/try-quiz-plan.ts` が今までどおり通る
- [x] **A4 `src/quizLevelAgent.ts` の難易度コーチを本実装**【必須】 Sonnet
  - 対応基準: 3, 4, 5, 15
  - `runLevelCoach`: ADK `Agent`（`name: "quiz_level_coach"`、`QUIZ_LEVEL_MODEL ?? "gemini-2.5-flash"`、`thinkingBudget: 0`、ツールなし、`instruction` は design 6.3 の文面、出力は 6.4 の zod、`runner.runEphemeral`）。8秒は `Promise.race`（`stationAquariumAgent.ts` と同じ書き方）。`basis` の知らないラベルは捨て、`reason` は40字で切る
  - `decideQuizLevel`: design 6.5 の 1〜5 の順。`ruleTo` は常に `ruleLevel` の結果を入れる。`latencyMs`・`model`・`promptVersion` を入れる。**例外を外に投げない**
  - ログは出さない（userIdHash を持つ server.ts の C3 で出す）
  - 完了条件: tsc が通る。A2 の偽コーチのケースが通る
- [x] **A5 `scripts/try-quiz-level-agent.ts`（難易度コーチの評価）を新規作成**【必須】（3回ずつの実行は【できれば】） Sonnet
  - design 11.1 のとおり: S1〜S12 の profile と `expected`・`beyondRule` をスクリプトに持ち、各3回 `decideQuizLevel` を呼ぶ。行ごとの結果と集計（expected 一致率・S4/S5 の一致回数・禁止事項の件数・所要時間の95パーセンタイル・時間切れ数）を表示し、合否の基準に照らして PASS/FAIL を出す
  - 結果の各行は本番と同じ形の JSON（`event: "quiz_level_decision"`）でも出す（デモ用、design 10.4）
  - 完了条件: 合否の基準をすべて満たす。満たさない場合はプロンプト（6.3）の修正案と結果を PM に報告して止まる。削る場合の代替: 各1回の実行で基準を見る
- [x] **A6 `scripts/try-quiz-category.ts` にレベル引数を追加**【できれば】 Haiku
  - design 11.3: 同じ生きもの・カテゴリでレベル1/3/5を作って並べ、レベル1の漢字・数字の有無と問題文の字数を表示
  - 完了条件: ジンベエザメの「特徴」「生息地」で3レベルを目視し、design 5.3 の方向と合っている。削る場合の代替: 実機で出た問題の目視のみ

## レーンB: ヒントと表示（Sonnet、B4・B5 は Haiku）

- [x] **B1 `quizHint.ts` の `normalizeForCheck`・`checkHint` を本実装**【必須】 Sonnet
  - 対応基準: 12
  - design 7.4 のとおり: 正規化5段（NFKC・小文字・カタカナ→ひらがな・簡易の漢数字→算用数字・空白と記号と長音の除去）、トークン（全体・数字・カタカナ3字以上・漢字2字以上。問題文にある語と、正解と残る誤答の両方にある語は除く）、判定の順（empty → contains_answer → reveals_other → too_long）
  - 完了条件: tsc が通る
- [x] **B2 `quizHint.ts` の `generateQuizHint` を本実装**【必須】 Sonnet
  - 対応基準: 8, 9, 11, 12, 13
  - `@google/genai` の `generateContent` 1回（`gemini-2.5-flash`、`thinkingBudget: 0`、`responseMimeType: "application/json"`、`responseSchema {hint, explanation}`）、6秒の `Promise.race`。プロンプトは design 7.2 の文面、レベル別の言い回しと字数は 7.3 の表。`checkHint` に当たれば `fallbackHint(level)`。**例外を外に投げない**
  - ログ `{"event":"quiz_hint", level, hintSource, hintRejectReason, hint, latencyMs}` はここで出す（userIdHash は C4 で別ログに出す）
  - 完了条件: tsc が通る
- [x] **B3 `scripts/try-quiz-hint.ts`（ヒントの評価）を新規作成**【必須】 Sonnet（assert 部は Haiku 可）
  - design 11.2 のとおり: `checkHint` の assert 一式（LLM 不要）＋固定の問題7問×誤答2つ×2回の `generateQuizHint`。集計（弾かれ率・時間・字数・口調）と、合格ヒントの一覧（目視で ○/× を付ける欄つき）を表示
  - 完了条件: assert が通る。表示されるヒントに正解・残る誤答の語が0件。弾かれ率20%以下・時間の基準を満たす。目視の結果を PM に報告
- [x] **B4 `flexMessages.ts` にレベル表示と2択表示を実装**【必須】 Haiku
  - 対応基準: 6, 8, 19
  - design 9.1・9.2 のとおり（ヘッダー2行目、2択の色・1行目・消した行の灰色・取り消し線・action なし、クイックリプライは残り2つで元の番号のアイコン、postback は元の番号）
  - 完了条件: tsc が通る
- [x] **B5 `scripts/print-quiz-flex-sample.ts` にレベル付き3択と2択のサンプルを追加**【必須】 Haiku
  - 完了条件: 出力 JSON を LINE Flex Message Simulator に貼り、3択のヘッダーに「レベル2 みならい研究員 ★★☆☆☆」、2択で消した行が灰色・取り消し線・押せない、を目視

## レーンC: 回答判定と結合（Sonnet、C1・C2 は Haiku 可）

レーンA・B の本実装を待たずに、レーン0のスタブで結合を進める（A・B が終われば中身が差し替わるだけ）。

- [x] **C1 `src/quizAnswer.ts` を新規作成（`decideAnswerOutcome`）**【必須】 Haiku 可
  - 対応基準: 8, 9, 10, 18
  - 上の「インターフェース」と design 3.4 の判定の順のとおり
  - 完了条件: tsc が通る
- [x] **C2 `scripts/try-quiz-answer.ts` を新規作成（assert のみ）**【必須】 Haiku
  - ケース: design 3.3 の表の全行を1ケースずつ＋1回目正解→finished(true,1,false)／1回目不正解→retry／2回目正解→finished(true,2,true)／2回目不正解→finished(false,2,true)／token undefined は受け付ける／10秒ちょうどと10秒+1ms の境界
  - 完了条件: `npx tsx scripts/try-quiz-answer.ts` が「OK」を出す
- [x] **C3 `server.ts` 出題側: 学習状況・難易度決定・除外・生成・保存・変化の一言**【必須】 Sonnet
  - 対応基準: 1, 3, 6, 6b, 7, 15, 20
  - `userRef`・`getQuizProfile`（読み取り失敗はレベル2で続行）、`handleStartQuiz` の `Promise.all` に学習状況を追加 → `decideQuizLevel`
  - `obtainQuiz({ animal, plan, level, candidates })` を新設（design 8.1。#831 の差し込み口）: retry は同じカテゴリで `generateQuizForAnimal(…, level, avoidNames)`、fresh は `filterCategoriesForLevel(plan.candidates, level)` を `generateQuizWithAgent` へ。`avoidNames` は「同じ水槽にいる魚」なら同じ展示の全種名、「類似した仲間」なら同じ科の全種名（`findTankmateNames(id, Infinity)` / `findFamilyMateNames(id, Infinity)`）
  - `savePendingQuiz` に design 4.2 のフィールド（`level`・`generatedBy`・`promptVersion`・`levelDecision`・`attempt: 1`・`answerToken`・`prevAnswerToken: null`・`retryStartedAt: null`・`eliminatedIndex: null`・`hint` 系 null）を追加し、`users/{uid}.quizProfile` の `level`・`lastLevelDecision`（`at` 付き）・変化時の `lastChangeDirection`・`levelChangedAtCount` と **WriteBatch で同時に**書く
  - push の先頭に `levelChangeLine(from, to)` があれば1通足す。Flex に `level` を渡す
  - ログ: `quiz_level_decision`（`userIdHash`・`animalId`・decision 全部・`agreesWithRule`。null は `"none"`）と `quiz_generated`（`level`・`category`・`generatedBy`・`promptVersion`・`excludedCategories`・`latencyMs`）。`userIdHash` は SHA-256 の先頭8桁、`severity: "INFO"`
  - 完了条件: tsc が通る
- [x] **C4 `server.ts` 回答側: トランザクション・再挑戦・ヒント・終了時の返信**【必須】 Sonnet
  - 対応基準: 8, 9, 10, 11, 13, 14, 16, 17, 18, 19
  - design 4.5 の順: `tx.get(pendingRef)`・`tx.get(userRef)` を先に → `decideAnswerOutcome`（`now`・`lastFinished` を渡す）→ `duplicate`・`invalid` は何も書かず返信もしない／`stale` は今の「もう終わってるっす」（`retryInProgress` は C5）／`finished` は pending 削除・`quizHistory`（design 4.3 の全フィールド、`isCorrect` は最終の正誤）・collection・`quizProfile`（`applyFinishedAnswer`、`lastFinished` 込み）／`retry` は `pendingRef.update({ attempt: 2, eliminatedIndex, prevAnswerToken, answerToken: Date.now(), retryStartedAt })` だけ
  - 再送イベント（`event.deliveryContext?.isRedelivery`）で `stale`・`duplicate` なら返信しない（`handlePostback` → `handleAnswerQuiz` に引数で渡す）
  - retry の後（トランザクションの外）で `generateQuizHint` → `pendingRef.update({ hint, hintSource, hintRejectReason, explanation })`（失敗はログのみ）→ reply 4通（design 9.2）
  - 終了時の返信は design 9.3 の3パターン＋探検クイックリプライ
  - ログ: `quiz_answer`（`userIdHash`・`animalId`・`kind`・`attempt`・`isCorrect`・`level`・`isRedelivery`）
  - 完了条件: tsc が通る
- [x] **C5 `server.ts` 古い3択を押したときの2択の出し直し**【できれば】 Sonnet
  - 対応基準: 18（安全側は C4 の stale で満たす）
  - `stale` かつ `retryInProgress` のとき「下の2択で答えてほしいっす」＋保存済み `hint`（無ければ `fallbackHint(level)`）で2択を再送。削る場合の代替: 今どおり「もう終わってるっす」を返すだけ
  - 完了条件: tsc が通る
- [x] **C6 `firestore.rules` 冒頭コメントと `scripts/verify-auth-rules.mjs` の追加確認**【できれば】 Haiku
  - 対応基準: 17
  - ルール本体は変更しない（コメントのみ）。verify に design 4.4 の2項目を追加
  - 完了条件: `git diff firestore.rules` がコメント行だけ。verify スクリプトが通る。削る場合の代替: rules 無変更の diff 確認だけ

## レーンV: 統合・検証・デプロイ（A・B・C の完了後に1人で）

- [ ] **V1 全体の型チェック**【必須】 Sonnet
  - 完了条件: `cd backend && npx tsc --noEmit` がエラー0
- [ ] **V2 ローカル確認・評価スクリプトを全部流す**【必須】 Sonnet
  - `try-quiz-level.ts` / `try-quiz-answer.ts` / `try-quiz-plan.ts`（回帰）/ `try-quiz-hint.ts` / `try-quiz-level-agent.ts`、`print-quiz-flex-sample.ts`
  - 完了条件: assert 系がすべて OK。A5・B3 の評価が合否の基準を満たす（design 11.1・11.2）
- [ ] **V3 デプロイ前の確認**【必須】 Sonnet
  - `git diff --stat` で変更ファイルがこの tasks.md の表の範囲だけ／`quizAgentParallel.ts`・`quizAgentWorkflow.ts` が無変更／`firestore.rules` がコメントのみ／postback 形式とクイックリプライ「クイズ」が不変（基準19）／正解・解説・ヒントを `pendingQuiz` と（終了後の）`quizHistory` 以外へ書いていない（基準17）／プロンプトの文面が design の定数どおり
  - 完了条件: 上の確認結果をユーザーに報告
- [ ] **V4 デプロイ（ユーザーの確認後に実行）**【必須】
  - **ユーザーの明示的な OK をもらってから** `cd backend && make deploy`
  - 完了条件: Webhook URL が表示され、`make logs` に起動エラーが無い
- [ ] **V5 実機確認（LINE）**【必須】 ユーザー＋Sonnet（ログ確認）
  1. `quizProfile` 未保存のユーザーで「クイズ」→ ヘッダーに「レベル2 みならい研究員 ★★☆☆☆」。変化の一言は出ない（基準1・6・20）
  2. わざと外す → カワウソ「惜しいっす」→ ジンベエのヒント → カワウソ → 2択。消した選択肢が灰色で押せない、クイックリプライが2つ、ヒントに正解の言葉が無い（基準8・11・12）
  3. 1回目の選択肢をすばやく2回押す → 2択は1回だけ届く（design 3.3）
  4. （C5 を入れた場合）10秒以上待ってから上の3択を押す →「下の2択で」＋2択の出し直し（基準18）
  5. 2択も外す → 正解と短い解説。次の「クイズ」で同じカテゴリ、ヘッダーが「レベル1 ちびっこ」になり、カワウソの一言（基準6b・9・14）
  6. 別の問題で、1回目に外して2択で正解 →「ヒントから見事に見抜いた」。次のレベルは据え置き（基準10）
  7. ヒントなしで2問続けて正解 → 次でレベルが上がり、ジンベエの一言（基準6b）
  8. Firestore コンソールで `quizHistory`（`level`・`attempts`・`hintUsed`・`hintStage`・`levelDecision`・`generatedBy`）、`users/{uid}.quizProfile`（`recent`・`lastLevelDecision`）を確認。`pendingQuiz` が終了時に消えている（基準15・16）
  9. Logs Explorer で design 10.3 のクエリ①④⑥⑦を流し、`quiz_level_decision`・`quiz_generated`・`quiz_answer`・`quiz_hint` が出ていること（基準15）
  - 完了条件: 1〜9（C5 を削った場合は 4 を除く）を確認し、結果をユーザーに報告
- [ ] **V6 完了後の後片付け**【必須】
  - requirements.md / design.md の確定事項（レベル定義・プロンプトの文面・ガード・ログの形・評価の基準）を `CLAUDE.md` か `docs/` に転記し、`docs/specs/829-quiz-difficulty-hint/` を削除（`scripts/` のスクリプトは残す）。commit はユーザーの指示があってから

## 並列化の注意

- **同時に走らせるのは A・B・C の最大3体（推奨は2体: A と C を並列、B は短く）**。エージェントから更にエージェントを起動しない
- 各レーンは上の表の「触るファイル」以外を編集しない。`quiz.ts`・`quizAgent.ts`・`flexMessages.ts` はレーン0で一度触ったあと、それぞれ A・A・B だけが触る
- 同じ作業ツリーで並列に作業すると、`npx tsc --noEmit` が他レーンの書きかけで落ちることがある。各レーンの完了判定は自分のファイルのエラーが0であること（`npx tsc --noEmit 2>&1 | rg 'src/(quizHint|flexMessages)'` のように絞る）とし、全体の0は V1 で確認する
- レーン0のシグネチャを変えたくなったら、その場で変えずに PM へ戻す。特に `decideQuizLevel`・`generateQuizHint` は「例外を投げない」契約に server.ts が依存している
- Gemini を呼ぶスクリプト（A5・A6・B3）は `.env` の読み込みと `npx tsx` の EPERM のため、サンドボックスを解除して実行する必要がある
- git commit はしない（ユーザーの指示があったときだけ）

## 締切に対する見積もりと削る順

| 日 | 内容 | 見積もり |
| --- | --- | --- |
| 1日目 | レーン0 → A・B・C を並列（A1〜A4・B1〜B2・B4〜B5・C1〜C4） | 約6.5h（実時間） |
| 2日目 | A5・B3 の評価とプロンプト調整 → C5・C6・A6（できれば）→ V1〜V3 → ユーザー確認 → V4 デプロイ → V5 実機 | 約5h（実時間） |

10/15 締切に対し 2日で収まる見込み。遅れた場合は次の順で削る（いずれも受け入れ基準は満たしたまま）:

1. A6（レベル別の問題比較スクリプト）→ 実機での目視で代替
2. C6（rules コメント・verify 追加）→ rules 無変更の diff 確認で代替
3. C5（古い3択からの2択の出し直し）→ 「もう終わってるっす」で代替
4. A5・B3 の LLM 実行回数を各1回に減らす（合否の基準は件数に合わせて読み替える）
