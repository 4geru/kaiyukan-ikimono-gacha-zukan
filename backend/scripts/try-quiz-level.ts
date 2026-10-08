import assert from "node:assert/strict";
import {
  applyFinishedAnswer,
  applyLevelGuards,
  buildCoachInput,
  clampLevel,
  filterCategoriesForLevel,
  levelChangeLine,
  normalizeProfile,
  ruleLevel,
  shouldKeepLevel,
  type QuizLevel,
  type QuizProfile,
  type QuizRecentEntry,
} from "../src/quizLevel.js";
import { QUIZ_CATEGORIES, type QuizCategory } from "../src/quiz.js";
import { decideQuizLevel } from "../src/quizLevelAgent.js";

// #829 レーンA: 難易度の純粋関数と decideQuizLevel のガードを assert で確認する。Gemini・Firestore には触れない。

const NOW = new Date("2026-10-08T12:00:00Z");
type R = "o" | "h" | "x"; // o=ヒントなし正解 h=ヒントあり正解 x=最終不正解
function e(r: R, level: QuizLevel, category: QuizCategory = "特徴", hoursAgo = 1): QuizRecentEntry {
  return {
    level, category, isCorrect: r !== "x", hintUsed: r === "h", attempts: r === "o" ? 1 : 2,
    at: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  };
}
function prof(level: QuizLevel, recent: QuizRecentEntry[], extra: Partial<QuizProfile> = {}): QuizProfile {
  return { ...normalizeProfile(undefined), level, recent, answeredCount: Math.max(recent.length, 1), ...extra };
}

function testClamp() {
  assert.deepEqual(clampLevel(2, 5), { to: 3, clamped: true }); // +3 → +1
  assert.deepEqual(clampLevel(3, 0), { to: 2, clamped: true }); // 0 → 1 → 2(−1 まで)
  assert.deepEqual(clampLevel(1, 0), { to: 1, clamped: true });
  assert.deepEqual(clampLevel(5, 6), { to: 5, clamped: true });
  assert.equal(clampLevel(2, 2.6).to, 3);
  assert.deepEqual(clampLevel(2, 3), { to: 3, clamped: false });
  assert.deepEqual(clampLevel(2, 2), { to: 2, clamped: false });
  assert.equal(clampLevel(2, NaN).to, 2);
}

function testRule() {
  const s = (p: QuizProfile) => ruleLevel(p).to;
  assert.equal(s(prof(2, [e("o", 2), e("o", 2, "生息地")])), 3); // S2
  assert.equal(s(prof(3, [e("x", 3, "水温")])), 2); // S3
  assert.equal(s(prof(3, [e("x", 3, "ダジャレ"), e("o", 3), e("o", 3), e("o", 3)])), 2); // S4 規則は下げ
  assert.equal(s(prof(3, [e("h", 3), e("h", 3), e("h", 3)])), 3); // S5 規則は据え置き
  assert.equal(s(prof(3, [e("o", 3), e("o", 3), e("x", 4), e("o", 4)])), 4); // S6
  assert.equal(s(prof(4, [e("o", 4), e("o", 4, "特徴", 24 * 14)])), 5); // S7
  assert.equal(s(prof(5, [e("o", 5), e("o", 5), e("o", 5), e("o", 5), e("o", 5)])), 5); // S8
  assert.equal(s(prof(1, [e("x", 1), e("x", 1), e("x", 1)])), 1); // S9
  assert.equal(s(prof(3, [e("o", 3), e("h", 3)])), 3); // S10
  assert.equal(s(prof(3, [e("o", 3), e("o", 2), e("o", 2)])), 3); // S11
  assert.equal(s(prof(2, [e("x", 2), e("o", 2)])), 1); // S12
}

function testGuards() {
  const input = (p: QuizProfile) => buildCoachInput(p, NOW);
  // 外した直後の上げ
  assert.deepEqual(applyLevelGuards(input(prof(2, [e("x", 2), e("o", 2)])), 3), { to: 2, guard: "raise_without_evidence" });
  // ヒント頼みの上げ
  assert.equal(applyLevelGuards(input(prof(2, [e("h", 2), e("o", 2)])), 3).guard, "raise_without_evidence");
  // 正解続きの下げ
  assert.deepEqual(applyLevelGuards(input(prof(3, [e("o", 3), e("o", 3)])), 2), { to: 3, guard: "lower_without_evidence" });
  // 上げた直後1問での上げ（S11）
  const s11 = prof(3, [e("o", 3), e("o", 2), e("o", 2)], { lastChangeDirection: "up", levelChangedAtCount: 2, answeredCount: 3 });
  assert.deepEqual(applyLevelGuards(input(s11), 4), { to: 3, guard: "cooldown" });
  // 2問解けば上げられる
  const ok = prof(3, [e("o", 3), e("o", 3), e("o", 2)], { lastChangeDirection: "up", levelChangedAtCount: 1, answeredCount: 3 });
  assert.deepEqual(applyLevelGuards(input(ok), 4), { to: 4, guard: null });
  // 根拠があれば下げ・上げが通る
  assert.equal(applyLevelGuards(input(prof(3, [e("x", 3)])), 2).to, 2);
  assert.equal(applyLevelGuards(input(prof(3, [e("o", 3), e("o", 3)])), 4).to, 4);
}

function testCoachInput() {
  // S4: ダジャレで外した後に3連続正解（直近が×なので streak 0, wrongStreak 1）
  const s4 = buildCoachInput(prof(3, [e("x", 3, "ダジャレ"), e("o", 3), e("o", 3), e("o", 3)]), NOW);
  assert.equal(s4.signals.wrongStreak, 1);
  assert.equal(s4.signals.noHintCorrectStreakAtLevel, 0);
  assert.equal(s4.recent[0].result, "wrong");
  assert.equal(s4.recent[0].category, "ダジャレ");
  assert.equal(s4.ruleSuggestion.level, 2);
  // S5: ヒント頼み
  const s5 = buildCoachInput(prof(3, [e("h", 3), e("h", 3), e("h", 3)]), NOW);
  assert.equal(s5.signals.hintCorrectInRecent, 3);
  assert.equal(s5.signals.answersAtCurrentLevel, 3);
  assert.equal(s5.signals.noHintCorrectStreakAtLevel, 0);
  // S6: 4→3 に下げた直後。oscillating ではない
  const s6 = buildCoachInput(
    prof(3, [e("o", 3), e("o", 3), e("x", 4), e("o", 4)], { lastChangeDirection: "down", levelChangedAtCount: 2, answeredCount: 4 }),
    NOW,
  );
  assert.equal(s6.signals.noHintCorrectStreakAtLevel, 2);
  assert.equal(s6.signals.answersSinceLastChange, 2);
  assert.equal(s6.signals.lastChangeDirection, "down");
  assert.equal(s6.signals.oscillating, false);
  // 上下を繰り返している（古い順 2,3,2,3）
  const osc = buildCoachInput(prof(3, [e("o", 3), e("x", 2), e("o", 3), e("o", 2)]), NOW);
  assert.equal(osc.signals.oscillating, true);
  // S7: 14日ぶり
  const s7 = buildCoachInput(prof(4, [e("o", 4, "特徴", 24 * 14), e("o", 4, "特徴", 24 * 14 + 1)]), NOW);
  assert.equal(s7.signals.hoursSinceLastAnswer, 336);
  assert.equal(s7.recent[0].hoursAgo, 336);
  assert.equal(buildCoachInput(prof(2, []), NOW).signals.hoursSinceLastAnswer, null);
  assert.equal(buildCoachInput(prof(2, []), NOW).signals.answersSinceLastChange, null);
}

function testKeepAndProfile() {
  assert.equal(normalizeProfile(undefined).level, 2);
  assert.equal(normalizeProfile({ level: 9, recent: "x" }).level, 2);
  assert.equal(normalizeProfile({ level: 4, recent: [{ bad: 1 }] }).recent.length, 0);
  const n = normalizeProfile({ level: 4, answeredCount: 3, recent: [{ ...e("o", 4), at: { toDate: () => NOW } }] });
  assert.equal(n.level, 4);
  assert.equal(n.recent[0].at.getTime(), NOW.getTime());
  assert.equal(shouldKeepLevel(normalizeProfile(undefined)), true); // 初回
  const p = prof(3, [e("o", 3)], { answeredCount: 5 });
  assert.equal(shouldKeepLevel(p), false); // 未決定
  const decided = { ...p, lastLevelDecision: { from: 3, to: 3, answeredCountAtDecision: 5 } as never };
  assert.equal(shouldKeepLevel(decided), true); // 新しい回答なし
  assert.equal(shouldKeepLevel({ ...decided, answeredCount: 6 }), false);
}

function testApplyFinished() {
  let p = prof(2, []);
  p = { ...p, answeredCount: 0 };
  for (let i = 0; i < 7; i++) {
    const r = applyFinishedAnswer(p, e("o", 2), { animalId: "1", answerToken: i, at: i });
    p = { ...p, ...r };
  }
  assert.equal(p.recent.length, 5);
  assert.equal(p.answeredCount, 7);
  assert.equal(p.lastFinished?.answerToken, 6);
}

function testFilter() {
  const all = [...QUIZ_CATEGORIES];
  const l1 = filterCategoriesForLevel(all, 1);
  assert.equal(l1.length, all.length - 5);
  for (const c of ["進化の歴史", "海外の小ネタ", "類似した仲間", "同じ水槽にいる魚", "郷土料理"] as const) assert.ok(!l1.includes(c));
  assert.deepEqual(filterCategoriesForLevel(["進化の歴史", "郷土料理"], 1), ["進化の歴史", "郷土料理"]); // 全部除外なら元に戻す
  assert.deepEqual(filterCategoriesForLevel(all, 3), all);
}

function testLevelChangeLine() {
  const up = levelChangeLine(2, 3);
  assert.ok(up && up.character === "dr-jinbei" && up.text.includes("レベル3「研究員」"));
  const five = levelChangeLine(4, 5);
  assert.ok(five && five.text.startsWith("見事じゃ"));
  const down = levelChangeLine(3, 2);
  assert.ok(down && down.character === "kawauso" && down.text.includes("レベル2「みならい研究員」"));
  assert.equal(levelChangeLine(3, 3), null);
}

async function testDecide() {
  // S2 相当: 2問続けてヒントなし正解（L2）。fake coach で +2 → clamp → 3
  const base = prof(2, [e("o", 2), e("o", 2)], { answeredCount: 2 });
  const d1 = await decideQuizLevel(base, { now: NOW, coach: async () => ({ level: 4, reason: "r", basis: ["no_hint_streak", "bogus"] }) });
  assert.equal(d1.to, 3);
  assert.equal(d1.clamped, true);
  assert.equal(d1.guard, "clamp");
  assert.equal(d1.proposed, 4);
  assert.equal(d1.decidedBy, "agent");
  assert.deepEqual(d1.basis, ["no_hint_streak"]);
  assert.equal(d1.direction, "up");
  assert.equal(d1.ruleTo, 3);
  // 素直な +1（丸めもガードも無し）
  const d2 = await decideQuizLevel(base, { now: NOW, coach: async () => ({ level: 3, reason: "ok", basis: [] }) });
  assert.equal(d2.to, 3);
  assert.equal(d2.guard, null);
  assert.equal(d2.clamped, false);
  // 外した直後の上げ → raise_without_evidence
  const wrong = prof(2, [e("x", 2), e("o", 2)], { answeredCount: 2 });
  const d3 = await decideQuizLevel(wrong, { now: NOW, coach: async () => ({ level: 3, reason: "x", basis: [] }) });
  assert.equal(d3.to, 2);
  assert.equal(d3.guard, "raise_without_evidence");
  assert.ok(d3.reason.includes("ガード: raise_without_evidence"));
  // NaN → invalid_output → 規則
  const d4 = await decideQuizLevel(base, { now: NOW, coach: async () => ({ level: NaN, reason: "", basis: [] }) });
  assert.equal(d4.decidedBy, "rule");
  assert.equal(d4.fallbackCause, "invalid_output");
  assert.equal(d4.to, 3);
  // 例外 → error
  const d5 = await decideQuizLevel(base, { now: NOW, coach: async () => { throw new Error("boom"); } });
  assert.equal(d5.fallbackCause, "error");
  assert.equal(d5.to, 3);
  // 時間切れ（テストでは 50ms に短縮、コーチは 9秒待ち）
  const t0 = Date.now();
  const d6 = await decideQuizLevel(base, {
    now: NOW,
    timeoutMs: 50,
    coach: () => new Promise((resolve) => setTimeout(() => resolve({ level: 3, reason: "", basis: [] }), 9000).unref()),
  });
  assert.equal(d6.fallbackCause, "timeout");
  assert.equal(d6.decidedBy, "rule");
  assert.ok(Date.now() - t0 < 2000);
  // 初回・新しい回答なしは coach を呼ばない
  let called = 0;
  const spy = async () => { called++; return { level: 3, reason: "", basis: [] }; };
  const d7 = await decideQuizLevel(normalizeProfile(undefined), { now: NOW, coach: spy });
  assert.equal(d7.fallbackCause, "no_new_answers");
  assert.equal(d7.to, 2);
  assert.equal(d7.model, null);
  const d8 = await decideQuizLevel({ ...base, lastLevelDecision: d1 }, { now: NOW, coach: spy });
  assert.equal(d8.fallbackCause, "no_new_answers");
  assert.equal(called, 0);
  // 下限・上限の丸め
  const d9 = await decideQuizLevel(prof(5, [e("o", 5), e("o", 5)]), { now: NOW, coach: async () => ({ level: 6, reason: "", basis: [] }) });
  assert.equal(d9.to, 5);
  assert.equal(d9.clamped, true);
}

async function main() {
  testClamp();
  testRule();
  testGuards();
  testCoachInput();
  testKeepAndProfile();
  testApplyFinished();
  testFilter();
  testLevelChangeLine();
  await testDecide();
  console.log("OK try-quiz-level");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
