import { z } from "zod/v3";
import { Agent, InMemoryRunner, isFinalResponse } from "@google/adk";
import {
  applyLevelGuards,
  buildCoachInput,
  clampLevel,
  ruleLevel,
  shouldKeepLevel,
  type LevelCoachInput,
  type LevelDecision,
  type LevelFallbackCause,
  type QuizProfile,
} from "./quizLevel.js";

// 難易度コーチ（#829 design 6章）。エージェントに任せるのは「解釈」だけ。
// 数える・範囲に収める・根拠のない動きを止める は quizLevel.ts（コード）が行う。

export const QUIZ_LEVEL_COACH_VERSION = "829-coach-v1";
const COACH_TIMEOUT_MS = 8000;
const REASON_MAX = 40;

export const QUIZ_LEVEL_COACH_INSTRUCTION = `あなたは海遊館の LINE クイズの「難易度コーチ」です。研究員さん（利用者）の直近の回答の記録を見て、次の1問のレベルを決めます。

# レベル（1〜5）
1 ちびっこ: 見てわかること。ひらがな中心。誤答ははっきり違う
2 みならい研究員: 公式の説明にある基本。誤答は違いがわかりやすい
3 研究員: 広く知られた一般常識。誤答はもっともらしい
4 ベテラン研究員: 理由・比較・しくみ。誤答は近い
5 お魚博士: 分類・近縁種・細かい数値。誤答はごく近い

# 目的
正解し続けて退屈にも、外し続けて嫌にもならない「ちょうどよい手応え」を保つこと（目安: ヒントなしで6〜8割正解できるレベル）。

# 判断のしかた
- 根拠は、渡された学習状況の JSON だけ。書かれていないことを推測しない
- 動かすのは1回に1段まで（上げる・据え置き・下げる）
- 上げる目安: 今のレベルで、ヒントなしの正解が続いている
- 下げる目安: 最終的に外した、またはヒントを使ってやっと正解する問題が続いている
- 直近でヒント付き正解が複数あり、ヒントなし正解の連続が0なら、据え置きより下げを優先する
- 次のときは、目安どおりに動かさなくてよい（理由に書く）
  - 外したのが「ダジャレ」だけ（言葉遊びは知識の深さと関係が薄い）
  - 上げ下げを繰り返している（oscillating）。今のレベルで落ち着かせる
  - 前回の回答から何日も空いている。いきなり上げない
  - 今のレベルで解いた問題がまだ少ない。様子を見る
- ruleSuggestion は機械的な目安。状況に合っていればそのまま採用し、合っていなければ変えてよい
- 迷ったら据え置き

# 出力
JSON のみ。
- level: 次のレベル（整数）
- reason: 理由。40字以内。記録用（利用者には見せない）
- basis: 判断の根拠にしたものを、決められたラベルから1〜3個`;

export const COACH_BASIS: readonly string[] = [
  "no_hint_streak", // ヒントなし正解の連続
  "wrong", // 最終不正解
  "hint_reliance", // ヒント頼みの正解が続く
  "pun_only_miss", // 外したのはダジャレだけ
  "oscillation", // 上げ下げの繰り返し
  "time_gap", // 久しぶり
  "few_answers", // 今のレベルの回答が少ない
  "at_bound", // 上限・下限
  "rule_agreed", // 規則の案に同意
];

const levelCoachOutputSchema = z.object({
  level: z.number().int().describe("次の問題のレベル（1〜5）。今のレベルから最大1段だけ動かす"),
  reason: z.string().describe("そのレベルにした理由（記録用、40字以内）"),
  basis: z.array(z.string()).describe(`判断の根拠のラベル（1〜3個）。次のいずれか: ${COACH_BASIS.join("、")}`),
});

type CoachOutput = { level: number; reason: string; basis: string[] };

function coachModel(): string {
  return process.env.QUIZ_LEVEL_MODEL ?? "gemini-2.5-flash";
}

class CoachTimeoutError extends Error {}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CoachTimeoutError(`難易度コーチがタイムアウトしました (${ms}ms)`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// 8秒で reject
export async function runLevelCoach(input: LevelCoachInput): Promise<CoachOutput> {
  const agent = new Agent({
    name: "quiz_level_coach",
    model: coachModel(),
    instruction: QUIZ_LEVEL_COACH_INSTRUCTION,
    outputSchema: levelCoachOutputSchema,
    generateContentConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });
  const runner = new InMemoryRunner({ agent });

  const run = (async () => {
    let finalText: string | undefined;
    for await (const event of runner.runEphemeral({
      userId: "quiz-level-coach",
      newMessage: { role: "user", parts: [{ text: `# 学習状況\n${JSON.stringify(input, null, 2)}` }] },
    })) {
      if (!event.author || event.author === "user") continue;
      if (isFinalResponse(event)) {
        const part = event.content?.parts?.find((p) => "text" in p && p.text);
        if (part && "text" in part && part.text) finalText = part.text;
      }
    }
    return finalText;
  })();

  const finalText = await raceTimeout(run, COACH_TIMEOUT_MS);
  if (!finalText) throw new Error("難易度コーチの最終レスポンスが空でした");
  const parsed = levelCoachOutputSchema.parse(JSON.parse(finalText));
  return {
    level: parsed.level,
    reason: parsed.reason.slice(0, REASON_MAX),
    basis: parsed.basis.filter((b) => COACH_BASIS.includes(b)).slice(0, 3),
  };
}

// 例外を投げない。エージェントが失敗・不正でも規則で決めて出題を止めない。
export async function decideQuizLevel(
  profile: QuizProfile,
  deps?: {
    now?: Date;
    coach?: (input: LevelCoachInput) => Promise<CoachOutput>;
    timeoutMs?: number; // テスト用（既定 8秒）
  },
): Promise<LevelDecision> {
  const from = profile.level;
  const base = {
    from,
    answeredCountAtDecision: profile.answeredCount,
    promptVersion: QUIZ_LEVEL_COACH_VERSION,
  };
  const direction = (to: number): "up" | "keep" | "down" => (to > from ? "up" : to < from ? "down" : "keep");

  try {
    if (shouldKeepLevel(profile)) {
      return {
        ...base, to: from, direction: "keep", reason: "新しい回答がないので据え置き",
        decidedBy: "rule", fallbackCause: "no_new_answers", proposed: null, clamped: false, guard: null,
        basis: [], ruleTo: from, latencyMs: 0, model: null,
      };
    }

    const startedAt = Date.now();
    const input = buildCoachInput(profile, deps?.now ?? new Date());
    const rule = ruleLevel(profile);
    const elapsed = () => Date.now() - startedAt;
    const fallback = (cause: Exclude<LevelFallbackCause, null | "no_new_answers">): LevelDecision => ({
      ...base, to: rule.to, direction: direction(rule.to), reason: rule.reason,
      decidedBy: "rule", fallbackCause: cause, proposed: null, clamped: false, guard: null,
      basis: [], ruleTo: rule.to, latencyMs: elapsed(), model: coachModel(),
    });

    let out: CoachOutput;
    try {
      out = await raceTimeout((deps?.coach ?? runLevelCoach)(input), deps?.timeoutMs ?? COACH_TIMEOUT_MS);
    } catch (e) {
      return fallback(e instanceof CoachTimeoutError ? "timeout" : "error");
    }
    if (!out || typeof out.level !== "number" || !Number.isFinite(out.level)) return fallback("invalid_output");

    const clamped = clampLevel(from, out.level);
    const guarded = applyLevelGuards(input, clamped.to);
    const guard = guarded.guard ?? (clamped.clamped ? "clamp" : null);
    const reasonBase = String(out.reason ?? "").slice(0, REASON_MAX);
    return {
      ...base,
      to: guarded.to,
      direction: direction(guarded.to),
      reason: guard ? `${reasonBase}（ガード: ${guard}）` : reasonBase,
      decidedBy: "agent",
      fallbackCause: null,
      proposed: out.level,
      clamped: clamped.clamped,
      guard,
      basis: Array.isArray(out.basis) ? out.basis.filter((b) => COACH_BASIS.includes(b)).slice(0, 3) : [],
      ruleTo: rule.to,
      latencyMs: elapsed(),
      model: coachModel(),
    };
  } catch {
    return {
      ...base, to: from, direction: "keep", reason: "判定中に想定外のエラー。据え置き",
      decidedBy: "rule", fallbackCause: "error", proposed: null, clamped: false, guard: null,
      basis: [], ruleTo: from, latencyMs: 0, model: null,
    };
  }
}
