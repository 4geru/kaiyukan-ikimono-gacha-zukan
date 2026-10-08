import { GoogleGenAI, Type } from "@google/genai";
import type { KaiyukanAnimal } from "./kaiyukanData.js";
import { DEFAULT_QUIZ_LEVEL, buildLevelGuidance, type QuizLevel } from "./quizLevel.js";
import { withLlmLog } from "./agentRun.js";

// design.md 3章で定義した13カテゴリ。scripts/try-quiz-agent.ts(ADK版)と同じ一覧を維持する。
export const QUIZ_CATEGORIES = [
  "生息地",
  "水域",
  "水温",
  "深度",
  "郷土料理",
  "類似した仲間",
  "同じ水槽にいる魚",
  "特徴",
  "豆知識",
  "進化の歴史",
  "食物連鎖",
  "ダジャレ",
  "海外の小ネタ",
] as const;

export type QuizCategory = (typeof QUIZ_CATEGORIES)[number];

export interface QuizQuestion {
  animalId: string;
  category: QuizCategory;
  question: string;
  choices: string[];
  correctIndex: number;
  speakerPersona?: string;
  level?: QuizLevel;
  generatedBy?: "live-single" | "live-agent" | "pool";
  promptVersion?: string;
}

// プロンプトやレベル定義を変えたら上げる（作り置きの入れ替え判定・評価の比較に使う）
export const QUIZ_PROMPT_VERSION = "829-v1";

const MODEL = "gemini-flash-latest";

const quizResponseSchema = {
  type: Type.OBJECT,
  properties: {
    question: {
      type: Type.STRING,
      description: "指定カテゴリに沿った面白い三択クイズの問題文（言葉づかいは指定のレベルに従う）",
    },
    choices: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      minItems: "3",
      maxItems: "3",
      description: "3つの選択肢。誤答の近さは指定のレベルに従う",
    },
    correctIndex: {
      type: Type.INTEGER,
      description: "choicesの中で正解のインデックス（0始まり）",
    },
  },
  required: ["question", "choices", "correctIndex"],
};

let client: GoogleGenAI | undefined;

export function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("環境変数 GEMINI_API_KEY が設定されていません");
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

// 「類似した仲間」「同じ水槽にいる魚」はGeminiの一般知識に委ねず、実在する種名リストを
// プロンプトに渡してグラウンディングする（実在しない種の捏造を防ぐ、design.md 3.3節）。
function buildCategoryGuidance(category: QuizCategory, groundingNames: string[]): string {
  if (category === "類似した仲間" || category === "同じ水槽にいる魚") {
    if (groundingNames.length === 0) {
      return "このカテゴリで出題できる実在の候補が見つからなかったので、別の切り口（特徴・豆知識など）に寄せた問題にしてください。";
    }
    return `海遊館に実在する次の生き物だけを候補として使ってください（捏造しないこと）: ${groundingNames.join("、")}`;
  }
  if (category === "ダジャレ") {
    return "事実の正確さは問いません。「ジンベエ名誉教授」というキャラクターが話しかけてくる体で、問題文をセリフ調にしてください。";
  }
  return "";
}

interface CategoryBrief {
  // そのカテゴリならではの切り口と、答えの種類
  focus: string;
  // 別カテゴリと被らせないために、そのカテゴリでは扱わないこと
  avoid: string;
}

// カテゴリごとに「何を問うか（答えの種類）」を定義する。単発経路(buildPrompt)とADKエージェント経路
// (quizAgent.tsのbuildInstruction)の両方でこの定義を使う。生き物データの文章が数文しか無くても
// カテゴリごとに尖った問題になるよう、答えの種類が被らない切り口にしている。
export const CATEGORY_BRIEFS: Record<QuizCategory, CategoryBrief> = {
  生息地: {
    focus: "野生でどの地域・国・海域に住んでいるか。答えは地名（例:「〇〇が野生で見られるのは？」）",
    avoid: "水温・水深などの数値、水槽や飼育の話",
  },
  水域: {
    focus: "どんな水の環境に住むか。答えは環境の種類（海水/淡水/汽水、サンゴ礁・外洋・深海・河口・干潟など）",
    avoid: "具体的な地名、水温・水深の数値",
  },
  水温: {
    focus: "どのくらいの水温を好むか。答えは温度（概数の℃）、または冷水/温水/熱帯の別",
    avoid: "水深、地名",
  },
  深度: {
    focus: "どのくらいの深さに住むか。答えは水深の概数（m）、または表層・中層・海底の別",
    avoid: "水温、地名",
  },
  郷土料理: {
    focus: "食べられる料理・食べ方・食べる地域。答えは料理名や食文化（食用でなければ「食べる？食べない？」の意外な事実）",
    avoid: "生態や体の特徴の説明",
  },
  類似した仲間: {
    focus: "実在する近縁種（同じ科）の中から、この生き物の仲間はどれかを選ばせる。答えは生き物の名前",
    avoid: "実在しない種の捏造、名前以外の情報",
  },
  同じ水槽にいる魚: {
    focus: "海遊館の同じ水槽にいる生き物はどれかを選ばせる。答えは生き物の名前",
    avoid: "実在しない種の捏造、名前以外の情報",
  },
  特徴: {
    focus: "体の形・色・模様・器官・体のしくみ。答えは体の部位や見た目の特徴",
    avoid: "住む場所、食べ物、行動",
  },
  豆知識: {
    focus: "「実は…」と驚かれる意外な事実（記録・能力・習性・名前の由来など）。答えは意外な事実",
    avoid: "体の特徴の単なる言い換え",
  },
  進化の歴史: {
    focus: "祖先・化石・いつ頃から存在するか・生きた化石・分類上の由来。答えは時代や祖先",
    avoid: "現在の生態・分布",
  },
  食物連鎖: {
    focus: "何を食べ、何に食べられるか。答えは食べ物や天敵の名前",
    avoid: "体の特徴、住む場所",
  },
  ダジャレ: {
    focus: "名前や特徴を使った言葉遊び。答えは駄洒落のオチ",
    avoid: "事実を問う普通のクイズ",
  },
  海外の小ネタ: {
    focus: "外国での呼び名・扱われ方・文化・海外での話。答えは海外での呼び名や扱い",
    avoid: "日本国内だけの話",
  },
};

// 全カテゴリ共通のルール。カテゴリが違うのに似た問題になるのを防ぐ。
export const COMMON_QUIZ_RULES: readonly string[] = [
  "答えの種類・問いの型・書き出しを、他のカテゴリのクイズと被らせない（同じ形の問いを作らない）",
  "同じ事実（例: 体の大きさ）を複数のカテゴリで使い回さない。カテゴリごとに別の事実を使う",
  "誤答は、正解と同じ種類の答え（温度なら温度、地名なら地名）にし、近さはレベルの指定に従う",
  "使ってよい事実は、生き物の情報・参考資料・確実な一般知識。数値は概数にし、確信が持てない事実は使わない（ダジャレを除く）",
];

// 生き物に紐づくWikipediaの抜粋を、プロンプトに載せる参考資料の節にする（記事が無い種は空文字）。
export function buildReferenceSection(animal: KaiyukanAnimal): string {
  const wiki = animal.wikipedia;
  if (!wiki) return "";
  const langNote = wiki.lang === "en" ? "英語版" : "日本語版";
  return `\n# 参考資料（Wikipedia ${langNote}「${wiki.title}」の抜粋）\n${wiki.extract}\n`;
}

export function buildPrompt(
  animal: KaiyukanAnimal,
  category: QuizCategory,
  groundingNames: string[],
  level: QuizLevel = DEFAULT_QUIZ_LEVEL,
  avoidNames: string[] = [],
): string {
  const brief = CATEGORY_BRIEFS[category];
  return `あなたは水族館の解説員です。以下の生き物について、
「${category}」というカテゴリに沿った面白い三択クイズを1問作ってください。

# 生き物の情報
名前: ${animal.name}（${animal.englishName} / ${animal.scientificName}）
分類: ${animal.classification}（${animal.family}）
説明: ${animal.description}
${buildReferenceSection(animal)}
# このカテゴリの出題方針
- 切り口: ${brief.focus}
- 避けること: ${brief.avoid}
${buildCategoryGuidance(category, groundingNames)}

${buildLevelGuidance(level, category)}
${avoidNames.length > 0 ? `- 誤答に使ってはいけない名前（同じ水槽・同じ科の実在種）: ${avoidNames.join("、")}\n` : ""}
# 出力ルール
- 選択肢は3つ。正解1つと、正解と同じ種類の答えの誤答2つ（近さはレベルの指定に従う）を含めること
- 選択肢の順番はランダムにしてよい
- 使ってよい事実は、生き物の情報・参考資料・確実な一般知識。数値は概数にし、確信が持てない事実は使わないこと（ダジャレを除く）
- 指定されたJSON形式のみで出力すること`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // フォールバック: レスポンステキストからJSON部分（最初の { から最後の } まで）を抜き出す
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("レスポンスからJSONを抽出できませんでした");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function isQuizPayload(
  value: unknown
): value is { question: string; choices: string[]; correctIndex: number } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.question === "string" &&
    Array.isArray(v.choices) &&
    v.choices.length === 3 &&
    v.choices.every((c) => typeof c === "string") &&
    typeof v.correctIndex === "number" &&
    Number.isInteger(v.correctIndex) &&
    v.correctIndex >= 0 &&
    v.correctIndex < 3
  );
}

export async function generateQuizForAnimal(
  animal: KaiyukanAnimal,
  category: QuizCategory,
  groundingNames: string[] = [],
  model: string = MODEL,
  level: QuizLevel = DEFAULT_QUIZ_LEVEL,
  avoidNames: string[] = [],
): Promise<QuizQuestion> {
  const ai = getClient();

  let responseText: string | undefined;
  try {
    const prompt = buildPrompt(animal, category, groundingNames, level, avoidNames);
    const response = await withLlmLog("quiz_retry", model, prompt.length, () =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: quizResponseSchema,
        },
      }),
    );
    responseText = response.text;
  } catch (error) {
    throw new Error(
      `Geminiによるクイズ生成リクエストに失敗しました (animalId: ${animal.id}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!responseText) {
    throw new Error(`Geminiのレスポンスが空でした (animalId: ${animal.id})`);
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(responseText);
  } catch (error) {
    throw new Error(
      `Geminiのレスポンスの解析に失敗しました (animalId: ${animal.id}): ${
        error instanceof Error ? error.message : String(error)
      }\nレスポンス: ${responseText}`
    );
  }

  if (!isQuizPayload(parsed)) {
    throw new Error(
      `Geminiのレスポンスが期待した形式ではありませんでした (animalId: ${animal.id}): ${responseText}`
    );
  }

  return {
    animalId: animal.id,
    category,
    question: parsed.question,
    choices: parsed.choices,
    correctIndex: parsed.correctIndex,
    speakerPersona: category === "ダジャレ" ? "ジンベエ名誉教授" : undefined,
    level,
    generatedBy: "live-single",
    promptVersion: QUIZ_PROMPT_VERSION,
  };
}

// ランダムにカテゴリを選ぶ。excludeCategoryを指定すると、そのカテゴリは除外して選ぶ
// （直前と同じカテゴリを避けたい場合に使う）。
export function pickRandomCategory(excludeCategory?: QuizCategory): QuizCategory {
  const pool = excludeCategory
    ? QUIZ_CATEGORIES.filter((c) => c !== excludeCategory)
    : QUIZ_CATEGORIES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// docs/specs/791-quiz-history: 「その生きものの過去N問とカテゴリが被らない」出題ルールのN。
export const QUIZ_HISTORY_WINDOW = 5;

export interface QuizHistoryEntry {
  category: QuizCategory;
  isCorrect: boolean;
}

export type QuizCategoryPlan =
  | { kind: "retry"; category: QuizCategory } // 不正解の出し直し（正解するまで同じカテゴリ）
  | { kind: "fresh"; candidates: QuizCategory[] }; // 直近の履歴と被らない新しいカテゴリ（常に8件以上）

// recentはaskedAtの新しい順（最大QUIZ_HISTORY_WINDOW件）。取得失敗時は[]を渡せば全カテゴリが候補になる。
export function planQuizCategory(recent: QuizHistoryEntry[]): QuizCategoryPlan {
  const latest = recent[0];
  if (latest && !latest.isCorrect) return { kind: "retry", category: latest.category };

  const excluded = new Set(recent.map((entry) => entry.category));
  return { kind: "fresh", candidates: QUIZ_CATEGORIES.filter((category) => !excluded.has(category)) };
}

// エージェントの出力は、プロンプトやスキーマのenumで候補を絞っても守られるとは限らない
// （GEMINI_APIではoutputSchemaがset_model_responseツールの引数になり、enumは強制も検証もされない）。
// そのためエージェントの返り値を関数で強制する: 選ばれたカテゴリが候補外なら、検討済みの
// 候補内カテゴリから選び直す。候補内の検討結果が1件もなければundefined。
export function pickAllowedCandidate<T extends { category: QuizCategory }>(
  considered: readonly T[],
  selectedCategory: QuizCategory,
  allowed: readonly QuizCategory[],
): T | undefined {
  const inAllowed = considered.filter((candidate) => allowed.includes(candidate.category));
  return (
    inAllowed.find((candidate) => candidate.category === selectedCategory) ??
    inAllowed[Math.floor(Math.random() * inAllowed.length)]
  );
}
