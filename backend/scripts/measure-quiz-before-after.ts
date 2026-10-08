import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findFamilyMateNames, findTankmateNames, loadKaiyukanAnimals, type KaiyukanAnimal } from "../src/kaiyukanData.js";
import { QUIZ_CATEGORIES, generateQuizForAnimal, pickRandomCategory, type QuizCategory } from "../src/quiz.js";
import { generateQuizWithAgent } from "../src/quizAgent.js";

// #824: 「全部作ってから選ぶ」(before) と「カテゴリを先に選んで1問だけ作る」(after) の所要時間を同じ回に測る。
// 使い方: tsx scripts/measure-quiz-before-after.ts [回数=3] [生き物名,生き物名=ジンベエザメ,ナンヨウマンタ]
// - before: generateQuizWithAgent（候補13カテゴリ全部。ADK, gemini-2.5-flash）
// - after-25flash: カテゴリをランダムに1つ選び、必要なら実在種名を取得して generateQuizForAnimal を1回（モデルは before と同じ gemini-2.5-flash）
// - after-prod: 同上、モデルは本番の既定（quiz.ts の MODEL）
// 方式をラウンドロビンで交互に実行し、最初に捨てウォームアップを1回行う。結果JSONは docs/specs/824-.../measurements/ に保存。

type Method = "before" | "after-25flash" | "after-prod";
const METHODS: Method[] = ["before", "after-25flash", "after-prod"];

interface Sample {
  animal: string;
  method: Method;
  run: number;
  ok: boolean;
  totalMs: number;
  category?: QuizCategory;
  error?: string;
}

const runs = Number(process.argv[2] ?? 3);
const animalNames = (process.argv[3] ?? "ジンベエザメ,ナンヨウマンタ").split(",");

async function afterOnce(animal: KaiyukanAnimal, model?: string): Promise<QuizCategory> {
  const category = pickRandomCategory();
  const grounding =
    category === "類似した仲間"
      ? await findFamilyMateNames(animal.id)
      : category === "同じ水槽にいる魚"
        ? await findTankmateNames(animal.id)
        : [];
  const quiz = await generateQuizForAnimal(animal, category, grounding, model);
  return quiz.category;
}

async function runOnce(method: Method, animal: KaiyukanAnimal): Promise<QuizCategory> {
  if (method === "before") return (await generateQuizWithAgent(animal, [...QUIZ_CATEGORIES])).quiz.category;
  return afterOnce(animal, method === "after-25flash" ? "gemini-2.5-flash" : undefined);
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

  console.log("--- ウォームアップ（結果は捨てる） ---");
  for (const method of METHODS) {
    const t = Date.now();
    await runOnce(method, targets[0]).catch((e) => console.warn(`warmup ${method} 失敗: ${e}`));
    console.log(`${method}: ${sec(Date.now() - t)}s`);
  }

  for (let run = 1; run <= runs; run++) {
    for (const animal of targets) {
      for (const method of METHODS) {
        const start = Date.now();
        const sample: Sample = { animal: animal.name, method, run, ok: false, totalMs: 0 };
        try {
          sample.category = await runOnce(method, animal);
          sample.ok = true;
        } catch (error) {
          sample.error = error instanceof Error ? error.message : String(error);
        }
        sample.totalMs = Date.now() - start;
        samples.push(sample);
        console.log(`[${animal.name}] run${run} ${method}: ${sample.ok ? "OK" : "NG"} ${sec(sample.totalMs)}s ${sample.ok ? `選択=${sample.category}` : sample.error}`);
      }
    }
  }

  console.log("\n## 所要時間（秒、成功した回のみ）");
  console.log("| 生き物 | 方式 | 成功/試行 | 中央値 | 最小 | 最大 |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const animal of targets) {
    for (const method of METHODS) {
      const group = samples.filter((s) => s.animal === animal.name && s.method === method);
      const ok = group.filter((s) => s.ok);
      if (ok.length === 0) {
        console.log(`| ${animal.name} | ${method} | 0/${group.length} | - | - | - |`);
        continue;
      }
      const t = stats(ok.map((s) => s.totalMs));
      console.log(`| ${animal.name} | ${method} | ${ok.length}/${group.length} | ${sec(t.median)} | ${sec(t.min)} | ${sec(t.max)} |`);
    }
  }
  for (const method of METHODS) {
    const ok = samples.filter((s) => s.method === method && s.ok);
    if (ok.length) console.log(`全体(${method}): 中央値 ${sec(stats(ok.map((s) => s.totalMs)).median)}秒 (${ok.length}回)`);
  }

  const outDir = join(import.meta.dirname, "..", "..", "docs", "specs", "824-quiz-agent-parallel-refactor", "measurements");
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `before-after-${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ startedAt, node: process.version, runs, animals: animalNames, samples }, null, 2));
  console.log(`\n結果JSON: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
