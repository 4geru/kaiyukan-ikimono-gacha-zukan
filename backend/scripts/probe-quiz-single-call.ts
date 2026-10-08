import "dotenv/config";
import { Type } from "@google/genai";
import { loadKaiyukanAnimals } from "../src/kaiyukanData.js";
import { buildPrompt, getClient } from "../src/quiz.js";

// #824: 並列化しても速くならなかった原因の切り分け。1カテゴリ分の生成1回の所要時間・思考トークン数を、
// モデルと thinkingBudget を変えて測る。使い方: tsx scripts/probe-quiz-single-call.ts [回数=3]
const runs = Number(process.argv[2] ?? 3);
const schema = {
  type: Type.OBJECT,
  properties: {
    question: { type: Type.STRING },
    choices: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "3", maxItems: "3" },
    correctIndex: { type: Type.INTEGER },
  },
  required: ["question", "choices", "correctIndex"],
};

const variants: Array<{ label: string; model: string; thinkingBudget?: number }> = [
  { label: "gemini-2.5-flash（既定の思考）", model: "gemini-2.5-flash" },
  { label: "gemini-2.5-flash（thinkingBudget=0）", model: "gemini-2.5-flash", thinkingBudget: 0 },
  { label: "gemini-flash-latest（既定）", model: "gemini-flash-latest" },
];

async function main() {
  const animals = await loadKaiyukanAnimals();
  const animal = animals.find((a) => a.name === "ジンベエザメ")!;
  const prompt = buildPrompt(animal, "豆知識", []);
  console.log("| 設定 | 回 | 所要(秒) | 思考トークン | 出力トークン |\n| --- | --- | --- | --- | --- |");
  for (let i = 1; i <= runs; i++) {
    for (const v of variants) {
      const t = Date.now();
      const res = await getClient().models.generateContent({
        model: v.model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(v.thinkingBudget === undefined ? {} : { thinkingConfig: { thinkingBudget: v.thinkingBudget } }),
        },
      });
      const u = res.usageMetadata;
      console.log(`| ${v.label} | ${i} | ${((Date.now() - t) / 1000).toFixed(1)} | ${u?.thoughtsTokenCount ?? 0} | ${u?.candidatesTokenCount ?? "-"} |`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
