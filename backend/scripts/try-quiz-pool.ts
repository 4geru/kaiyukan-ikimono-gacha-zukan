import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setLogSink, type Severity } from "../src/log.js";
import { filterCategoriesForLevel, LEVEL_EXCLUDED_CATEGORIES, type QuizLevel } from "../src/quizLevel.js";
import { QUIZ_CATEGORIES, planQuizCategory, type QuizCategory } from "../src/quiz.js";
import { toHistoryCandidates } from "../src/quizAgent.js";
import { parseRuntimeConfig } from "../src/guards.js";
import { findPoolCandidates, hasPool, loadQuizPool, toAgentCandidates, type PoolQuestion } from "../src/quizPool.js";
import { rulePickPoolQuestion, selectPoolQuestion, type PoolSelectorInput } from "../src/quizPoolSelector.js";

// #831 の確認スクリプト。LLM は --live N のときだけ N 回呼ぶ（既定 0）。Firestore は使わない。
// 使い方: npx tsx scripts/try-quiz-pool.ts [--live 6] [--tmp <作業ディレクトリ>]
const argv = process.argv.slice(2);
const liveN = Number(argv[argv.indexOf("--live") + 1]) || 0;
const tmpDir = argv.includes("--tmp") ? argv[argv.indexOf("--tmp") + 1] : join(process.env.TMPDIR ?? "/tmp", "quiz-pool-impl");

let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log(`OK ${label}`);
};

const logs: Array<{ severity: Severity; json: Record<string, any> }> = [];
setLogSink((severity, raw) => logs.push({ severity, json: JSON.parse(raw) }));
const takeLogs = () => logs.splice(0, logs.length);

// ---------------------------------------------------------------------------
// 1. 読み込み: approved の 790問だけ
// ---------------------------------------------------------------------------
const pool = await loadQuizPool();
assert.equal(pool.stats.approved, 790);
assert.equal(pool.stats.rejected, 110);
assert.equal(pool.stats.pending, 0);
assert.equal(pool.stats.invalid, 0);
assert.equal(pool.stats.files, 15);
assert.equal(pool.stats.animals, 15);
let total = 0;
for (const cells of pool.index.values()) {
  for (const q of cells.values()) {
    total++;
    assert.equal(q.review.status, "approved", `${q.id} は approved だけ`);
    assert.equal(q.id, `${q.animalId}-${q.category}-${q.level}`);
  }
}
assert.equal(total, 790);
assert.equal(takeLogs().filter((l) => l.json.event === "quiz_pool_loaded").length, 1);
ok("プールの読み込み: review.status === approved の790問だけ（rejected 110 は除外、invalid 0、15種・15ファイル）");
assert.equal(hasPool(pool, "48"), true);
assert.equal(hasPool(pool, "1"), false);
ok("hasPool: 48 は true、15種以外は false");

// 壊れた行・pending・rejected・重複・レベル1の除外カテゴリ・存在しないディレクトリ
mkdirSync(tmpDir, { recursive: true });
const base = {
  animalId: "9", question: "q", choices: ["a", "b", "c"], correctIndex: 0, explanation: "e", factSource: "official",
  groundingNames: [], generatedBy: "x", generatedAt: "2026-10-08", review: { status: "approved" },
};
const line = (o: Record<string, unknown>) => JSON.stringify({ ...base, ...o });
writeFileSync(
  join(tmpDir, "9.jsonl"),
  [
    line({ id: "9-生息地-2", category: "生息地", level: 2 }), // OK
    line({ id: "9-生息地-2", category: "生息地", level: 2 }), // 重複
    "{broken json",
    line({ id: "9-水域-2", category: "水域", level: 2, review: { status: "pending" } }),
    line({ id: "9-水温-2", category: "水温", level: 2, review: { status: "rejected", issues: ["x"] } }),
    line({ id: "9-郷土料理-1", category: "郷土料理", level: 1 }), // レベル1の除外カテゴリ
    line({ id: "9-深度-2", category: "深度", level: 2, choices: ["a", "a", "c"] }), // 選択肢重複
    line({ id: "9-特徴-2", category: "特徴", level: 2, correctIndex: 3 }), // 範囲外
    line({ id: "wrong-id", category: "豆知識", level: 2 }), // id 不一致
    line({ id: "9-存在しない-2", category: "存在しない", level: 2 }),
  ].join("\n"),
);
const broken = await loadQuizPool(tmpDir);
assert.deepEqual(
  { approved: broken.stats.approved, rejected: broken.stats.rejected, pending: broken.stats.pending, invalid: broken.stats.invalid },
  { approved: 1, rejected: 1, pending: 1, invalid: 7 },
);
assert.equal(takeLogs().filter((l) => l.json.event === "quiz_pool_invalid" && l.severity === "WARNING").length, 7);
const missing = await loadQuizPool(join(tmpDir, "no-such-dir"));
assert.equal(missing.index.size, 0);
assert.equal(takeLogs().filter((l) => l.json.event === "quiz_pool_load_failed" && l.severity === "ERROR").length, 1);
ok("壊れた行・重複・pending・rejected・除外カテゴリは読み飛ばし、ディレクトリが無ければ空のプールで続行");

// ---------------------------------------------------------------------------
// 2. マスの引き方と「同じ問題を出さない」
// ---------------------------------------------------------------------------
const freshAll = planQuizCategory([]);
assert.equal(freshAll.kind, "fresh");
const allowed2 = filterCategoriesForLevel(freshAll.kind === "fresh" ? freshAll.candidates : [], 2);
const cellsOf = (animalId: string, level: QuizLevel) => [...(pool.index.get(animalId)?.values() ?? [])].filter((q) => q.level === level);
const find = (animalId: string, level: QuizLevel, asked: Set<string>, plan = freshAll, allowed: readonly QuizCategory[] = allowed2) =>
  findPoolCandidates({ pool, animalId, plan, level, allowed, askedPoolIds: asked });

const r0 = find("48", 2, new Set());
assert.equal(r0.missReason, "none");
assert.equal(r0.candidates.length, cellsOf("48", 2).length);
assert.ok(r0.candidates.every((q) => q.level === 2 && q.animalId === "48"));
ok(`fresh・レベル2・既出なし: 候補は 48 のレベル2の作り置き ${r0.candidates.length}件（rejected のマスを除く）`);

const askedOne = new Set([r0.candidates[0].id]);
const r1 = find("48", 2, askedOne);
assert.equal(r1.candidates.length, r0.candidates.length - 1);
assert.ok(!r1.candidates.some((q) => askedOne.has(q.id)));
assert.equal(find("48", 2, new Set(r0.candidates.map((q) => q.id))).missReason, "all_asked");
ok("既出 ID は候補から消え、全部出すと all_asked");

// 出し切るまで重複しない（直近5問ルールを無視して引き続ける）
const asked = new Set<string>();
const seen: string[] = [];
for (let i = 0; i < 100; i++) {
  const r = find("48", 2, asked);
  if (r.candidates.length === 0) {
    assert.equal(r.missReason, "all_asked");
    break;
  }
  const pick = rulePickPoolQuestion(
    r.candidates.map((q) => ({ id: q.id, category: q.category, question: q.question, grounded: true })),
    [],
  );
  assert.ok(!asked.has(pick.id), "同じ問題を出さない");
  asked.add(pick.id);
  seen.push(pick.id);
}
assert.equal(new Set(seen).size, seen.length);
assert.equal(seen.length, cellsOf("48", 2).length);
ok(`同じ人に同じ問題を出さない: 48 のレベル2を ${seen.length}問すべて重複なしで出し切り、その次は all_asked`);

// 15種以外・rejected のマス・レベルの代用をしない
assert.equal(find("1", 2, new Set()).missReason, "no_pool_for_animal");
const rejectedIds = (await import("node:fs")).readFileSync(new URL("../data/quiz-pool/30.jsonl", import.meta.url), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.review.status === "rejected");
const rj = rejectedIds[0]; // 30-水域-4
const retryRejected = findPoolCandidates({
  pool, animalId: "30", plan: { kind: "retry", category: rj.category }, level: rj.level, allowed: [rj.category], askedPoolIds: new Set(),
});
assert.equal(retryRejected.missReason, "no_cell");
ok(`rejected のマス（${rj.id}）の retry は no_cell（その場で作る）`);
const retryAsked = findPoolCandidates({
  pool, animalId: "48", plan: { kind: "retry", category: "生息地" }, level: 2, allowed: ["生息地"], askedPoolIds: new Set(["48-生息地-2"]),
});
assert.equal(retryAsked.missReason, "all_asked");
const retryOk = findPoolCandidates({
  pool, animalId: "48", plan: { kind: "retry", category: "生息地" }, level: 2, allowed: ["生息地"], askedPoolIds: new Set(),
});
assert.deepEqual(retryOk.candidates.map((q) => q.id), ["48-生息地-2"]);
ok("retry: 同じカテゴリ・同じレベルの1問を返し、出題済みなら all_asked");
const lv1 = filterCategoriesForLevel([...QUIZ_CATEGORIES], 1);
const r5 = find("48", 1, new Set(), freshAll, lv1);
assert.ok(r5.candidates.length > 0);
assert.ok(r5.candidates.every((q) => !LEVEL_EXCLUDED_CATEGORIES[1].includes(q.category) && q.level === 1));
ok("レベル1: 除外カテゴリは候補に出ず、他のレベルの問題で代用しない");
assert.ok(find("48", 2, new Set(), freshAll, allowed2).candidates.every((q) => q.level === 2));
ok("レベルの代用なし（候補は決まったレベルのマスだけ）");

// consideredCategories → quizHistory へ写すとき、選択肢と正解番号が落ちる（#832 B2）
const considered = toAgentCandidates(r0.candidates);
const hist = toHistoryCandidates(considered);
assert.ok(hist && hist.length === considered.length);
assert.ok(hist.every((h) => !("choices" in h) && !("correctIndex" in h)));
ok("quizHistory に写る候補から選択肢と正解番号が落ちる");

// ---------------------------------------------------------------------------
// 3. 選択エージェントの検証と打ち切り（偽物）
// ---------------------------------------------------------------------------
const cands = r0.candidates.slice(0, 4).map((q: PoolQuestion) => ({ id: q.id, category: q.category, question: q.question, grounded: true }));
const input: PoolSelectorInput = {
  animal: { id: "48", name: "ジンベエザメ" },
  level: 2,
  recentForAnimal: [{ category: "生息地", isCorrect: true }],
  recentOverall: [],
  candidates: cands,
};
const agentRun = () => {
  const runs = takeLogs().filter((l) => l.json.event === "agent_run");
  assert.equal(runs.length, 1, "agent_run は1回だけ");
  return runs[0].json;
};
takeLogs();

let sel = await selectPoolQuestion(input, { selector: async () => JSON.stringify({ id: cands[2].id, reason: "流れを変える" }) });
assert.deepEqual([sel.selectedBy, sel.chosenId, sel.fallbackCause], ["agent", cands[2].id, null]);
let run = agentRun();
assert.equal(run.agent, "quiz_pool");
assert.equal(run.outcome, "ok");
assert.equal(run.decision.chosen, cands[2].id);
assert.deepEqual(run.decision.candidates, cands.map((c) => c.id));
ok("候補内の id: エージェントの選択を採用（agent_run: quiz_pool / ok、decision に候補 ID と理由）");

sel = await selectPoolQuestion(input, { selector: async () => ({ id: "99-存在しない-9", reason: "x" }) });
assert.equal(sel.selectedBy, "rule");
assert.equal(sel.fallbackCause, "candidate_replaced");
assert.ok(cands.some((c) => c.id === sel.chosenId));
run = agentRun();
assert.equal(run.outcome, "fallback_rule");
assert.equal(run.decision.replaced, true);
ok("候補外の id: 規則で候補から選び直す（outcome=fallback_rule、replaced=true）");

sel = await selectPoolQuestion(input, { selector: async () => "not json" });
assert.deepEqual([sel.selectedBy, sel.fallbackCause], ["rule", "schema_invalid"]);
assert.equal(agentRun().outcome, "fallback_rule");
sel = await selectPoolQuestion(input, { selector: async () => undefined });
assert.equal(sel.fallbackCause, "schema_invalid");
takeLogs();
ok("JSON 不正・空応答: 規則（schema_invalid）");

const t0 = Date.now();
sel = await selectPoolQuestion(input, {
  timeoutMs: 300,
  selector: () => new Promise((resolve) => setTimeout(() => resolve({ id: cands[0].id, reason: "遅い" }), 1500)),
});
assert.ok(Date.now() - t0 < 1000, "打ち切りで待たない");
assert.deepEqual([sel.selectedBy, sel.fallbackCause], ["rule", "timeout"]);
run = agentRun();
assert.equal(run.outcome, "timeout");
ok(`時間切れ: ${Date.now() - t0}ms で打ち切り、規則で選ぶ（outcome=timeout）`);

sel = await selectPoolQuestion(input, {
  selector: async () => {
    throw new Error("boom");
  },
});
assert.deepEqual([sel.selectedBy, sel.fallbackCause], ["rule", "error"]);
assert.equal(agentRun().outcome, "error");
ok("例外: 投げずに規則で選ぶ（outcome=error）");

sel = await selectPoolQuestion({ ...input, candidates: [cands[0]] }, { selector: async () => assert.fail("1件のときは呼ばない") });
assert.deepEqual([sel.selectedBy, sel.fallbackCause, sel.chosenId], ["rule", "single_candidate", cands[0].id]);
assert.equal(takeLogs().filter((l) => l.json.event === "agent_run").length, 0);
ok("候補1件: エージェントを呼ばずそのまま出す（agent_run なし）");

sel = await selectPoolQuestion({ ...input, killSwitch: true }, { selector: async () => assert.fail("停止スイッチのときは呼ばない") });
assert.deepEqual([sel.selectedBy, sel.fallbackCause], ["rule", "kill_switch"]);
run = agentRun();
assert.equal(run.outcome, "kill_switch");
ok("停止スイッチ quiz: 呼ばずに規則（agent_run outcome=kill_switch）");

// 規則: 直前と同じカテゴリを避ける
for (let i = 0; i < 50; i++) {
  const p = rulePickPoolQuestion(cands, [{ category: cands[0].category }], Math.random);
  assert.notEqual(p.category, cands[0].category);
}
assert.equal(rulePickPoolQuestion([cands[0]], [{ category: cands[0].category }]).id, cands[0].id);
ok("規則: 直前と同じカテゴリを避ける（それしか無ければそれを選ぶ）");

// ---------------------------------------------------------------------------
// 4. 停止スイッチ quiz_pool
// ---------------------------------------------------------------------------
assert.ok(parseRuntimeConfig({ disabledAgents: ["quiz_pool", "quiz", "bogus"] }).disabledAgents.has("quiz_pool"));
assert.equal(parseRuntimeConfig({ disabledAgents: ["quiz"] }).disabledAgents.has("quiz_pool"), false);
assert.equal(parseRuntimeConfig({ disabledAgents: ["bogus"] }).disabledAgents.size, 0);
ok("config/runtime.disabledAgents に quiz_pool を入れると停止スイッチとして読まれる（quiz とは独立）");

// ---------------------------------------------------------------------------
// 5. 実物（--live N のときだけ。Gemini を N 回呼ぶ）
// ---------------------------------------------------------------------------
if (liveN > 0) {
  const combos: Array<[string, string, QuizLevel]> = [["48", "ジンベエザメ", 2], ["206", "", 2], ["33", "", 3], ["48", "ジンベエザメ", 3], ["206", "", 3], ["33", "", 2]];
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < liveN; i++) {
    const [animalId, name, level] = combos[i % combos.length];
    const c = cellsOf(animalId, level).map((q) => ({ id: q.id, category: q.category, question: q.question, grounded: q.factSource === "official" || q.factSource === "wikipedia" }));
    takeLogs();
    const started = Date.now();
    const s = await selectPoolQuestion({ animal: { id: animalId, name: name || `種${animalId}` }, level, recentForAnimal: [{ category: c[0].category, isCorrect: false }], recentOverall: [], candidates: c });
    const ms = Date.now() - started;
    const runLog = takeLogs().find((l) => l.json.event === "agent_run")?.json;
    results.push({ animalId, level, candidates: c.length, ms, selectedBy: s.selectedBy, fallbackCause: s.fallbackCause, chosen: s.chosenId, reason: s.reason, outcome: runLog?.outcome, inputTokens: runLog?.inputTokens, outputTokens: runLog?.outputTokens });
    console.log(results[results.length - 1]);
  }
  const mss = results.map((r) => r.ms as number).sort((a, b) => a - b);
  console.log(`live: ${liveN}回 中央値 ${mss[Math.floor(mss.length / 2)]}ms 最大 ${mss[mss.length - 1]}ms 規則に落ちた ${results.filter((r) => r.selectedBy === "rule").length}回`);
  writeFileSync(join(tmpDir, "selector-live.json"), JSON.stringify(results, null, 2));
}

console.log(`\n${passed} 項目 OK`);
