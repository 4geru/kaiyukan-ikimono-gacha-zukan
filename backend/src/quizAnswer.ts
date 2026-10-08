import type { LastFinished } from "./quizLevel.js";

// 回答の判定（#829 design 3.4）。Firestore・LLM に依存しない純粋関数。
// 連打・再送・古い Flex・偽の postback を、書き込み前に分類する。

export const DUPLICATE_WINDOW_MS = 10_000;

export interface PendingAnswerState {
  correctIndex: number;
  attempt: 1 | 2;
  eliminatedIndex: number | null;
  answerToken: number; // = pendingQuiz.answerToken ?? askedAt.toMillis()
  prevAnswerToken: number | null; // 2択へ進む前のトークン
  retryStartedAt: number | null; // 2択へ進んだ時刻（ミリ秒）
}

export type AnswerOutcome =
  | { kind: "duplicate" } // 連打・再送。何もしない
  | { kind: "stale"; retryInProgress: boolean }
  | { kind: "invalid" }
  | { kind: "retry"; eliminatedIndex: number }
  | { kind: "finished"; isCorrect: boolean; attempts: 1 | 2; hintUsed: boolean; eliminatedIndex: number | null };

export function decideAnswerOutcome(args: {
  pending: PendingAnswerState | null;
  animalId: string;
  choiceIndex: number;
  token: number | undefined;
  now: number;
  lastFinished: LastFinished | null;
}): AnswerOutcome {
  const { pending, animalId, choiceIndex, token, now, lastFinished } = args;

  // 1. 出題中の問題が無い: 直前に終えた同じ問題への連打なら duplicate、それ以外は古い
  if (!pending) {
    const isEcho =
      lastFinished !== null &&
      token !== undefined &&
      lastFinished.animalId === animalId &&
      lastFinished.answerToken === token &&
      now - lastFinished.at <= DUPLICATE_WINDOW_MS;
    return isEcho ? { kind: "duplicate" } : { kind: "stale", retryInProgress: false };
  }

  // 2. token 無し（識別子導入前の Flex）は最新として扱う。3. 一致しないなら連打 or 古い
  if (token !== undefined && token !== pending.answerToken) {
    const isEcho =
      pending.prevAnswerToken !== null &&
      token === pending.prevAnswerToken &&
      pending.retryStartedAt !== null &&
      now - pending.retryStartedAt <= DUPLICATE_WINDOW_MS;
    return isEcho ? { kind: "duplicate" } : { kind: "stale", retryInProgress: pending.attempt === 2 };
  }

  // 4. 範囲外・消した選択肢
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 2) return { kind: "invalid" };
  if (pending.eliminatedIndex !== null && choiceIndex === pending.eliminatedIndex) return { kind: "invalid" };

  // 5. 正誤
  if (choiceIndex === pending.correctIndex) {
    return {
      kind: "finished",
      isCorrect: true,
      attempts: pending.attempt,
      hintUsed: pending.attempt === 2,
      eliminatedIndex: pending.eliminatedIndex,
    };
  }
  if (pending.attempt === 1) return { kind: "retry", eliminatedIndex: choiceIndex };
  return { kind: "finished", isCorrect: false, attempts: 2, hintUsed: true, eliminatedIndex: pending.eliminatedIndex };
}
