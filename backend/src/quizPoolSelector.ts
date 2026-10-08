import { z } from "zod/v3";
import { Agent, InMemoryRunner, isFinalResponse } from "@google/adk";
import { runAgent, type AgentRunContext } from "./agentRun.js";
import { QUIZ_LEVELS } from "./quizLevel.js";

// 作り置きの選択エージェント（#831 design 5章）。作るのではなく、候補から「この人の今の流れに合う1問」を選ぶだけ。
// 思考なし・出力は id と理由だけ。候補外・形式不正・時間切れ・失敗は規則（rulePickPoolQuestion）で選び、出題は止めない。

export const QUIZ_POOL_SELECTOR_VERSION = "831-selector-v1";
export const POOL_SELECTOR_TIMEOUT_MS = 5000;
const REASON_MAX = 40;

export const QUIZ_POOL_SELECTOR_INSTRUCTION = `あなたは海遊館の LINE クイズの「出題係」です。事前に作ってレビューした問題の候補から、いまの研究員さん（利用者）に出す問題を1つだけ選びます。

# 判断の材料
渡された JSON だけです。書かれていないことを推測しないでください。候補には選択肢と正解は含まれません（選ぶのに要らないため）。

# 選び方の目安
- 直前に外したカテゴリ・直近で続いている切り口は避け、流れに変化をつける
- 全体で外しが続いているなら、公式データに基づく（grounded が true の）分かりやすい切り口を優先する
- 正解が続いているなら、その生きものならではの意外性がある問題を優先する
- ダジャレは続けない

# 出力
JSON のみ。
- id: 選んだ候補の id（候補の一覧にあるものを、そのまま写す）
- reason: 選んだ理由。40字以内。記録用（利用者には見せない）`;

export const poolSelectorOutputSchema = z.object({
  id: z.string().describe("選んだ候補の id（候補の一覧にあるものだけ）"),
  reason: z.string().describe("選んだ理由（記録用、40字以内）"),
});

export interface PoolSelectorCandidate {
  id: string;
  category: string;
  question: string;
  grounded: boolean;
}

export interface PoolSelectorInput {
  animal: { id: string; name: string };
  level: number;
  recentForAnimal: { category: string; isCorrect: boolean }[];
  recentOverall: { category: string; isCorrect: boolean; hintUsed: boolean }[];
  candidates: PoolSelectorCandidate[];
  /** 停止スイッチ `quiz` が入っているか（入っていれば呼ばずに規則） */
  killSwitch?: boolean;
}

export type PoolSelectFallbackCause =
  | "single_candidate"
  | "kill_switch"
  | "candidate_replaced"
  | "schema_invalid"
  | "timeout"
  | "error";

export interface PoolSelection {
  chosenId: string;
  selectedBy: "agent" | "rule";
  reason: string;
  fallbackCause: PoolSelectFallbackCause | null;
  /** 選択エージェント1回の ID（agent_run とつなぐ）。呼ばなかったときは null */
  runId: string | null;
}

export function poolSelectorModel(): string {
  return process.env.QUIZ_POOL_SELECTOR_MODEL ?? "gemini-2.5-flash";
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 規則: 直前と同じカテゴリ・ダジャレの連続を除いた中から一様に1つ。除いて空なら全候補から一様に1つ（純粋関数）
export function rulePickPoolQuestion(
  candidates: readonly PoolSelectorCandidate[],
  recentForAnimal: readonly { category: string }[],
  rand: () => number = Math.random,
): PoolSelectorCandidate {
  if (candidates.length === 0) throw new Error("候補がありません");
  const last = recentForAnimal[0]?.category;
  const filtered = candidates.filter((c) => c.category !== last && !(c.category === "ダジャレ" && last === "ダジャレ"));
  const pool = filtered.length > 0 ? filtered : candidates;
  return pool[Math.floor(rand() * pool.length)];
}

const CAUSE_REASON: Record<PoolSelectFallbackCause, string> = {
  single_candidate: "候補が1件のためそのまま",
  kill_switch: "規則: 停止スイッチのため候補からランダム",
  candidate_replaced: "規則: 候補外の回答のため候補からランダム",
  schema_invalid: "規則: 出力が不正のため候補からランダム",
  timeout: "規則: 時間切れのため候補からランダム",
  error: "規則: 失敗のため候補からランダム",
};

export function buildSelectorPrompt(input: PoolSelectorInput, candidates: readonly PoolSelectorCandidate[]): string {
  const level = input.level >= 1 && input.level <= 5 ? `レベル${input.level} ${QUIZ_LEVELS[input.level as 1 | 2 | 3 | 4 | 5].name}` : `レベル${input.level}`;
  return `# 判断の材料\n${JSON.stringify(
    {
      animal: input.animal.name,
      level,
      recentForAnimal: input.recentForAnimal,
      recentOverall: input.recentOverall,
      candidates: candidates.map((c) => ({ id: c.id, category: c.category, question: c.question, grounded: c.grounded })),
    },
    null,
    2,
  )}`;
}

// ADK の Agent で1回選ばせ、生の出力（JSON 文字列）を返す。AgentRunContext にトークンを足す
export async function runPoolSelectorAgent(prompt: string, ctx: AgentRunContext): Promise<string | undefined> {
  const agent = new Agent({
    name: "quiz_pool_selector",
    model: poolSelectorModel(),
    instruction: QUIZ_POOL_SELECTOR_INSTRUCTION,
    outputSchema: poolSelectorOutputSchema,
    generateContentConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });
  const runner = new InMemoryRunner({ agent });
  let finalText: string | undefined;
  for await (const event of runner.runEphemeral({
    userId: "quiz-pool-selector",
    newMessage: { role: "user", parts: [{ text: prompt }] },
  })) {
    if (!event.author || event.author === "user") continue;
    if (!event.partial) ctx.addUsage(event.usageMetadata);
    if (isFinalResponse(event)) {
      const part = event.content?.parts?.find((p) => "text" in p && p.text);
      if (part && "text" in part && part.text) finalText = part.text;
    }
  }
  return finalText;
}

export interface PoolSelectorDeps {
  /** 評価用: 生の出力（JSON 文字列またはオブジェクト）を返す関数に差し替える */
  selector?: (prompt: string, ctx: AgentRunContext) => Promise<unknown>;
  rand?: () => number;
  timeoutMs?: number;
}

// 例外を投げない。規則で必ず1問返す。
export async function selectPoolQuestion(input: PoolSelectorInput, deps: PoolSelectorDeps = {}): Promise<PoolSelection> {
  const rand = deps.rand ?? Math.random;
  const byRule = (cause: PoolSelectFallbackCause, runId: string | null): PoolSelection => {
    const picked = rulePickPoolQuestion(input.candidates, input.recentForAnimal, rand);
    return { chosenId: picked.id, selectedBy: "rule", reason: CAUSE_REASON[cause].slice(0, REASON_MAX), fallbackCause: cause, runId };
  };

  if (input.candidates.length <= 1) return byRule("single_candidate", null);

  const ids = new Set(input.candidates.map((c) => c.id));
  const shuffledCandidates = shuffled(input.candidates, rand);
  const decisionBase = {
    candidates: input.candidates.map((c) => c.id),
    candidateCategories: input.candidates.map((c) => c.category),
    generatedBy: "pool",
  };
  const model = poolSelectorModel();
  const runOpts = {
    agent: "quiz_pool" as const,
    model,
    promptVersion: QUIZ_POOL_SELECTOR_VERSION,
    timeoutMs: deps.timeoutMs ?? POOL_SELECTOR_TIMEOUT_MS,
    fields: { animalId: input.animal.id, level: input.level },
  };

  // 停止スイッチ `quiz`: 呼ばずに規則。agent_run(outcome=kill_switch) を残す
  if (input.killSwitch) {
    try {
      return await runAgent({ ...runOpts, model: "rule" }, async (ctx) => {
        ctx.setOutcome("kill_switch");
        ctx.guard("kill_switch", "fell_back", "規則の選択に切り替え");
        const sel = byRule("kill_switch", ctx.runId);
        ctx.setDecision({ ...decisionBase, chosen: sel.chosenId, proposed: null, replaced: false, reason: sel.reason });
        ctx.setMessage("停止スイッチのため規則で選びました");
        return sel;
      });
    } catch {
      return byRule("kill_switch", null);
    }
  }

  try {
    return await runAgent(runOpts, async (ctx) => {
      const prompt = buildSelectorPrompt(input, shuffledCandidates);
      const raw = await (deps.selector ?? runPoolSelectorAgent)(prompt, ctx);
      let parsed: z.infer<typeof poolSelectorOutputSchema> | null = null;
      try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        const r = poolSelectorOutputSchema.safeParse(obj);
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed) {
        ctx.setOutcome("fallback_rule");
        ctx.guard("schema_invalid", "fell_back", "選択の出力が不正");
        const sel = byRule("schema_invalid", ctx.runId);
        ctx.setDecision({ ...decisionBase, chosen: sel.chosenId, proposed: null, replaced: false, reason: sel.reason });
        ctx.setMessage("出力が不正のため規則で選びました");
        return sel;
      }
      if (!ids.has(parsed.id)) {
        ctx.setOutcome("fallback_rule");
        ctx.guard("candidate_replaced", "replaced", `候補外: ${parsed.id.slice(0, 40)}`);
        const sel = byRule("candidate_replaced", ctx.runId);
        ctx.setDecision({ ...decisionBase, chosen: sel.chosenId, proposed: parsed.id.slice(0, 40), replaced: true, reason: sel.reason });
        ctx.setMessage("候補外のため規則で選びました");
        return sel;
      }
      const reason = parsed.reason.slice(0, REASON_MAX);
      ctx.setDecision({ ...decisionBase, chosen: parsed.id, proposed: parsed.id, replaced: false, reason });
      const cat = input.candidates.find((c) => c.id === parsed.id)?.category;
      ctx.setMessage(`作り置きの${input.candidates.length}候補から「${cat}」を選びました`);
      return { chosenId: parsed.id, selectedBy: "agent" as const, reason, fallbackCause: null, runId: ctx.runId };
    });
  } catch (error) {
    // runAgent が agent_run(timeout / error) を出したあと。出題は止めず規則で選ぶ
    const failedRunId = (error as { agentRunId?: string }).agentRunId ?? null;
    return byRule(error instanceof Error && error.name === "AgentTimeoutError" ? "timeout" : "error", failedRunId);
  }
}
