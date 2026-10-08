import { Type } from "@google/genai";
import type { KaiyukanAnimal } from "./kaiyukanData.js";
import { QUIZ_CATEGORIES, generateQuizForAnimal, getClient, type QuizCategory } from "./quiz.js";
import type { AgentQuizCandidate, AgentQuizResult } from "./quizAgent.js";
import {
  MIN_SUCCESSFUL_CANDIDATES,
  QUIZ_AGENT_MODEL,
  assembleResult,
  buildSelectionPrompt,
  fallbackSelection,
  groundingFor,
  loadGroundingNames,
  toCandidate,
  type DetailedAgentQuizResult,
} from "./quizAgentShared.js";

// 方式B: カテゴリごとの生成をPromise.allSettledで並列に走らせ、できた候補から選ぶLLMを1回だけ呼ぶ。
// docs/specs/824-quiz-agent-parallel-refactor/design.md 8章。generateQuizWithAgent(quizAgent.ts)と
// 返り値・引数が互換。モデルは改善前と揃える（QUIZ_AGENT_MODEL）。

export async function generateQuizParallelDetailed(
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[] = QUIZ_CATEGORIES,
): Promise<DetailedAgentQuizResult> {
  const grounding = await loadGroundingNames(animal);

  const generateStart = Date.now();
  const settled = await Promise.allSettled(
    candidateCategories.map((category) =>
      generateQuizForAnimal(animal, category, groundingFor(grounding, category), QUIZ_AGENT_MODEL),
    ),
  );
  const candidates: AgentQuizCandidate[] = [];
  const failed: QuizCategory[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      candidates.push(toCandidate(outcome.value, groundingFor(grounding, candidateCategories[i])));
    } else {
      failed.push(candidateCategories[i]);
      console.warn(`カテゴリ「${candidateCategories[i]}」の生成に失敗: ${outcome.reason}`);
    }
  });
  const generateMs = Date.now() - generateStart;

  if (candidates.length < MIN_SUCCESSFUL_CANDIDATES) {
    throw new Error(`生成に成功した候補が${candidates.length}件のみでした (animalId: ${animal.id}, 失敗: ${failed.join("/")})`);
  }

  const selectStart = Date.now();
  const generatedCategories = candidates.map((c) => c.category);
  let result: AgentQuizResult;
  try {
    const response = await getClient().models.generateContent({
      model: QUIZ_AGENT_MODEL,
      contents: buildSelectionPrompt(animal, candidates),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, enum: generatedCategories, description: "選んだ候補のカテゴリ" },
            selectionReason: { type: Type.STRING, description: "なぜこのカテゴリを選んだかの短い理由" },
          },
          required: ["category", "selectionReason"],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? "") as { category: QuizCategory; selectionReason: string };
    result = assembleResult(animal, candidates, parsed.category, parsed.selectionReason, candidateCategories);
  } catch (error) {
    result = fallbackSelection(animal, candidates, candidateCategories, error);
  }
  const selectMs = Date.now() - selectStart;

  return { result, timings: { generateMs, selectMs, failedCount: failed.length } };
}

export async function generateQuizParallel(
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[] = QUIZ_CATEGORIES,
): Promise<AgentQuizResult> {
  return (await generateQuizParallelDetailed(animal, candidateCategories)).result;
}
