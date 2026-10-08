import "dotenv/config";
import {
  normalizeProfile,
  type QuizCategory,
  type QuizLevel,
  type QuizProfile,
  type QuizRecentEntry,
} from "../src/quizLevel.js";
import { COACH_BASIS, QUIZ_LEVEL_COACH_VERSION, decideQuizLevel } from "../src/quizLevelAgent.js";

// #829 design 11.1: 難易度コーチの評価。Gemini を実際に呼ぶ（S1 は呼ばれないことの確認）。
// 使い方: npx tsx scripts/try-quiz-level-agent.ts [--runs=3] [--beyond-runs=3] [--only=S4,S5]
//   --runs: 各シナリオの実行回数（既定3）／--beyond-runs: S4・S5 の実行回数（既定は --runs と同じ）

const NOW = new Date("2026-10-08T12:00:00Z");
type R = "o" | "h" | "x"; // o=ヒントなし正解 h=ヒントあり正解 x=最終不正解
type Dir = "up" | "keep" | "down";

function e(r: R, level: QuizLevel, category: QuizCategory = "特徴", hoursAgo = 1): QuizRecentEntry {
  return {
    level, category, isCorrect: r !== "x", hintUsed: r === "h", attempts: r === "o" ? 1 : 2,
    at: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  };
}
function prof(level: QuizLevel, recent: QuizRecentEntry[], extra: Partial<QuizProfile> = {}): QuizProfile {
  return { ...normalizeProfile(undefined), level, recent, answeredCount: recent.length + 3, ...extra };
}

interface CoachScenario {
  id: string; title: string; profile: QuizProfile; expected: Dir[];
  beyondRule?: boolean; // 規則の答えが expected の外（S4・S5）
  noLlm?: boolean;
}

const D14 = 24 * 14;
const SCENARIOS: CoachScenario[] = [
  { id: "S1", title: "初回（回答0）", profile: normalizeProfile(undefined), expected: ["keep"], noLlm: true },
  { id: "S2", title: "L2 ○○", profile: prof(2, [e("o", 2), e("o", 2, "生息地")]), expected: ["up"] },
  { id: "S3", title: "L3 ×(水温)", profile: prof(3, [e("x", 3, "水温")]), expected: ["down"] },
  { id: "S4", title: "L3 ×(ダジャレ)○○○", profile: prof(3, [e("x", 3, "ダジャレ"), e("o", 3), e("o", 3, "生息地"), e("o", 3, "水温")]), expected: ["keep"], beyondRule: true },
  { id: "S5", title: "L3 △△△", profile: prof(3, [e("h", 3), e("h", 3, "生息地"), e("h", 3, "水温")]), expected: ["down"], beyondRule: true },
  { id: "S6", title: "L3(4→3直後) ○○×(L4)○(L4)", profile: prof(3, [e("o", 3), e("o", 3, "生息地"), e("x", 4), e("o", 4, "水温")], { answeredCount: 6, lastChangeDirection: "down", levelChangedAtCount: 4 }), expected: ["keep", "up"] },
  { id: "S7", title: "L4 ○○（14日前）", profile: prof(4, [e("o", 4, "特徴", D14), e("o", 4, "生息地", D14 + 1)]), expected: ["keep", "up"] },
  { id: "S8", title: "L5 ○×5", profile: prof(5, [e("o", 5), e("o", 5, "生息地"), e("o", 5, "水温"), e("o", 5, "深度"), e("o", 5, "豆知識")]), expected: ["keep"] },
  { id: "S9", title: "L1 ×××", profile: prof(1, [e("x", 1), e("x", 1, "生息地"), e("x", 1, "水温")]), expected: ["keep"] },
  { id: "S10", title: "L3 ○△", profile: prof(3, [e("o", 3), e("h", 3, "生息地")]), expected: ["keep"] },
  { id: "S11", title: "L3(2→3直後) ○(L3)○(L2)○(L2)", profile: prof(3, [e("o", 3), e("o", 2, "生息地"), e("o", 2, "水温")], { answeredCount: 6, lastChangeDirection: "up", levelChangedAtCount: 5 }), expected: ["keep"] },
  { id: "S12", title: "L2 ×○", profile: prof(2, [e("x", 2), e("o", 2, "生息地")]), expected: ["down"] },
];

function argNum(name: string): number | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : undefined;
}
const RUNS = argNum("runs") ?? 3;
const BEYOND_RUNS = argNum("beyond-runs") ?? RUNS;
const ONLY = process.argv.find((x) => x.startsWith("--only="))?.split("=")[1]?.split(",");

async function main() {
  const scenarios = SCENARIOS.filter((s) => !ONLY || ONLY.includes(s.id));
  let llmRuns = 0, inExpected = 0, formatOk = 0, forbidden = 0, timeouts = 0;
  const latencies: number[] = [];
  const beyond: Record<string, { ok: number; n: number }> = {};
  let s1Violation = false;

  for (const sc of scenarios) {
    const n = sc.noLlm ? 1 : sc.beyondRule ? BEYOND_RUNS : RUNS;
    for (let i = 1; i <= n; i++) {
      const d = await decideQuizLevel(sc.profile, { now: NOW });
      const ok = sc.expected.includes(d.direction);
      const from = sc.profile.level;
      if (sc.noLlm) {
        if (d.model !== null || d.fallbackCause !== "no_new_answers") s1Violation = true;
      } else {
        llmRuns++;
        if (ok) inExpected++;
        if (sc.beyondRule) (beyond[sc.id] ??= { ok: 0, n: 0 }, beyond[sc.id].n++, ok && beyond[sc.id].ok++);
        latencies.push(d.latencyMs);
        if (d.fallbackCause === "timeout") timeouts++;
        const fmt = d.decidedBy === "rule" || (d.reason.trim() !== "" && d.basis.length >= 1 && d.basis.every((b) => COACH_BASIS.includes(b)));
        if (fmt) formatOk++;
      }
      const last = sc.profile.recent[0];
      if ((last && !last.isCorrect && d.to > from) || Math.abs(d.to - from) > 1 || d.to < 1 || d.to > 5) forbidden++;
      console.log(
        `${sc.id}#${i} ${sc.title} | ${from}→${d.to} ${d.direction} by=${d.decidedBy}${d.fallbackCause ? `(${d.fallbackCause})` : ""} proposed=${d.proposed} guard=${d.guard} basis=[${d.basis}] ruleTo=${d.ruleTo} ${d.latencyMs}ms | ${d.reason} | ${ok ? "OK" : "NG"}`,
      );
      // 本番と同じ形の判断ログ（デモ用、design 10.4）
      console.log(JSON.stringify({ event: "quiz_level_decision", scenario: sc.id, promptVersion: QUIZ_LEVEL_COACH_VERSION, ...d }));
    }
  }

  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : 0;
  const rate = llmRuns ? inExpected / llmRuns : 1;
  const fmtRate = llmRuns ? formatOk / llmRuns : 1;
  const beyondOk = Object.entries(beyond).every(([, v]) => v.n < 3 ? v.ok >= Math.ceil((v.n * 2) / 3) : v.ok >= 2);
  console.log("\n===== 集計 =====");
  console.log(`LLM実行 ${llmRuns} 回 / expected 一致 ${inExpected} (${(rate * 100).toFixed(0)}%)`);
  console.log(`規則を超える判断: ${Object.entries(beyond).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join(", ") || "対象なし"}`);
  console.log(`禁止事項 ${forbidden} 件 / p95 ${p95}ms / 時間切れ ${timeouts} 回 / 出力の形 ${(fmtRate * 100).toFixed(0)}% / S1でLLM未呼び出し ${!s1Violation}`);
  const checks = {
    "expected一致90%以上": rate >= 0.9,
    "S4・S5 が3回中2回以上": beyondOk,
    "禁止事項0件": forbidden === 0,
    "p95 5秒以内": p95 <= 5000,
    "時間切れ1回以下": timeouts <= 1,
    "出力の形95%以上": fmtRate >= 0.95,
    "S1はLLMを呼ばない": !s1Violation,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  const pass = Object.values(checks).every(Boolean);
  console.log(pass ? "\n総合: PASS" : "\n総合: FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
