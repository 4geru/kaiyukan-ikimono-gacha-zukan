import assert from "node:assert/strict";
import { decideAnswerOutcome, DUPLICATE_WINDOW_MS, type PendingAnswerState } from "../src/quizAnswer.js";

// #829 C2: decideAnswerOutcome の assert のみ（LLM・Firestore 不使用）
const NOW = 1_000_000_000;
const p1: PendingAnswerState = { correctIndex: 1, attempt: 1, eliminatedIndex: null, answerToken: 100, prevAnswerToken: null, retryStartedAt: null };
const p2: PendingAnswerState = { correctIndex: 1, attempt: 2, eliminatedIndex: 0, answerToken: 200, prevAnswerToken: 100, retryStartedAt: NOW - 1000 };
const base = { animalId: "a", now: NOW, lastFinished: null };

// 3.3 の表
// 連打（1回目の2択確定直後に古いトークン）
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p2, choiceIndex: 2, token: 100 }), { kind: "duplicate" });
// 10秒以上あとの古い3択 -> stale(retryInProgress)
assert.deepEqual(
  decideAnswerOutcome({ ...base, pending: { ...p2, retryStartedAt: NOW - DUPLICATE_WINDOW_MS - 1 }, choiceIndex: 2, token: 100 }),
  { kind: "stale", retryInProgress: true },
);
// 最後の回答の連打: pending 無し + lastFinished 一致 10秒以内
const lf = { animalId: "a", answerToken: 200, at: NOW - 500 };
assert.deepEqual(decideAnswerOutcome({ ...base, pending: null, choiceIndex: 1, token: 200, lastFinished: lf }), { kind: "duplicate" });
// 終わった問題を後で押す
assert.deepEqual(decideAnswerOutcome({ ...base, pending: null, choiceIndex: 1, token: 200, lastFinished: { ...lf, at: NOW - DUPLICATE_WINDOW_MS - 1 } }), { kind: "stale", retryInProgress: false });
assert.deepEqual(decideAnswerOutcome({ ...base, pending: null, choiceIndex: 1, token: 999, lastFinished: lf }), { kind: "stale", retryInProgress: false });
assert.deepEqual(decideAnswerOutcome({ ...base, pending: null, choiceIndex: 1, token: 200, lastFinished: { ...lf, animalId: "b" } }), { kind: "stale", retryInProgress: false });
// 消した選択肢（最新トークン）= invalid
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p2, choiceIndex: 0, token: 200 }), { kind: "invalid" });
// 範囲外
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p1, choiceIndex: 3, token: 100 }), { kind: "invalid" });
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p1, choiceIndex: -1, token: 100 }), { kind: "invalid" });
// 再挑戦中に全く別の古いトークン -> stale(true)
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p2, choiceIndex: 2, token: 50 }), { kind: "stale", retryInProgress: true });
// 1回目に古いトークン -> stale(false)
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p1, choiceIndex: 1, token: 50 }), { kind: "stale", retryInProgress: false });

// 基本の流れ
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p1, choiceIndex: 1, token: 100 }), { kind: "finished", isCorrect: true, attempts: 1, hintUsed: false, eliminatedIndex: null });
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p1, choiceIndex: 0, token: 100 }), { kind: "retry", eliminatedIndex: 0 });
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p2, choiceIndex: 1, token: 200 }), { kind: "finished", isCorrect: true, attempts: 2, hintUsed: true, eliminatedIndex: 0 });
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p2, choiceIndex: 2, token: 200 }), { kind: "finished", isCorrect: false, attempts: 2, hintUsed: true, eliminatedIndex: 0 });
// token undefined は受け付ける
assert.deepEqual(decideAnswerOutcome({ ...base, pending: p1, choiceIndex: 1, token: undefined }), { kind: "finished", isCorrect: true, attempts: 1, hintUsed: false, eliminatedIndex: null });
// 境界: 10秒ちょうど = duplicate、+1ms = stale
const edge = (ms: number) => decideAnswerOutcome({ ...base, pending: { ...p2, retryStartedAt: NOW - ms }, choiceIndex: 2, token: 100 });
assert.deepEqual(edge(DUPLICATE_WINDOW_MS), { kind: "duplicate" });
assert.deepEqual(edge(DUPLICATE_WINDOW_MS + 1), { kind: "stale", retryInProgress: true });
const edgeF = (ms: number) => decideAnswerOutcome({ ...base, pending: null, choiceIndex: 1, token: 200, lastFinished: { ...lf, at: NOW - ms } });
assert.deepEqual(edgeF(DUPLICATE_WINDOW_MS), { kind: "duplicate" });
assert.deepEqual(edgeF(DUPLICATE_WINDOW_MS + 1), { kind: "stale", retryInProgress: false });

console.log("OK");
