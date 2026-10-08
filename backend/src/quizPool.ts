import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v3";
import { QUIZ_CATEGORIES, type QuizCategory, type QuizCategoryPlan } from "./quiz.js";
import { LEVEL_EXCLUDED_CATEGORIES, type QuizLevel } from "./quizLevel.js";
import type { AgentQuizCandidate } from "./quizAgent.js";
import { logEvent } from "./log.js";

// #831 クイズの作り置き（design 3・4章）。レビュー済みの JSONL（コンテナ同梱）を読み、
// 「生きもの × カテゴリ × レベル」のマスで問題を引く。引き方は純粋関数（Firestore・LLM なし）。

export const QUIZ_POOL_VERSION = "831-pool-v1"; // 作問ルール（pool-format.md）を変えて作り直したら上げる

export const poolLineSchema = z.object({
  id: z.string(),
  animalId: z.string(),
  category: z.enum(QUIZ_CATEGORIES),
  level: z.number().int().min(1).max(5),
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).length(3),
  correctIndex: z.number().int().min(0).max(2),
  explanation: z.string(),
  factSource: z.enum(["official", "wikipedia", "general", "none"]),
  groundingNames: z.array(z.string()),
  generatedBy: z.string(),
  generatedAt: z.string(),
  poolVersion: z.string().optional(),
  review: z.object({
    status: z.enum(["approved", "rejected", "pending"]),
    reviewer: z.string().optional(),
    issues: z.array(z.string()).optional(),
    reviewedAt: z.string().optional(),
  }),
});

export type PoolQuestion = Omit<z.infer<typeof poolLineSchema>, "category" | "level"> & {
  category: QuizCategory;
  level: QuizLevel;
};

export interface QuizPoolStats {
  files: number;
  approved: number;
  rejected: number;
  pending: number;
  invalid: number;
  animals: number;
}

export interface QuizPool {
  /** animalId -> "category|level" -> 問題 */
  index: Map<string, Map<string, PoolQuestion>>;
  stats: QuizPoolStats;
}

export const EMPTY_QUIZ_POOL: QuizPool = {
  index: new Map(),
  stats: { files: 0, approved: 0, rejected: 0, pending: 0, invalid: 0, animals: 0 },
};

export const cellKey = (category: QuizCategory, level: QuizLevel): string => `${category}|${level}`;

const DEFAULT_POOL_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data/quiz-pool");

// 1行を検査する。使える問題なら { question }、使わない行なら { skip: 理由 }（rejected / pending は理由を status で返す）
export function parsePoolLine(raw: unknown): { question: PoolQuestion } | { skip: "rejected" | "pending" | "invalid"; detail?: string } {
  const parsed = poolLineSchema.safeParse(raw);
  if (!parsed.success) return { skip: "invalid", detail: parsed.error.issues[0]?.message ?? "schema" };
  const line = parsed.data;
  if (line.review.status !== "approved") return { skip: line.review.status };
  const level = line.level as QuizLevel;
  if (new Set(line.choices).size !== 3) return { skip: "invalid", detail: "choices_duplicated" };
  if (line.id !== `${line.animalId}-${line.category}-${line.level}`) return { skip: "invalid", detail: "id_mismatch" };
  if (LEVEL_EXCLUDED_CATEGORIES[level].includes(line.category)) return { skip: "invalid", detail: "excluded_category_for_level" };
  return { question: { ...line, level } };
}

// ディレクトリの *.jsonl をすべて読む。読めなければ空のプール（出題は今のその場生成で続く）
export async function loadQuizPool(dir: string = DEFAULT_POOL_DIR): Promise<QuizPool> {
  const startedAt = Date.now();
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort();
    const index = new Map<string, Map<string, PoolQuestion>>();
    const stats: QuizPoolStats = { files: names.length, approved: 0, rejected: 0, pending: 0, invalid: 0, animals: 0 };
    for (const name of names) {
      const text = await readFile(join(dir, name), "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(lines[i]);
        } catch {
          stats.invalid++;
          logEvent("quiz_pool_invalid", { file: name, line: i + 1, reason: "json_parse", message: "作り置きの1行を読み飛ばしました" }, "WARNING");
          continue;
        }
        const result = parsePoolLine(raw);
        if ("skip" in result) {
          if (result.skip === "invalid") {
            stats.invalid++;
            logEvent("quiz_pool_invalid", { file: name, line: i + 1, reason: result.detail ?? "invalid", message: "作り置きの1行を読み飛ばしました" }, "WARNING");
          } else {
            stats[result.skip]++;
          }
          continue;
        }
        const q = result.question;
        const cells = index.get(q.animalId) ?? new Map<string, PoolQuestion>();
        const key = cellKey(q.category, q.level);
        if (cells.has(key)) {
          stats.invalid++;
          logEvent("quiz_pool_invalid", { file: name, line: i + 1, reason: "duplicated_id", poolId: q.id, message: "作り置きの1行を読み飛ばしました" }, "WARNING");
          continue;
        }
        cells.set(key, q);
        index.set(q.animalId, cells);
        stats.approved++;
      }
    }
    stats.animals = index.size;
    logEvent("quiz_pool_loaded", { ...stats, poolVersion: QUIZ_POOL_VERSION, latencyMs: Date.now() - startedAt, message: `作り置きを読み込みました (${stats.approved}問)` });
    return { index, stats };
  } catch (error) {
    logEvent("quiz_pool_load_failed", { error, message: "作り置きを読み込めませんでした（その場で作ります）" }, "ERROR");
    return EMPTY_QUIZ_POOL;
  }
}

// 最初の出題で1回だけ読む。失敗しても空のプールをキャッシュする（loadQuizPool が空を返す）
let poolCache: Promise<QuizPool> | undefined;
export function getQuizPool(): Promise<QuizPool> {
  if (!poolCache) poolCache = loadQuizPool();
  return poolCache;
}

export function hasPool(pool: QuizPool, animalId: string): boolean {
  return pool.index.has(animalId);
}

export type PoolMissReason = "none" | "no_pool_for_animal" | "no_cell" | "all_asked" | "too_few_candidates";

// 作り置きを使う最小の候補数（fresh）。既定1（design 論点3）
function minCandidates(): number {
  const n = Number(process.env.QUIZ_POOL_MIN_CANDIDATES);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

// 決まったレベルとカテゴリで、まだ出していない作り置きを集める（純粋関数）。レベルは代用しない。
export function findPoolCandidates(args: {
  pool: QuizPool;
  animalId: string;
  plan: QuizCategoryPlan;
  level: QuizLevel;
  /** fresh のとき、そのレベルで出してよい候補カテゴリ（filterCategoriesForLevel 済み） */
  allowed: readonly QuizCategory[];
  askedPoolIds: ReadonlySet<string>;
  minCandidates?: number;
}): { candidates: PoolQuestion[]; missReason: PoolMissReason } {
  const { pool, animalId, plan, level, allowed, askedPoolIds } = args;
  const cells = pool.index.get(animalId);
  if (!cells) return { candidates: [], missReason: "no_pool_for_animal" };

  const categories = plan.kind === "retry" ? [plan.category] : allowed;
  const existing = categories.map((c) => cells.get(cellKey(c, level))).filter((q): q is PoolQuestion => Boolean(q));
  if (existing.length === 0) return { candidates: [], missReason: "no_cell" };
  const candidates = existing.filter((q) => !askedPoolIds.has(q.id));
  if (candidates.length === 0) return { candidates: [], missReason: "all_asked" };
  const min = plan.kind === "retry" ? 1 : (args.minCandidates ?? minCandidates());
  if (candidates.length < min) return { candidates: [], missReason: "too_few_candidates" };
  return { candidates, missReason: "none" };
}

// pendingQuiz.consideredCategories 用。選択肢・正解も入れる（pendingQuiz は読み取り不可）。
// quizHistory へは toHistoryCandidates が選択肢・正解を落として写す（#832 B2）。
export function toAgentCandidates(questions: readonly PoolQuestion[]): AgentQuizCandidate[] {
  return questions.map((q) => ({
    category: q.category,
    groundedInOfficialData: q.factSource === "official" || q.factSource === "wikipedia",
    question: q.question,
    choices: [...q.choices],
    correctIndex: q.correctIndex,
  }));
}
