import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@google/genai";
import { findFamilyMateNames, findTankmateNames, loadKaiyukanAnimals, type KaiyukanAnimal } from "../src/kaiyukanData.js";
import { CATEGORY_BRIEFS, QUIZ_CATEGORIES, buildPrompt, buildReferenceSection, generateQuizForAnimal, getClient, pickRandomCategory, type QuizQuestion } from "../src/quiz.js";
import { generateQuizWithAgent, type AgentQuizCandidate } from "../src/quizAgent.js";

// #831: 方式ごとの1回あたりトークン（入力・出力・思考）と所要時間の実測。
// 使い方: tsx scripts/measure-quiz-cost.ts [回数=3] [生き物名,...=ジンベエザメ,ナンヨウマンタ]
// - A: generateQuizWithAgent（ADK、候補13カテゴリ全部）  - B-prod: generateQuizForAnimal（本番モデル）
// - B-t0: 同プロンプトを gemini-2.5-flash + thinkingBudget=0  - C: 1問を思考ありで検証
// - D: Aの候補6問から gemini-2.5-flash(thinking 0) が1問選ぶ
// Models.prototype をフックして、全 generateContent(Stream) 呼び出しの usageMetadata を合計する（ADKのツール往復も含む）。

interface Usage { calls: number; input: number; output: number; thinking: number; total: number }
let acc: Usage = { calls: 0, input: 0, output: 0, thinking: 0, total: 0 };
function add(u: any) {
  if (!u) return;
  acc.calls++;
  acc.input += u.promptTokenCount ?? 0;
  acc.output += u.candidatesTokenCount ?? 0;
  acc.thinking += u.thoughtsTokenCount ?? 0;
  acc.total += u.totalTokenCount ?? 0;
}
// Models は arrow プロパティで生成されるためプロトタイプでは掴めない。fetch をフックして応答JSONの usageMetadata を拾う。
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const res = await origFetch(...args);
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (url.includes("generativelanguage.googleapis.com") && !url.includes("stream")) {
    try { add((await res.clone().json()).usageMetadata); } catch { /* 無視 */ }
  }
  return res;
};

const CHEAP = "gemini-2.5-flash";
type Method = "A" | "B-prod" | "B-t0" | "C" | "D";
interface Sample { animal: string; method: Method; run: number; ok: boolean; ms: number; usage: Usage; note?: string; error?: string }

const quizSchema = {
  type: Type.OBJECT,
  properties: { question: { type: Type.STRING }, choices: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "3", maxItems: "3" }, correctIndex: { type: Type.INTEGER } },
  required: ["question", "choices", "correctIndex"],
};

async function groundingFor(animal: KaiyukanAnimal, category: string) {
  return category === "類似した仲間" ? findFamilyMateNames(animal.id) : category === "同じ水槽にいる魚" ? findTankmateNames(animal.id) : [];
}

async function generateT0(animal: KaiyukanAnimal, category: any, grounding: string[]): Promise<QuizQuestion> {
  const res = await getClient().models.generateContent({
    model: CHEAP,
    contents: buildPrompt(animal, category, grounding),
    config: { responseMimeType: "application/json", responseSchema: quizSchema, thinkingConfig: { thinkingBudget: 0 } },
  });
  const p = JSON.parse(res.text ?? "{}");
  return { animalId: animal.id, category, question: p.question, choices: p.choices, correctIndex: p.correctIndex };
}

async function verify(animal: KaiyukanAnimal, q: QuizQuestion): Promise<string> {
  const brief = CATEGORY_BRIEFS[q.category];
  const prompt = `あなたは水族館クイズの厳しい校閲者です。次の三択クイズを検証してください。
# 生き物の情報
名前: ${animal.name}（${animal.scientificName}） 分類: ${animal.classification}（${animal.family}）
説明: ${animal.description}
${buildReferenceSection(animal)}
# クイズ（カテゴリ: ${q.category} / 切り口: ${brief.focus}）
問題: ${q.question}
選択肢: ${q.choices.map((c, i) => `${i}:${c}`).join(" / ")}
想定正解: ${q.correctIndex}
# 判定
(a) 事実が情報・参考資料・確実な知識と矛盾しない (b) 正解が一つに決まり誤答が正解になりえない (c) カテゴリの切り口とレベル2（小学生向け）に合う。
JSONで {"factOk":bool,"uniqueAnswer":bool,"levelOk":bool,"pass":bool,"reason":string} を返す。`;
  const res = await getClient().models.generateContent({
    model: CHEAP, contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  return JSON.parse(res.text ?? "{}").pass === true ? "pass" : `fail:${res.text?.slice(0, 80)}`;
}

async function select(animal: KaiyukanAnimal, cands: AgentQuizCandidate[]): Promise<string> {
  const list = cands.map((c, i) => `${i}: [${c.category}] ${c.question} / ${c.choices.join(" | ")}`).join("\n");
  const prompt = `水族館ガイドとして、${animal.name}について次の候補から、最も面白くこの生き物ならではの1問を選び、短い理由を返してください。\n${list}\nJSONで {"index":number,"reason":string} のみ。`;
  const res = await getClient().models.generateContent({
    model: CHEAP, contents: prompt,
    config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
  });
  const p = JSON.parse(res.text ?? "{}");
  if (typeof p.index !== "number" || !cands[p.index]) throw new Error("選択が不正");
  return `idx=${p.index}`;
}

const runs = Number(process.argv[2] ?? 3);
const animalNames = (process.argv[3] ?? "ジンベエザメ,ナンヨウマンタ").split(",");
const sec = (ms: number) => (ms / 1000).toFixed(1);

async function timed(animal: string, method: Method, run: number, fn: () => Promise<string | void>): Promise<Sample> {
  acc = { calls: 0, input: 0, output: 0, thinking: 0, total: 0 };
  const t = Date.now();
  const s: Sample = { animal, method, run, ok: false, ms: 0, usage: acc };
  try { s.note = (await fn()) ?? undefined; s.ok = true; } catch (e) { s.error = e instanceof Error ? e.message : String(e); }
  s.ms = Date.now() - t;
  s.usage = { ...acc };
  console.log(`[${animal}] run${run} ${method}: ${s.ok ? "OK" : "NG"} ${sec(s.ms)}s calls=${s.usage.calls} in=${s.usage.input} out=${s.usage.output} think=${s.usage.thinking} ${s.note ?? s.error ?? ""}`);
  return s;
}

async function main() {
  const animals = await loadKaiyukanAnimals();
  const targets = animalNames.map((n) => animals.find((a) => a.name === n) ?? (() => { throw new Error(`見つかりません: ${n}`); })());
  const samples: Sample[] = [];
  const startedAt = new Date().toISOString();
  for (let run = 1; run <= runs; run++) {
    for (const animal of targets) {
      let cands: AgentQuizCandidate[] = [];
      samples.push(await timed(animal.name, "A", run, async () => {
        const r = await generateQuizWithAgent(animal, [...QUIZ_CATEGORIES]);
        cands = r.consideredCategories;
        return `選択=${r.quiz.category} 候補=${cands.length}`;
      }));
      let made: QuizQuestion | undefined;
      const cat = pickRandomCategory();
      const g = await groundingFor(animal, cat);
      samples.push(await timed(animal.name, "B-prod", run, async () => { made = await generateQuizForAnimal(animal, cat, g); return cat; }));
      const cat2 = pickRandomCategory();
      const g2 = await groundingFor(animal, cat2);
      let made0: QuizQuestion | undefined;
      samples.push(await timed(animal.name, "B-t0", run, async () => { made0 = await generateT0(animal, cat2, g2); return cat2; }));
      const target = made0 ?? made;
      if (target) samples.push(await timed(animal.name, "C", run, () => verify(animal, target)));
      if (cands.length) samples.push(await timed(animal.name, "D", run, () => select(animal, [...cands].sort(() => Math.random() - 0.5).slice(0, 6))));
    }
  }
  const outDir = join(import.meta.dirname, "..", "..", "docs", "specs", "831-quiz-pool", "measurements");
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `cost-${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ startedAt, node: process.version, runs, animals: animalNames, samples }, null, 2));
  console.log(`\n結果JSON: ${file}`);
  for (const m of ["A", "B-prod", "B-t0", "C", "D"] as Method[]) {
    const ok = samples.filter((s) => s.method === m && s.ok);
    if (!ok.length) { console.log(`${m}: 成功0`); continue; }
    const avg = (f: (s: Sample) => number) => Math.round(ok.reduce((a, s) => a + f(s), 0) / ok.length);
    const med = [...ok].map((s) => s.ms).sort((a, b) => a - b)[Math.floor((ok.length - 1) / 2)];
    console.log(`${m}: n=${ok.length}/${samples.filter((s) => s.method === m).length} 中央値${sec(med)}s 平均 calls=${(ok.reduce((a, s) => a + s.usage.calls, 0) / ok.length).toFixed(1)} in=${avg((s) => s.usage.input)} out=${avg((s) => s.usage.output)} think=${avg((s) => s.usage.thinking)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
