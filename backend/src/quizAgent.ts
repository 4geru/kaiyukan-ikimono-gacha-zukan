import { z } from "zod/v3";
import { Agent, InMemoryRunner, FunctionTool, isFinalResponse } from "@google/adk";
import { loadKaiyukanAnimals, type KaiyukanAnimal } from "./kaiyukanData.js";
import {
  QUIZ_CATEGORIES,
  CATEGORY_BRIEFS,
  COMMON_QUIZ_RULES,
  QUIZ_PROMPT_VERSION,
  buildReferenceSection,
  pickAllowedCandidate,
  type QuizCategory,
  type QuizQuestion,
} from "./quiz.js";
import { DEFAULT_QUIZ_LEVEL, LEVEL_CATEGORY_NOTES, buildLevelGuidance, type QuizLevel } from "./quizLevel.js";
import { runAgent, withToolLog, type AgentRunContext } from "./agentRun.js";

// #832 C6: エージェントがこの時間内に終わらなければ打ち切り、呼び出し側が規則の出題に切り替える
export const QUIZ_AGENT_TIMEOUT_MS = 45_000;

// scripts/try-quiz-agent.ts でローカル検証済みのADKエージェントを、server.tsから呼べる
// モジュールとして切り出したもの。design.md 3章「クイズのエージェント化設計」の実装。
//
// 使い分け（server.ts側の方針）:
// - 直前の回答が不正解で同じカテゴリに再挑戦させたい場合は、このモジュールではなく
//   quiz.ts の generateQuizForAnimal をカテゴリ指定で直接呼ぶ（決定論的・高速）。
// - 新しいカテゴリを選ぶ場面（初回 or 正解後）でこのモジュールを使い、候補全部をエージェントに
//   検討させてから1つを自律的に選ばせる（自律性を見せる場面）。
//   候補（過去5問とカテゴリが被らないもの）は呼び出し元がquiz.tsのplanQuizCategoryで決めて
//   candidateCategories引数に渡す（docs/specs/791-quiz-history）。

export interface AgentQuizCandidate {
  category: QuizCategory;
  groundedInOfficialData: boolean;
  question: string;
  choices: string[];
  correctIndex: number;
  speakerPersona?: string;
}

export interface AgentQuizResult {
  quiz: QuizQuestion;
  selectionReason: string;
  consideredCategories: AgentQuizCandidate[];
  /** この出題をしたエージェント1回のID。ログ（agent_run）と quizHistory をつなぐ */
  runId?: string;
  /** コードが介入した場合の種別（候補外の差し替えなど）。無ければ null */
  guard?: string | null;
}

// 直近の出題と被るカテゴリは呼び出し元で除いた上でここに渡される(availableCategories)。
// プロンプトの自然文指示に頼らず、responseSchemaのenum自体をavailableCategoriesに絞ることで、
// 除外したカテゴリをAIが選びようがない状態にして確実性を担保する。
function buildQuizCandidateSchema(availableCategories: [QuizCategory, ...QuizCategory[]]) {
  return z.object({
    category: z.enum(availableCategories),
    groundedInOfficialData: z
      .boolean()
      .describe("海遊館の公式データ・findRelatedSpeciesツールの結果に基づく事実かどうか。ダジャレは常にfalse"),
    question: z
      .string()
      .describe("このカテゴリで出すとしたら、という前提で作った三択クイズの問題文（ダジャレの場合はジンベエ名誉教授のセリフ調）"),
    choices: z.array(z.string()).length(3),
    correctIndex: z.number().int().min(0).max(2),
    speakerPersona: z.string().optional().describe("ダジャレカテゴリの時のみ「ジンベエ名誉教授」を設定"),
  });
}

// Fableレビュー: 推論(検討した候補)を先に、結論(選んだカテゴリ)を後に出力させる順序が重要
// (ただし実測では宣言順どおりに出力されるとは限らないことが判明済み。
//  docs/2026-09-19-00-15-fable-identify-accuracy-review.md と同種の注意点として、
//  「完成形をすべて作らせる」設計自体が推論の証拠になる、という位置づけで運用する)
function buildQuizOutputSchema(availableCategories: [QuizCategory, ...QuizCategory[]]) {
  const candidateSchema = buildQuizCandidateSchema(availableCategories);
  return z.object({
    consideredCategories: z
      .array(candidateSchema)
      .describe(`${availableCategories.join("、")}のそれぞれについて、実際に出題できる完成形の三択クイズを1問ずつ作って並べたもの`),
    category: z.enum(availableCategories).describe("consideredCategoriesの中から実際に出題するために選んだカテゴリ"),
    selectionReason: z.string().describe("なぜこのカテゴリを選んだかの短い理由"),
  });
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function buildRelatedSpeciesTool(animals: KaiyukanAnimal[], ctx?: AgentRunContext) {
  return new FunctionTool({
    name: "findRelatedSpecies",
    description:
      "海遊館に実在する、指定した生き物と同じ科(family)または同じ展示エリア(mainExhibition)の他の生き物を検索する。「類似した仲間」「同じ水槽にいる魚」カテゴリの内容を、実在しない種を捏造せずに組み立てるために使う。",
    parameters: z.object({
      animalId: z.string().describe("基準となる生き物のID"),
      by: z.enum(["family", "exhibition"]).describe("familyなら同じ科、exhibitionなら同じ展示エリアで検索する"),
    }),
    execute: withToolLog(
      ctx,
      "findRelatedSpecies",
      ({ animalId, by }: { animalId: string; by: "family" | "exhibition" }) => {
        const base = animals.find((a) => a.id === animalId);
        if (!base) return { matches: [] as string[] };
        const matches = animals
          .filter((a) => a.id !== animalId)
          .filter((a) => (by === "family" ? a.family === base.family : a.mainExhibition === base.mainExhibition))
          .slice(0, 8)
          .map((a) => a.name);
        return { matches };
      },
      { logArgs: ({ by }) => ({ by }) },
    ),
  });
}

function buildInstruction(availableCategories: [QuizCategory, ...QuizCategory[]], level: QuizLevel): string {
  // 候補カテゴリそれぞれの切り口（quiz.tsのCATEGORY_BRIEFS）。カテゴリ名だけを渡すと、どのカテゴリも
  // 同じ材料から似た問題になるため、答えの種類まで定義して尖らせる。
  const categoryBriefs = availableCategories
    .map((category) => `- ${category}: ${CATEGORY_BRIEFS[category].focus}（避けること: ${CATEGORY_BRIEFS[category].avoid}）`)
    .join("\n");

  const notes = availableCategories
    .map((category) => {
      const note = LEVEL_CATEGORY_NOTES[level]?.[category];
      return note ? `- ${category}: ${note}` : null;
    })
    .filter((line): line is string => line !== null);
  const levelSection = `${buildLevelGuidance(level)}${notes.length > 0 ? `\n- 各カテゴリの補足:\n${notes.map((n) => `  ${n}`).join("\n")}` : ""}`;

  return `あなたは海遊館の水族館ガイドエージェントです。渡された生き物について、以下のカテゴリそれぞれで、完成形の三択クイズを検討してください。各カテゴリの切り口は次のとおりです:
${categoryBriefs}

${levelSection}

# 共通ルール
${COMMON_QUIZ_RULES.map((rule) => `- ${rule}`).join("\n")}

# 進め方
- 「類似した仲間」「同じ水槽にいる魚」を検討するときは、必ず findRelatedSpecies ツールを呼んで実在する種を確認してから内容を組み立ててください（実在しない生き物を捏造しないでください）。
- 「ダジャレ」カテゴリは事実性を問わないので groundedInOfficialData は常に false にしてください。文体は「ジンベエ名誉教授」というキャラクターが話しかけてくる体で書いてください。
- 上記カテゴリそれぞれについて、一言トリビアではなく、実際に出題できる完成形の三択クイズ（問題文・選択肢3つ・正解）を1問ずつ作ってください。生き物の情報に書かれていなくても、そのカテゴリの分野の確実な一般知識や参考資料の内容で作ってください。確実な事実が思いつかないカテゴリだけ、問いをより一般的な形にしてください。
- すべて作り終えたら、その中から最も面白い・その生き物ならではの1問を選んでください。`;
}

const QUIZ_AGENT_MODEL = process.env.QUIZ_AGENT_MODEL ?? "gemini-2.5-flash";

// エージェント1回を runAgent で包み、agent_run（判断の要約つき）・tool_call・guard を残す（#832 A3〜A6）
export async function generateQuizWithAgent(
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[] = QUIZ_CATEGORIES,
  level: QuizLevel = DEFAULT_QUIZ_LEVEL,
): Promise<AgentQuizResult> {
  return runAgent(
    {
      agent: "quiz",
      model: QUIZ_AGENT_MODEL,
      promptVersion: QUIZ_PROMPT_VERSION,
      timeoutMs: QUIZ_AGENT_TIMEOUT_MS,
      fields: { animalId: animal.id, level },
    },
    (ctx) => runQuizAgent(ctx, animal, candidateCategories, level),
  );
}

async function runQuizAgent(
  ctx: AgentRunContext,
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[],
  level: QuizLevel,
): Promise<AgentQuizResult> {
  const animals = await loadKaiyukanAnimals();

  // 固定順で渡すと提示順バイアスで毎回ほぼ同じカテゴリ(実測ではジンベエザメで5回中4回「ダジャレ」)に
  // 収束したため、候補の並びを毎回シャッフルしてからスキーマ・プロンプトに渡す。
  const availableCategories = shuffle([...candidateCategories]) as [QuizCategory, ...QuizCategory[]];

  const agent = new Agent({
    name: "kaiyukan_quiz_agent",
    model: QUIZ_AGENT_MODEL,
    instruction: buildInstruction(availableCategories, level),
    tools: [buildRelatedSpeciesTool(animals, ctx)],
    outputSchema: buildQuizOutputSchema(availableCategories),
  });

  const runner = new InMemoryRunner({ agent });

  const promptText = `# 生き物の情報
id: ${animal.id}
名前: ${animal.name}（${animal.englishName} / ${animal.scientificName}）
分類: ${animal.classification}（${animal.family}）
展示エリア: ${animal.mainExhibition}
説明: ${animal.description}
${buildReferenceSection(animal)}
この生き物について、指示に従ってクイズを1問作ってください。`;

  let finalText: string | undefined;
  for await (const event of runner.runEphemeral({
    userId: `quiz-agent-${animal.id}`,
    newMessage: { role: "user", parts: [{ text: promptText }] },
  })) {
    if (!event.author || event.author === "user") continue;
    if (!event.partial) ctx.addUsage(event.usageMetadata);
    if (isFinalResponse(event)) {
      const textPart = event.content?.parts?.find((p) => "text" in p && p.text);
      if (textPart && "text" in textPart && textPart.text) {
        finalText = textPart.text;
      }
    }
  }

  if (!finalText) {
    throw new Error(`ADKエージェントからの最終レスポンスが取得できませんでした (animalId: ${animal.id})`);
  }

  let parsed: {
    consideredCategories: AgentQuizCandidate[];
    category: QuizCategory;
    selectionReason: string;
  };
  try {
    parsed = JSON.parse(finalText);
    if (!Array.isArray(parsed.consideredCategories) || typeof parsed.category !== "string") throw new Error("shape");
  } catch {
    ctx.guard("schema_invalid", "fell_back", "出力がJSONの形式ではありません");
    throw new Error(`ADKエージェントの出力を読み取れませんでした (animalId: ${animal.id})`);
  }

  // 候補の絞り込みはスキーマ・プロンプトだけに頼らず、返り値をここで関数的に強制する
  // （候補外のカテゴリは出題しない。docs/specs/791-quiz-history）。
  const selected = pickAllowedCandidate(parsed.consideredCategories, parsed.category, availableCategories);
  if (!selected) {
    ctx.guard("schema_invalid", "fell_back", "候補内のカテゴリがありません");
    throw new Error(
      `検討結果に候補内のカテゴリがありませんでした (animalId: ${animal.id}, 選択: ${parsed.category}, 候補: ${availableCategories.join("/")})`,
    );
  }
  const replaced = selected.category !== parsed.category;
  if (replaced) ctx.guard("candidate_replaced", "replaced", `${parsed.category} -> ${selected.category}`);

  ctx.setDecision({
    candidates: availableCategories,
    chosen: selected.category,
    proposed: parsed.category,
    replaced,
    reason: parsed.selectionReason,
    groundedCount: parsed.consideredCategories.filter((c) => c.groundedInOfficialData).length,
    generatedBy: "live-agent",
  });
  ctx.setMessage(`クイズのエージェントが${availableCategories.length}候補から「${selected.category}」を選びました`);

  return {
    quiz: {
      animalId: animal.id,
      category: selected.category,
      question: selected.question,
      choices: selected.choices,
      correctIndex: selected.correctIndex,
      speakerPersona: selected.speakerPersona,
      level,
      generatedBy: "live-agent",
      promptVersion: QUIZ_PROMPT_VERSION,
    },
    selectionReason: replaced
      ? `${parsed.selectionReason}（選んだ「${parsed.category}」は候補外のため、「${selected.category}」に差し替え）`
      : parsed.selectionReason,
    consideredCategories: parsed.consideredCategories,
    runId: ctx.runId,
    guard: replaced ? "candidate_replaced" : null,
  };
}

// quizHistory に残す「検討した候補」。選ばれなかった候補の選択肢と正解番号は残さない（#832 B2:
// 作り置き(#831)で後から出題され得るため）。選んだ問題の選択肢・正解は quizHistory 本体に既にある。
export interface HistoryCandidate {
  category: string;
  question: string;
  grounded: boolean;
}

export function toHistoryCandidates(considered: readonly AgentQuizCandidate[] | null | undefined): HistoryCandidate[] | null {
  if (!Array.isArray(considered) || considered.length === 0) return null;
  return considered.map((c) => ({
    category: String(c.category),
    question: String(c.question ?? ""),
    grounded: Boolean(c.groundedInOfficialData),
  }));
}
