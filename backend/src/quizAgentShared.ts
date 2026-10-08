import { z } from "zod/v3";
import { findFamilyMateNames, findTankmateNames, type KaiyukanAnimal } from "./kaiyukanData.js";
import { pickAllowedCandidate, type QuizCategory, type QuizQuestion } from "./quiz.js";
import type { AgentQuizCandidate, AgentQuizResult } from "./quizAgent.js";

// 並列方式（quizAgentParallel.ts = 方式B / quizAgentWorkflow.ts = 方式W）の共通部分。
// docs/specs/824-quiz-agent-parallel-refactor/design.md 8章。

// 並列版でも使うモデル。改善前（quizAgent.ts）と揃えるため同じ環境変数・既定値にする。
export const QUIZ_AGENT_MODEL = process.env.QUIZ_AGENT_MODEL ?? "gemini-2.5-flash";

// 成功した候補がこの件数未満なら、選ぶ意味がないので失敗にする。
export const MIN_SUCCESSFUL_CANDIDATES = 2;

export interface QuizAgentTimings {
  // 並列生成フェーズの所要時間（ms）
  generateMs: number;
  // 選ぶ段階の所要時間（ms）
  selectMs: number;
  // 生成に失敗したカテゴリ数
  failedCount: number;
}

export interface DetailedAgentQuizResult {
  result: AgentQuizResult;
  timings: QuizAgentTimings;
}

export function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// LLMを呼ぶ前に、実在する仲間・同じ水槽の生き物をコードで取得する（決定論的）。
// 改善前はfindRelatedSpeciesツールをLLMが呼んでいた。
export async function loadGroundingNames(animal: KaiyukanAnimal): Promise<Record<QuizCategory, string[]>> {
  const [familyMates, tankmates] = await Promise.all([findFamilyMateNames(animal.id), findTankmateNames(animal.id)]);
  return { 類似した仲間: familyMates, 同じ水槽にいる魚: tankmates } as Record<QuizCategory, string[]>;
}

export function groundingFor(grounding: Record<QuizCategory, string[]>, category: QuizCategory): string[] {
  return grounding[category] ?? [];
}

// 公式データ・実在名に基づく事実か。ダジャレはfalse。実在名が0件で別の切り口に寄せたカテゴリもfalse。
export function isGrounded(category: QuizCategory, groundingNames: string[]): boolean {
  if (category === "ダジャレ") return false;
  if ((category === "類似した仲間" || category === "同じ水槽にいる魚") && groundingNames.length === 0) return false;
  return true;
}

export function toCandidate(quiz: QuizQuestion, groundingNames: string[]): AgentQuizCandidate {
  return {
    category: quiz.category,
    groundedInOfficialData: isGrounded(quiz.category, groundingNames),
    question: quiz.question,
    choices: quiz.choices,
    correctIndex: quiz.correctIndex,
    speakerPersona: quiz.speakerPersona,
  };
}

// 選ぶ段階のプロンプト。提示順バイアス対策として、候補の並びは毎回シャッフルする。
export function buildSelectionPrompt(animal: KaiyukanAnimal, candidates: readonly AgentQuizCandidate[]): string {
  const list = shuffle(candidates)
    .map((c, i) => `${i + 1}. カテゴリ「${c.category}」\n   問題: ${c.question}\n   選択肢: ${c.choices.join(" / ")}`)
    .join("\n");
  return `あなたは海遊館の水族館ガイドエージェントです。「${animal.name}」について、次のカテゴリ別の三択クイズ候補が用意されています。
この中から、最も面白い・${animal.name}ならではの1問を選び、選んだカテゴリと理由（短く）を答えてください。

${list}`;
}

export const selectionResponseFields = (categories: readonly [QuizCategory, ...QuizCategory[]]) =>
  z.object({
    category: z.enum(categories).describe("選んだ候補のカテゴリ"),
    selectionReason: z.string().describe("なぜこのカテゴリを選んだかの短い理由"),
  });

// 選ばれたカテゴリを検証し、AgentQuizResultにする。候補外ならpickAllowedCandidateで差し替える。
export function assembleResult(
  animal: KaiyukanAnimal,
  candidates: AgentQuizCandidate[],
  selectedCategory: QuizCategory | undefined,
  selectionReason: string,
  allowed: readonly QuizCategory[],
): AgentQuizResult {
  const selected = pickAllowedCandidate(candidates, selectedCategory as QuizCategory, allowed);
  if (!selected) {
    throw new Error(`検討結果に候補内のカテゴリがありませんでした (animalId: ${animal.id})`);
  }
  const replaced = selectedCategory !== undefined && selected.category !== selectedCategory;
  return {
    quiz: {
      animalId: animal.id,
      category: selected.category,
      question: selected.question,
      choices: selected.choices,
      correctIndex: selected.correctIndex,
      speakerPersona: selected.speakerPersona,
    },
    selectionReason: replaced
      ? `${selectionReason}（選んだ「${selectedCategory}」は候補外・未生成のため、「${selected.category}」に差し替え）`
      : selectionReason,
    consideredCategories: candidates,
  };
}

// 選ぶLLM自体が失敗した場合のフォールバック（ランダム選択）。
export function fallbackSelection(
  animal: KaiyukanAnimal,
  candidates: AgentQuizCandidate[],
  allowed: readonly QuizCategory[],
  cause: unknown,
): AgentQuizResult {
  console.warn(`選ぶ段階が失敗したためランダムに選択します: ${cause instanceof Error ? cause.message : String(cause)}`);
  return assembleResult(animal, candidates, undefined, "自動選択（選ぶ段階の呼び出しに失敗したためランダム）", allowed);
}
