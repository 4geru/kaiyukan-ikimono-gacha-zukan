import { z } from "zod/v3";
import { Agent, FunctionNode, InMemoryRunner, JoinNode, Workflow } from "@google/adk";
import type { KaiyukanAnimal } from "./kaiyukanData.js";
import { QUIZ_CATEGORIES, buildPrompt, type QuizCategory, type QuizQuestion } from "./quiz.js";
import type { AgentQuizCandidate, AgentQuizResult } from "./quizAgent.js";
import {
  MIN_SUCCESSFUL_CANDIDATES,
  QUIZ_AGENT_MODEL,
  assembleResult,
  buildSelectionPrompt,
  fallbackSelection,
  groundingFor,
  loadGroundingNames,
  selectionResponseFields,
  toCandidate,
  type DetailedAgentQuizResult,
} from "./quizAgentShared.js";

// 方式W: ADK 2.1.0 の Workflow で同じ構成を組む（ParallelAgent は @deprecated で Workflow が後継）。
//   prepare → gen_<カテゴリ>（LlmAgent、候補数ぶん・並列）→ join → build_selection → select（LlmAgent）→ finalize
// グラフは呼び出しごとに候補数ぶんのノードで組み立てる。docs/specs/824-quiz-agent-parallel-refactor/design.md 8章。

const quizOutputSchema = z.object({
  question: z.string().describe("小学生にも分かる言葉で書かれた、指定カテゴリに沿った面白い三択クイズの問題文"),
  choices: z.array(z.string()).length(3).describe("3つの選択肢。もっともらしい誤答を含む"),
  correctIndex: z.number().int().min(0).max(2).describe("choicesの中で正解のインデックス（0始まり）"),
});

const GEN_PREFIX = "gen_";

export async function generateQuizWorkflowDetailed(
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[] = QUIZ_CATEGORIES,
): Promise<DetailedAgentQuizResult> {
  const grounding = await loadGroundingNames(animal);
  const categories = candidateCategories as readonly [QuizCategory, ...QuizCategory[]];

  const marks: { genStart?: number; joinDone?: number; selectDone?: number } = {};
  let result: AgentQuizResult | undefined;
  let failedCount = 0;

  const prepare = new FunctionNode("prepare", () => {
    marks.genStart = Date.now();
    return "指示に従って、クイズを1問作ってください。";
  });

  // instruction は関数で渡す（文字列だと {…} がセッション状態の置換として解釈される可能性を避けるため。この挙動自体は未検証）。
  const genNodes = categories.map(
    (category) =>
      new Agent({
        name: `${GEN_PREFIX}${category}`,
        model: QUIZ_AGENT_MODEL,
        instruction: () => buildPrompt(animal, category, groundingFor(grounding, category)),
        outputSchema: quizOutputSchema,
      }),
  );

  const join = new JoinNode({ name: "join" });

  const buildSelection = new FunctionNode("build_selection", (_ctx, input) => {
    marks.joinDone = Date.now();
    const outputs = input as Record<string, unknown>;
    const candidates: AgentQuizCandidate[] = [];
    for (const category of categories) {
      const raw = outputs[`${GEN_PREFIX}${category}`];
      const quiz = parseQuiz(raw, animal, category);
      if (quiz) candidates.push(toCandidate(quiz, groundingFor(grounding, category)));
      else failedCount++;
    }
    if (candidates.length < MIN_SUCCESSFUL_CANDIDATES) {
      throw new Error(`生成に成功した候補が${candidates.length}件のみでした (animalId: ${animal.id})`);
    }
    candidatesHolder.list = candidates;
    return buildSelectionPrompt(animal, candidates);
  });
  const candidatesHolder: { list: AgentQuizCandidate[] } = { list: [] };

  const select = new Agent({
    name: "select",
    model: QUIZ_AGENT_MODEL,
    instruction: () => "あなたは海遊館の水族館ガイドエージェントです。渡された候補から1問を選び、カテゴリと理由を答えてください。",
    outputSchema: selectionResponseFields(categories),
  });

  const finalize = new FunctionNode("finalize", (_ctx, input) => {
    marks.selectDone = Date.now();
    const parsed = parseJson(input) as { category?: QuizCategory; selectionReason?: string } | undefined;
    result = parsed?.category
      ? assembleResult(animal, candidatesHolder.list, parsed.category, parsed.selectionReason ?? "", candidateCategories)
      : fallbackSelection(animal, candidatesHolder.list, candidateCategories, "選ぶ段階の出力を解釈できませんでした");
    return "done";
  });

  const workflow = new Workflow({
    name: "kaiyukan_quiz_workflow",
    edges: [
      ["START", prepare],
      ...genNodes.map((gen) => [prepare, gen, join] as const).map((chain) => [...chain]),
      [join, buildSelection, select, finalize],
    ],
  });

  const runner = new InMemoryRunner({ agent: workflow });
  for await (const _event of runner.runEphemeral({
    userId: `quiz-workflow-${animal.id}`,
    newMessage: { role: "user", parts: [{ text: `${animal.name}のクイズを作って` }] },
  })) {
    // イベントは読み捨てる。結果は finalize ノードが closure に書く。
  }

  if (!result) {
    throw new Error(`Workflowから結果が取得できませんでした (animalId: ${animal.id})`);
  }
  const genStart = marks.genStart ?? 0;
  const joinDone = marks.joinDone ?? genStart;
  const selectDone = marks.selectDone ?? joinDone;
  return {
    result,
    timings: { generateMs: joinDone - genStart, selectMs: selectDone - joinDone, failedCount },
  };
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseQuiz(raw: unknown, animal: KaiyukanAnimal, category: QuizCategory): QuizQuestion | undefined {
  const parsed = quizOutputSchema.safeParse(parseJson(raw));
  if (!parsed.success) return undefined;
  return {
    animalId: animal.id,
    category,
    question: parsed.data.question,
    choices: parsed.data.choices,
    correctIndex: parsed.data.correctIndex,
    speakerPersona: category === "ダジャレ" ? "ジンベエ名誉教授" : undefined,
  };
}

export async function generateQuizWorkflow(
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[] = QUIZ_CATEGORIES,
): Promise<AgentQuizResult> {
  return (await generateQuizWorkflowDetailed(animal, candidateCategories)).result;
}
