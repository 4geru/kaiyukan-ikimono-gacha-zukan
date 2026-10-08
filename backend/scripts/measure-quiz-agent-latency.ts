import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadKaiyukanAnimals } from "../src/kaiyukanData.js";
import { QUIZ_CATEGORIES, type QuizCategory } from "../src/quiz.js";
import { generateQuizWithAgent, type AgentQuizResult } from "../src/quizAgent.js";
import { generateQuizParallelDetailed } from "../src/quizAgentParallel.js";
import { generateQuizWorkflowDetailed } from "../src/quizAgentWorkflow.js";
import type { QuizAgentTimings } from "../src/quizAgentShared.js";

// #824: 改善前(before) / 方式B(parallel) / 方式W(workflow) を同じ条件で測る。
// 使い方: tsx scripts/measure-quiz-agent-latency.ts [回数=3] [生き物名,生き物名=ジンベエザメ,ナンヨウマンタ] [methods=before,parallel,workflow]
// 方式をラウンドロビンで交互に実行し、最初に捨てウォームアップを1回行う。結果JSONは docs/specs/824-.../measurements/ に保存。

type Method = "before" | "parallel" | "workflow";

interface Sample {
  animal: string;
  method: Method;
  run: number;
  ok: boolean;
  totalMs: number;
  timings?: QuizAgentTimings;
  selectedCategory?: QuizCategory;
  consideredCount?: number;
  error?: string;
}

const runs = Number(process.argv[2] ?? 3);
const animalNames = (process.argv[3] ?? "ジンベエザメ,ナンヨウマンタ").split(",");
const methods = (process.argv[4] ?? "before,parallel,workflow").split(",") as Method[];

async function runOnce(method: Method, animal: Awaited<ReturnType<typeof loadKaiyukanAnimals>>[number]) {
  const candidates = [...QUIZ_CATEGORIES];
  if (method === "before") {
    const result = await generateQuizWithAgent(animal, candidates);
    return { result, timings: undefined };
  }
  const detailed =
    method === "parallel"
      ? await generateQuizParallelDetailed(animal, candidates)
      : await generateQuizWorkflowDetailed(animal, candidates);
  return detailed;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

const sec = (ms: number) => (ms / 1000).toFixed(1);

async function main() {
  const animals = await loadKaiyukanAnimals();
  const targets = animalNames.map((name) => {
    const animal = animals.find((a) => a.name === name);
    if (!animal) throw new Error(`生き物が見つかりません: ${name}`);
    return animal;
  });

  const samples: Sample[] = [];
  const startedAt = new Date().toISOString();

  // ウォームアップ（結果は捨てる）
  console.log("--- ウォームアップ（結果は捨てる） ---");
  for (const method of methods) {
    const t = Date.now();
    await runOnce(method, targets[0]).catch((e) => console.warn(`warmup ${method} 失敗: ${e}`));
    console.log(`${method}: ${sec(Date.now() - t)}s`);
  }

  for (let run = 1; run <= runs; run++) {
    for (const animal of targets) {
      for (const method of methods) {
        const start = Date.now();
        const sample: Sample = { animal: animal.name, method, run, ok: false, totalMs: 0 };
        try {
          const { result, timings } = await runOnce(method, animal);
          sample.ok = true;
          sample.timings = timings;
          sample.selectedCategory = (result as AgentQuizResult).quiz.category;
          sample.consideredCount = result.consideredCategories.length;
        } catch (error) {
          sample.error = error instanceof Error ? error.message : String(error);
        }
        sample.totalMs = Date.now() - start;
        samples.push(sample);
        console.log(
          `[${animal.name}] run${run} ${method}: ${sample.ok ? "OK" : "NG"} ${sec(sample.totalMs)}s ` +
            `${sample.ok ? `選択=${sample.selectedCategory} 候補=${sample.consideredCount}` : sample.error}`,
        );
      }
    }
  }

  console.log("\n## 所要時間（秒、成功した回のみ）");
  console.log("| 生き物 | 方式 | 成功/試行 | 中央値 | 最小 | 最大 | 生成フェーズ(中央値) | 選ぶ段階(中央値) |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const animal of targets) {
    for (const method of methods) {
      const group = samples.filter((s) => s.animal === animal.name && s.method === method);
      const ok = group.filter((s) => s.ok);
      if (ok.length === 0) {
        console.log(`| ${animal.name} | ${method} | 0/${group.length} | - | - | - | - | - |`);
        continue;
      }
      const total = stats(ok.map((s) => s.totalMs));
      const withTimings = ok.filter((s) => s.timings);
      const gen = withTimings.length ? sec(stats(withTimings.map((s) => s.timings!.generateMs)).median) : "-";
      const sel = withTimings.length ? sec(stats(withTimings.map((s) => s.timings!.selectMs)).median) : "-";
      console.log(
        `| ${animal.name} | ${method} | ${ok.length}/${group.length} | ${sec(total.median)} | ${sec(total.min)} | ${sec(total.max)} | ${gen} | ${sel} |`,
      );
    }
  }

  console.log("\n## 選ばれたカテゴリ");
  for (const method of methods) {
    const counts = new Map<string, number>();
    samples.filter((s) => s.method === method && s.ok).forEach((s) => counts.set(s.selectedCategory!, (counts.get(s.selectedCategory!) ?? 0) + 1));
    console.log(`- ${method}: ${[...counts.entries()].map(([c, n]) => `${c}×${n}`).join("、") || "-"}`);
  }
  console.log(`\n候補数が13未満だった回（失敗カテゴリあり）: ${samples.filter((s) => s.ok && (s.consideredCount ?? 0) < QUIZ_CATEGORIES.length).map((s) => `${s.animal}/${s.method}/run${s.run}=${s.consideredCount}`).join(", ") || "なし"}`);

  const outDir = join(import.meta.dirname, "..", "..", "docs", "specs", "824-quiz-agent-parallel-refactor", "measurements");
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `latency-${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(
    file,
    JSON.stringify({ startedAt, node: process.version, model: process.env.QUIZ_AGENT_MODEL ?? "gemini-2.5-flash", runs, animals: animalNames, methods, samples }, null, 2),
  );
  console.log(`\n結果JSON: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
