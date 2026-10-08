import type { KaiyukanAnimal } from "./kaiyukanData.js";
import type { QuizQuestion } from "./quiz.js";
import { Type } from "@google/genai";
import { getClient } from "./quiz.js";
import type { QuizLevel } from "./quizLevel.js";
import { withLlmLog } from "./agentRun.js";
import { logEvent } from "./log.js";

// ヒント生成と正解漏れの検査（#829 design 7章）。

export type HintRejectReason = "contains_answer" | "reveals_other" | "too_long" | "empty" | "timeout" | "error";
export interface QuizHintResult {
  hint: string;
  hintSource: "llm" | "fallback"; // "pool" は #831 用に予約
  hintRejectReason: HintRejectReason | null;
  explanation: string | null;
  latencyMs: number;
}

export const FALLBACK_HINT = "ふむ、ひとつ消しておいたぞい。残りの2つから、よーく考えてみるのじゃ。";
export const FALLBACK_HINT_LEVEL1 = "ふむ、ひとつ けしておいたぞい。のこりの ふたつから えらんでみるのじゃ。";

export function fallbackHint(level: QuizLevel): string {
  return level === 1 ? FALLBACK_HINT_LEVEL1 : FALLBACK_HINT;
}

const HINT_MODEL = "gemini-2.5-flash";
const HINT_TIMEOUT_MS = 6000;
const HINT_MAX_CHARS = 80;

const DIGIT_KANJI: Record<string, number> = {
  "〇": 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

// 「十二」→12、「二十五」→25、「百」→100、「三千」→3000 程度の簡易変換
function kanjiNumeralToNumber(run: string): number {
  let total = 0;
  let current = 0;
  let digits = "";
  for (const ch of run) {
    if (ch in DIGIT_KANJI) {
      current = DIGIT_KANJI[ch];
      digits += String(current);
    } else {
      const unit = ch === "十" ? 10 : ch === "百" ? 100 : 1000;
      total += (current || 1) * unit;
      current = 0;
      digits = "";
    }
  }
  return total + current;
}

function kanjiNumeralsToDigits(s: string): string {
  return s.replace(/[〇一二三四五六七八九十百千]+/g, (run) =>
    /^[〇一二三四五六七八九]+$/.test(run) && run.length > 1
      ? run.split("").map((c) => String(DIGIT_KANJI[c])).join("") // 「二〇」のような桁並び
      : String(kanjiNumeralToNumber(run)),
  );
}

// 記号除去の前段まで（数字の抽出に小数点が要るため分けてある）
function normalizeStage1(s: string): string {
  const lowered = s.normalize("NFKC").toLowerCase();
  const hira = lowered.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return kanjiNumeralsToDigits(hira);
}

const STRIP_RE = /[\s「」『』()（）［］\[\]{}・、。,.!?！？〜~…ー－\-―—:;：；"'’‘”“]/g;

export function normalizeForCheck(s: string): string {
  return normalizeStage1(s).replace(STRIP_RE, "");
}

// 選択肢から検査する語を作る（正規化後の文字列の集合）
function tokensOf(choice: string): Set<string> {
  const tokens = new Set<string>();
  const add = (t: string) => {
    const n = normalizeForCheck(t);
    if (n) tokens.add(n);
  };
  add(choice);
  // 「頭の先（正面）」→「頭の先」と「正面」も別々に検査する
  add(choice.replace(/[（(][^）)]*[）)]/g, ""));
  for (const m of choice.matchAll(/[（(]([^）)]+)[）)]/g)) add(m[1]);
  for (const m of normalizeStage1(choice).matchAll(/\d+(?:\.\d+)?/g)) add(m[0]);
  for (const m of choice.normalize("NFKC").matchAll(/[ァ-ヺー]{3,}/g)) add(m[0]);
  for (const m of choice.normalize("NFKC").matchAll(/[一-鿿々]{2,}/g)) add(m[0]);
  return tokens;
}

export function checkHint(
  hint: string,
  quiz: Pick<QuizQuestion, "question" | "choices" | "correctIndex">,
  eliminatedIndex: number,
): HintRejectReason | null {
  const normHint = normalizeForCheck(hint);
  if (!normHint) return "empty";

  const normQuestion = normalizeForCheck(quiz.question);
  const correct = quiz.choices[quiz.correctIndex] ?? "";
  const others = quiz.choices.filter((_c, i) => i !== quiz.correctIndex && i !== eliminatedIndex);
  const normCorrect = normalizeForCheck(correct);
  const normOthers = others.map(normalizeForCheck);

  const usable = (t: string, opposite: string[]) =>
    !normQuestion.includes(t) && !opposite.some((o) => o.includes(t));

  const correctTokens = [...tokensOf(correct)].filter((t) => usable(t, normOthers));
  if (correctTokens.some((t) => normHint.includes(t))) return "contains_answer";

  const otherTokens = others.flatMap((o) => [...tokensOf(o)]).filter((t) => usable(t, [normCorrect]));
  if (otherTokens.some((t) => normHint.includes(t))) return "reveals_other";

  if (hint.normalize("NFKC").length > HINT_MAX_CHARS) return "too_long";
  return null;
}

// design 7.3
const LEVEL_STYLE: Record<QuizLevel, { style: string; maxChars: number }> = {
  1: { style: "ひらがなとカタカナだけで書く。「よーく みてごらん」のような観察の声かけにする", maxChars: 30 },
  2: { style: "やさしい言葉で、身近なものにたとえる", maxChars: 40 },
  3: { style: "理由をひとこと添える", maxChars: 60 },
  4: { style: "比べたり、「なぜ」を考えさせたりする", maxChars: 60 },
  5: { style: "分類・器官・近縁種の違いに注目させる", maxChars: 60 },
};

const CHOICE_LABELS = ["A", "B", "C"];

function buildHintPrompt(animal: KaiyukanAnimal, quiz: QuizQuestion, eliminatedIndex: number, level: QuizLevel): string {
  const { style, maxChars } = LEVEL_STYLE[level];
  const choiceLines = quiz.choices.map((c, i) => `${CHOICE_LABELS[i] ?? i + 1}. ${c}`).join(" / ");
  const remaining = quiz.choices.filter((_c, i) => i !== quiz.correctIndex && i !== eliminatedIndex).join(" / ");
  return `あなたは海遊館の「ジンベエ名誉教授」（ジンベエザメの名誉教授）です。クイズで研究員さんが答えを外したので、もう一度考えるための「ヒント」と、答えを発表するときに使う「解説」を作ります。

# 話し方
一人称は「ワシ」。語尾は「〜じゃ」「〜のう」「〜ぞい」。やさしく、楽しそうに。
${style}。

# 問題
カテゴリ: ${quiz.category}
問題文: ${quiz.question}
選択肢: ${choiceLines}
正解: ${quiz.choices[quiz.correctIndex]}
研究員さんが選んだ答え（画面から消す）: ${quiz.choices[eliminatedIndex]}
残るもう1つの選択肢: ${remaining}

# 生きもの
名前: ${animal.name}（${animal.family ?? ""}）
説明: ${animal.description ?? ""}

# ヒント（hint）のルール
- 1〜2文。${maxChars}字以内
- 正解の言葉を書かない。言い換え・一部・読みだけを変えたものも書かない
- 残るもう1つの選択肢の言葉を書かない。「〇〇ではない」とも言わない（答えが1つに決まってしまうため）
- 選んだ答えがなぜ違うか、または正解に近づくために注目するところを、1つだけ言う
- ダジャレのときは、言葉のどこ（音・名前の一部）に注目するとよいかを言う
- 「よく考えるのじゃ」だけのような、中身のないヒントにしない

# 解説（explanation）のルール
- 正解とその理由を1文、60字以内。答えを発表したあとに使うので、正解を書いてよい
- 生きものの説明か確実な一般知識だけを使う（ダジャレはオチの意味を説明する）

JSON のみで出力する。`;
}

const hintResponseSchema = {
  type: Type.OBJECT,
  properties: {
    hint: { type: Type.STRING, description: "再挑戦のためのヒント（答えを書かない）" },
    explanation: { type: Type.STRING, description: "答え発表時の解説（60字以内）" },
  },
  required: ["hint", "explanation"],
};

async function callGemini(prompt: string): Promise<{ hint: string; explanation: string }> {
  const response = await withLlmLog("hint", HINT_MODEL, prompt.length, () =>
    getClient().models.generateContent({
      model: HINT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: hintResponseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  );
  const parsed = JSON.parse(response.text ?? "") as { hint?: unknown; explanation?: unknown };
  return {
    hint: typeof parsed.hint === "string" ? parsed.hint.trim() : "",
    explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
  };
}

// 例外を投げない（6秒）
export async function generateQuizHint(
  animal: KaiyukanAnimal,
  quiz: QuizQuestion,
  eliminatedIndex: number,
  level: QuizLevel,
): Promise<QuizHintResult> {
  const startedAt = Date.now();
  let result: QuizHintResult;
  let rawHint = "";
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("hint_timeout")), HINT_TIMEOUT_MS);
    });
    const out = await Promise.race([callGemini(buildHintPrompt(animal, quiz, eliminatedIndex, level)), timeout]).finally(
      () => clearTimeout(timer),
    );
    rawHint = out.hint;
    const explanation = out.explanation || null;
    const reject = checkHint(out.hint, quiz, eliminatedIndex);
    result = reject
      ? { hint: fallbackHint(level), hintSource: "fallback", hintRejectReason: reject, explanation, latencyMs: 0 }
      : { hint: out.hint, hintSource: "llm", hintRejectReason: null, explanation, latencyMs: 0 };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message === "hint_timeout";
    result = {
      hint: fallbackHint(level),
      hintSource: "fallback",
      hintRejectReason: isTimeout ? "timeout" : "error",
      explanation: null,
      latencyMs: 0,
    };
  }
  result.latencyMs = Date.now() - startedAt;
  logEvent("quiz_hint", {
    level,
    hintSource: result.hintSource,
    hintRejectReason: result.hintRejectReason,
    hint: rawHint || result.hint,
    latencyMs: result.latencyMs,
  });
  return result;
}
