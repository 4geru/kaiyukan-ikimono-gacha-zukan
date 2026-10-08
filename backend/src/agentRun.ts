import { randomUUID } from "node:crypto";
import { logEvent, getLogContext, type Severity } from "./log.js";

// #832 エージェント1回ぶんの記録（design 3.2 / 3.3 / 3.8）。
// runAgent が runId を発行し、所要時間を測り、finally で agent_run を必ず1行だけ出す。
// ツールは withToolLog で包んで tool_call を出す。LLM 1回は withLlmLog で llm_call を出す。

export type AgentName = "quiz" | "station" | "quiz_level" | "quiz_pool";
export type AgentOutcome = "ok" | "fallback_rule" | "timeout" | "error" | "rate_limited" | "kill_switch";
export type GuardAction = "replaced" | "fell_back" | "truncated" | "refused" | "skipped";
export type GuardName =
  | "candidate_replaced"
  | "schema_invalid"
  | "timeout"
  | "fallback_rule"
  | "input_truncated"
  | "rate_limited"
  | "kill_switch"
  | "output_sanitized"
  | "tone_broken";

export class AgentTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`エージェント実行がタイムアウトしました (${timeoutMs}ms)`);
    this.name = "AgentTimeoutError";
  }
}

export interface UsageLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

// 取れない場合は null（ログでは "none"）
export function extractUsage(usage: UsageLike | undefined | null): { inputTokens: number | null; outputTokens: number | null } {
  if (!usage) return { inputTokens: null, outputTokens: null };
  const input = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null;
  const hasOutput = typeof usage.candidatesTokenCount === "number" || typeof usage.thoughtsTokenCount === "number";
  const output = hasOutput ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) : null;
  return { inputTokens: input, outputTokens: output };
}

export interface AgentRunRecord {
  runId: string;
  agent: AgentName;
  outcome: AgentOutcome;
  latencyMs: number;
  model: string;
  promptVersion: string;
  toolCalls: number;
  toolOrder: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  decision: Record<string, unknown> | null;
}

export interface AgentRunContext {
  readonly runId: string;
  readonly agent: AgentName;
  /** 呼んだツールの順 */
  readonly toolOrder: readonly string[];
  /** ツール1回を数える（withToolLog が呼ぶ） */
  recordTool(tool: string): void;
  /** コードの介入を guard として記録する（A6） */
  guard(guard: GuardName, action: GuardAction, detail?: string): void;
  /** LLM の使用トークンを足す（ADK のイベントの usageMetadata を渡す） */
  addUsage(usage: UsageLike | undefined | null): void;
  /** 判断の要約（3.3）。agent_run.decision に入る */
  setDecision(decision: Record<string, unknown>): void;
  /** 既定は ok。fallback_rule など例外にならない結果のときに呼ぶ */
  setOutcome(outcome: AgentOutcome): void;
  /** 一覧で読む一文 */
  setMessage(message: string): void;
}

export interface RunAgentOptions {
  agent: AgentName;
  model: string;
  promptVersion: string;
  timeoutMs?: number;
  /** agent_run を出した直後に呼ぶ（Firestore の agentRuns 書き込みなど）。失敗しても本処理に影響しない */
  onFinish?: (record: AgentRunRecord) => void | Promise<void>;
  /** agent_run / guard に足す共通項目（animalId など。個人情報を入れないこと） */
  fields?: Record<string, unknown>;
}

const SEVERITY_BY_OUTCOME: Record<AgentOutcome, Severity> = {
  ok: "INFO",
  fallback_rule: "WARNING",
  timeout: "WARNING",
  rate_limited: "WARNING",
  kill_switch: "WARNING",
  error: "ERROR",
};

export function newRunId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function runAgent<T>(opts: RunAgentOptions, fn: (ctx: AgentRunContext) => Promise<T>): Promise<T> {
  const runId = newRunId();
  const startedAt = Date.now();
  const extra = opts.fields ?? {};
  let finished = false;
  let outcome: AgentOutcome = "ok";
  let message: string | undefined;
  let decision: Record<string, unknown> | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const toolOrder: string[] = [];
  let thrown: unknown;

  const ctx: AgentRunContext = {
    runId,
    agent: opts.agent,
    toolOrder,
    recordTool(tool) {
      if (!finished) toolOrder.push(tool);
    },
    guard(guard, action, detail) {
      logEvent(
        "guard",
        { runId, agent: opts.agent, guard, action, detail: detail ?? null, ...extra, message: `${opts.agent}: ${guard} -> ${action}` },
        "WARNING",
      );
    },
    addUsage(usage) {
      if (finished) return;
      const u = extractUsage(usage);
      if (u.inputTokens !== null) inputTokens = (inputTokens ?? 0) + u.inputTokens;
      if (u.outputTokens !== null) outputTokens = (outputTokens ?? 0) + u.outputTokens;
    },
    setDecision(d) {
      if (!finished) decision = d;
    },
    setOutcome(o) {
      if (!finished) outcome = o;
    },
    setMessage(m) {
      if (!finished) message = m;
    },
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const work = fn(ctx);
    if (opts.timeoutMs) {
      // 時間切れ後に fn が失敗しても未処理の拒否にしない
      work.catch(() => {});
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AgentTimeoutError(opts.timeoutMs as number)), opts.timeoutMs);
      });
      return await Promise.race([work, timeout]);
    }
    return await work;
  } catch (error) {
    thrown = error;
    // 呼び出し側が規則に切り替えるとき、どの agent_run の失敗かをログでつなげられるようにする
    if (error && typeof error === "object") (error as { agentRunId?: string }).agentRunId = runId;
    if (error instanceof AgentTimeoutError) {
      outcome = "timeout";
      ctx.guard("timeout", "fell_back", `${error.timeoutMs}ms`);
    } else {
      outcome = "error";
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    finished = true;
    const record: AgentRunRecord = {
      runId,
      agent: opts.agent,
      outcome,
      latencyMs: Date.now() - startedAt,
      model: opts.model,
      promptVersion: opts.promptVersion,
      toolCalls: toolOrder.length,
      toolOrder,
      inputTokens,
      outputTokens,
      decision,
    };
    logEvent(
      "agent_run",
      {
        ...extra,
        runId,
        agent: opts.agent,
        outcome,
        latencyMs: record.latencyMs,
        model: opts.model,
        promptVersion: opts.promptVersion,
        toolCalls: record.toolCalls,
        inputTokens,
        outputTokens,
        decision,
        message: message ?? `${opts.agent}エージェントが終了しました (${outcome})`,
        ...(thrown !== undefined ? { error: thrown } : {}),
      },
      SEVERITY_BY_OUTCOME[outcome],
    );
    if (opts.onFinish) {
      try {
        await opts.onFinish(record);
      } catch (error) {
        logEvent("agent_run_persist_failed", { runId, agent: opts.agent, error }, "WARNING");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ツール
// ---------------------------------------------------------------------------

function defaultResultCount(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  for (const key of ["aquariums", "matches", "stations"]) {
    if (Array.isArray(r[key])) return (r[key] as unknown[]).length;
  }
  return null;
}

// ツールの execute を包む。引数は個人情報の無い値（logArgs が返すもの）だけをログに出す。
export function withToolLog<A, R>(
  ctx: AgentRunContext | undefined,
  tool: string,
  execute: (args: A) => Promise<R> | R,
  opts: { logArgs?: (args: A) => Record<string, unknown>; resultCount?: (result: R) => number | null } = {},
): (args: A) => Promise<R> {
  return async (args: A) => {
    const startedAt = Date.now();
    ctx?.recordTool(tool);
    const base = {
      runId: ctx?.runId ?? null,
      agent: ctx?.agent ?? null,
      tool,
      args: opts.logArgs ? opts.logArgs(args) : {},
    };
    try {
      const result = await execute(args);
      const hasError = Boolean(result && typeof result === "object" && "error" in (result as object));
      logEvent(
        "tool_call",
        {
          ...base,
          ok: !hasError,
          resultCount: (opts.resultCount ?? defaultResultCount)(result),
          latencyMs: Date.now() - startedAt,
          message: `ツール ${tool} を呼びました`,
        },
        hasError ? "WARNING" : "INFO",
      );
      return result;
    } catch (error) {
      logEvent(
        "tool_call",
        { ...base, ok: false, resultCount: null, latencyMs: Date.now() - startedAt, error, message: `ツール ${tool} が失敗しました` },
        "WARNING",
      );
      throw error;
    }
  };
}

// ---------------------------------------------------------------------------
// エージェント以外の LLM 1回（A7）
// ---------------------------------------------------------------------------

export type LlmPurpose = "intent" | "chat" | "identify" | "quiz_retry" | "hint";

export async function withLlmLog<T extends { usageMetadata?: UsageLike }>(
  purpose: LlmPurpose,
  model: string,
  inputChars: number,
  call: () => Promise<T>,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    const response = await call();
    const usage = extractUsage(response?.usageMetadata);
    logEvent("llm_call", {
      purpose,
      model,
      ok: true,
      latencyMs: Date.now() - startedAt,
      inputChars,
      ...usage,
      ...extra,
      message: `LLM呼び出し (${purpose})`,
    });
    return response;
  } catch (error) {
    logEvent(
      "llm_call",
      {
        purpose,
        model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        inputChars,
        inputTokens: null,
        outputTokens: null,
        ...extra,
        error,
        message: `LLM呼び出しに失敗 (${purpose})`,
      },
      "WARNING",
    );
    throw error;
  }
}

// エージェント外のガード（入口の回数上限・停止スイッチ・入力の切り詰め）
export function logGuard(
  agent: AgentName | "chat" | "identify" | "webhook",
  guard: GuardName,
  action: GuardAction,
  detail?: string,
  extra: Record<string, unknown> = {},
): void {
  logEvent(
    "guard",
    { agent, guard, action, detail: detail ?? null, ...extra, message: `${agent}: ${guard} -> ${action}` },
    "WARNING",
  );
}

// 文脈に userIdHash があるかの確認用（確認スクリプトで使う）
export function currentUserIdHash(): string | undefined {
  return getLogContext().userIdHash;
}
