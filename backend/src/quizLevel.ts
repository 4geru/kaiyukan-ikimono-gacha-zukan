import type { QuizCategory } from "./quiz.js";
import type { CharacterKey, Expression } from "./characters.js";

// 難易度レベル（#829）。LLM・Firestore に依存しない純粋なモジュール。
// レーン0: 型・定数・表示用の関数は本実装、判定の関数はスタブ（中身はレーンA）。

export type QuizLevel = 1 | 2 | 3 | 4 | 5;
export const DEFAULT_QUIZ_LEVEL: QuizLevel = 2;

export interface QuizLevelDef {
  level: QuizLevel;
  name: string;
  audience: string;
  wording: string;
  facts: string;
  distractors: string;
}

export const QUIZ_LEVELS: Record<QuizLevel, QuizLevelDef> = {
  1: {
    level: 1,
    name: "ちびっこ",
    audience: "ようちえん〜小学1年生",
    wording:
      "ひらがなとカタカナだけで書く（漢字を使わない）。問題文は1文・30文字以内、選択肢は10文字以内。ことばのあいだに空白を入れてよい",
    facts:
      "水族館で見てわかること（色・形・大きさ・どこを泳ぐか・何を食べるか）。数字は使わず「おおきい／ちいさい」「つめたい／あたたかい」のような比べることばにする",
    distractors: "子どもでもはっきり違うとわかるもの。正解と同じ種類の答えにする",
  },
  2: {
    level: 2,
    name: "みならい研究員",
    audience: "小学校低学年",
    wording: "やさしい言葉。漢字は小学2年生までに習う程度にし、むずかしい漢字はひらがなにする。問題文は40文字以内",
    facts: "公式の説明にそのまま書いてある基本（すみか・食べもの・大きさ）。数字を使うなら「約10m」のような丸い数だけ",
    distractors: "違いがわかりやすいもの（正解と並べて迷わない程度）",
  },
  3: {
    level: 3,
    name: "研究員",
    audience: "一般（一般常識）",
    wording: "小学生にも分かる言葉。問題文は60文字以内",
    facts: "その生きものについて広く知られている一般常識（説明と参考資料で確かめられるもの）",
    distractors: "もっともらしいもの（その生きものを知らないと迷う程度）",
  },
  4: {
    level: 4,
    name: "ベテラン研究員",
    audience: "中高生〜大人",
    wording: "ふつうの言葉",
    facts: "理由・比較・しくみ（「なぜ？」「どっちが？」「どうやって？」）。答えの理由が説明か参考資料で確かめられるものに限る",
    distractors: "近いもの（同じ理屈で考えると迷うもの）",
  },
  5: {
    level: 5,
    name: "お魚博士",
    audience: "お魚博士",
    wording: "専門用語を使ってよい（科名・目名・学名・器官名）。専門用語にはかっこで短い言い換えを添えてもよい",
    facts: "分類・近縁種との違い・細かい数値。確信の持てない細かい数値は使わず、分類や比較の問いに切り替える",
    distractors:
      "ごく近いもの（近縁種・近い値・同じ分類階級の別の名前）。ただし誤答が「実は正しい」にならないよう、資料で否定できるものだけ",
  },
};

// レベル1で成り立ちにくいカテゴリは、プロンプトの指示に頼らずコードで新規出題の候補から外す（design 5.4）。
export const LEVEL_EXCLUDED_CATEGORIES: Record<QuizLevel, readonly QuizCategory[]> = {
  1: ["進化の歴史", "海外の小ネタ", "類似した仲間", "同じ水槽にいる魚", "郷土料理"],
  2: [],
  3: [],
  4: [],
  5: [],
};

export const LEVEL_CATEGORY_NOTES: Partial<Record<QuizLevel, Partial<Record<QuizCategory, string>>>> = {
  1: {
    生息地: "地名は使わず「あたたかい うみ」「つめたい うみ」のような ことばで答えにする",
    水温: "数字は使わず「つめたい／あたたかい」で答えにする",
    深度: "数字は使わず「うみの うえのほう／まんなか／そこのほう」で答えにする",
    ダジャレ: "子どもが知っている ことばだけで オチをつくる",
    // 除外カテゴリが出し直し（retry）で来たときの言い換え
    進化の歴史: "「ずっと むかしから いる？」のような かたちにし、時代は「きょうりゅうの ころ」のような たとえにする",
    海外の小ネタ: "「ほかの くにでは なんて よばれている？」のような かたちにし、答えは カタカナ ひとこと",
    類似した仲間: "答えは なまえ だけ。問題文は「なかまは どれ？」のように みじかく",
    同じ水槽にいる魚: "答えは なまえ だけ。問題文は「いっしょに およいでいるのは どれ？」のように みじかく",
    郷土料理: "「たべものとして」ではなく「この いきものは なにを たべる？」に寄せてよい",
  },
  2: { 進化の歴史: "時代は「恐竜のころ」のようなたとえにする" },
  4: { 類似した仲間: "科は海遊館データの科名に従う", 同じ水槽にいる魚: "誤答は別の水槽の生きものにする" },
  5: {
    類似した仲間: "科は海遊館データの科名に従う",
    同じ水槽にいる魚: "誤答は別の水槽の近い生きものにする",
    ダジャレ: "英名・学名・分類名を使った言葉遊びにしてよい",
  },
};

export interface QuizRecentEntry {
  level: QuizLevel;
  category: QuizCategory;
  isCorrect: boolean;
  hintUsed: boolean;
  attempts: 1 | 2;
  at: Date; // Firestore の Timestamp は server.ts 側で Date と相互変換する
}
export type LevelFallbackCause = "no_new_answers" | "timeout" | "error" | "invalid_output" | null;
export type LevelGuard = "clamp" | "raise_without_evidence" | "lower_without_evidence" | "cooldown";
export interface LevelDecision {
  from: QuizLevel;
  to: QuizLevel;
  direction: "up" | "keep" | "down";
  reason: string;
  decidedBy: "agent" | "rule";
  fallbackCause: LevelFallbackCause;
  proposed: number | null;
  clamped: boolean;
  guard: LevelGuard | null;
  basis: string[];
  ruleTo: QuizLevel;
  answeredCountAtDecision: number;
  latencyMs: number;
  model: string | null;
  promptVersion: string;
}
export interface LastFinished {
  animalId: string;
  answerToken: number;
  at: number;
}
export interface QuizProfile {
  level: QuizLevel;
  recent: QuizRecentEntry[]; // 新しい順、最大5件
  answeredCount: number;
  lastChangeDirection: "up" | "down" | null;
  levelChangedAtCount: number | null;
  lastFinished: LastFinished | null;
  lastLevelDecision: LevelDecision | null;
}

// design 6.2
export interface LevelCoachInput {
  currentLevel: QuizLevel;
  recent: Array<{
    level: QuizLevel;
    category: string;
    result: "correct" | "correct_with_hint" | "wrong";
    hoursAgo: number;
  }>;
  signals: {
    noHintCorrectStreakAtLevel: number;
    wrongStreak: number;
    hintCorrectInRecent: number;
    answersAtCurrentLevel: number;
    answersSinceLastChange: number | null;
    lastChangeDirection: "up" | "down" | null;
    oscillating: boolean;
    hoursSinceLastAnswer: number | null;
    answeredCount: number;
  };
  ruleSuggestion: { level: QuizLevel; reason: string };
}

export function isQuizLevel(n: unknown): n is QuizLevel {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

export function levelLabel(level: QuizLevel): string {
  return `レベル${level} ${QUIZ_LEVELS[level].name} ${"★".repeat(level)}${"☆".repeat(5 - level)}`;
}

export function buildLevelGuidance(level: QuizLevel, category?: QuizCategory): string {
  const def = QUIZ_LEVELS[level];
  const note = category ? LEVEL_CATEGORY_NOTES[level]?.[category] : undefined;
  return [
    `# 難易度: レベル${level}「${def.name}」（${def.audience}）`,
    `- 言葉づかい: ${def.wording}`,
    `- 問う事実: ${def.facts}`,
    `- 誤答: ${def.distractors}`,
    ...(note ? [`- このカテゴリの補足: ${note}`] : []),
    "- 事実と正解の正しさはレベルによらず同じ基準で守ること（レベルで変えるのは言い回しと深さだけ）",
  ].join("\n");
}

// 除外後が0件なら元を返す（出題を止めない）
export function filterCategoriesForLevel(candidates: readonly QuizCategory[], level: QuizLevel): QuizCategory[] {
  const excluded = LEVEL_EXCLUDED_CATEGORIES[level];
  const filtered = candidates.filter((c) => !excluded.includes(c));
  return filtered.length > 0 ? filtered : [...candidates];
}

const HOUR_MS = 3_600_000;
const RECENT_MAX = 5;

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function") {
    return toDate((v as { toDate: () => unknown }).toDate());
  }
  if (typeof v === "number" || typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function normalizeEntry(raw: unknown): QuizRecentEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const at = toDate(r.at);
  if (!isQuizLevel(r.level) || typeof r.category !== "string" || typeof r.isCorrect !== "boolean" || !at) return null;
  return {
    level: r.level,
    category: r.category as QuizCategory,
    isCorrect: r.isCorrect,
    hintUsed: r.hintUsed === true,
    attempts: r.attempts === 2 ? 2 : 1,
    at,
  };
}

// 未保存・壊れた値は level 2 ほか空にする（読み取り失敗でも出題を止めない）
export function normalizeProfile(raw: unknown): QuizProfile {
  const empty: QuizProfile = {
    level: DEFAULT_QUIZ_LEVEL,
    recent: [],
    answeredCount: 0,
    lastChangeDirection: null,
    levelChangedAtCount: null,
    lastFinished: null,
    lastLevelDecision: null,
  };
  if (typeof raw !== "object" || raw === null) return empty;
  const r = raw as Record<string, unknown>;
  const recent = Array.isArray(r.recent)
    ? r.recent.map(normalizeEntry).filter((e): e is QuizRecentEntry => e !== null).slice(0, RECENT_MAX)
    : [];
  const lf = r.lastFinished as Record<string, unknown> | null | undefined;
  const lastFinished: LastFinished | null =
    lf && typeof lf.animalId === "string" && typeof lf.answerToken === "number" && typeof lf.at === "number"
      ? { animalId: lf.animalId, answerToken: lf.answerToken, at: lf.at }
      : null;
  const ld = r.lastLevelDecision as Record<string, unknown> | null | undefined;
  const lastLevelDecision =
    ld && isQuizLevel(ld.from) && isQuizLevel(ld.to) && typeof ld.answeredCountAtDecision === "number"
      ? (ld as unknown as LevelDecision)
      : null;
  return {
    level: isQuizLevel(r.level) ? r.level : DEFAULT_QUIZ_LEVEL,
    recent,
    answeredCount: typeof r.answeredCount === "number" && r.answeredCount >= 0 ? Math.floor(r.answeredCount) : 0,
    lastChangeDirection: r.lastChangeDirection === "up" || r.lastChangeDirection === "down" ? r.lastChangeDirection : null,
    levelChangedAtCount: typeof r.levelChangedAtCount === "number" ? r.levelChangedAtCount : null,
    lastFinished,
    lastLevelDecision,
  };
}

function resultOf(e: QuizRecentEntry): "correct" | "correct_with_hint" | "wrong" {
  return !e.isCorrect ? "wrong" : e.hintUsed ? "correct_with_hint" : "correct";
}

function isCleanCorrectAt(e: QuizRecentEntry | undefined, level: QuizLevel): boolean {
  return !!e && e.level === level && e.isCorrect && !e.hintUsed;
}

function countFromHead(recent: QuizRecentEntry[], pred: (e: QuizRecentEntry) => boolean): number {
  let n = 0;
  for (const e of recent) {
    if (!pred(e)) break;
    n++;
  }
  return n;
}

// recent の level（古い順）が、直近4件で上下を2回以上切り替えているか
function isOscillating(recent: QuizRecentEntry[]): boolean {
  const levels = recent.slice(0, 4).map((e) => e.level).reverse();
  let lastSign = 0;
  let changes = 0;
  for (let i = 1; i < levels.length; i++) {
    const sign = Math.sign(levels[i] - levels[i - 1]);
    if (sign === 0) continue;
    if (lastSign !== 0 && sign !== lastSign) changes++;
    lastSign = sign;
  }
  return changes >= 2;
}

export function buildCoachInput(profile: QuizProfile, now: Date): LevelCoachInput {
  const cur = profile.level;
  const hoursAgo = (e: QuizRecentEntry) => Math.max(0, Math.round((now.getTime() - e.at.getTime()) / HOUR_MS));
  const recent = profile.recent.slice(0, RECENT_MAX);
  return {
    currentLevel: cur,
    recent: recent.map((e) => ({ level: e.level, category: e.category, result: resultOf(e), hoursAgo: hoursAgo(e) })),
    signals: {
      noHintCorrectStreakAtLevel: countFromHead(recent, (e) => isCleanCorrectAt(e, cur)),
      wrongStreak: countFromHead(recent, (e) => !e.isCorrect),
      hintCorrectInRecent: recent.filter((e) => e.isCorrect && e.hintUsed).length,
      answersAtCurrentLevel: recent.filter((e) => e.level === cur).length,
      answersSinceLastChange:
        profile.levelChangedAtCount === null ? null : Math.max(0, profile.answeredCount - profile.levelChangedAtCount),
      lastChangeDirection: profile.lastChangeDirection,
      oscillating: isOscillating(recent),
      hoursSinceLastAnswer: recent.length > 0 ? hoursAgo(recent[0]) : null,
      answeredCount: profile.answeredCount,
    },
    ruleSuggestion: (() => {
      const r = ruleLevel(profile);
      return { level: r.to, reason: r.reason };
    })(),
  };
}

// 非整数は四捨五入 → 1〜5 → from±1。元の値と違えば clamped
export function clampLevel(from: QuizLevel, proposed: number): { to: QuizLevel; clamped: boolean } {
  if (!Number.isFinite(proposed)) return { to: from, clamped: true };
  const rounded = Math.min(5, Math.max(1, Math.round(proposed)));
  const to = Math.min(from + 1, Math.max(from - 1, rounded)) as QuizLevel;
  return { to, clamped: to !== proposed };
}

// 根拠のない動きを止めて据え置きに戻す（design 6.5）
export function applyLevelGuards(input: LevelCoachInput, to: QuizLevel): { to: QuizLevel; guard: LevelGuard | null } {
  const from = input.currentLevel;
  if (to > from) {
    const last = input.recent[0];
    if (!(last && last.level === from && last.result === "correct")) {
      return { to: from, guard: "raise_without_evidence" };
    }
    const s = input.signals;
    if (s.lastChangeDirection === "up" && s.answersSinceLastChange !== null && s.answersSinceLastChange < 2) {
      return { to: from, guard: "cooldown" };
    }
  }
  if (to < from) {
    const hasEvidence = input.recent.slice(0, 2).some((r) => r.result === "wrong" || r.result === "correct_with_hint");
    if (!hasEvidence) return { to: from, guard: "lower_without_evidence" };
  }
  return { to, guard: null };
}

// 規則: 直近が最終不正解→−1／直近2件が今のレベルでヒントなし正解→+1／それ以外は据え置き
export function ruleLevel(profile: QuizProfile): { to: QuizLevel; reason: string } {
  const from = profile.level;
  const [a, b] = profile.recent;
  if (a && !a.isCorrect) {
    return from > 1
      ? { to: (from - 1) as QuizLevel, reason: "直前で外したので1段下げる" }
      : { to: from, reason: "最下位なのでこのまま" };
  }
  if (isCleanCorrectAt(a, from) && isCleanCorrectAt(b, from)) {
    return from < 5
      ? { to: (from + 1) as QuizLevel, reason: "ヒントなしで2問続けて正解したので1段上げる" }
      : { to: from, reason: "最上位なのでこのまま" };
  }
  return { to: from, reason: "動かす根拠がまだ足りないので据え置き" };
}

// 初回 or 前回の決定から新しく終えた問題が無い
export function shouldKeepLevel(profile: QuizProfile): boolean {
  return profile.answeredCount === 0 || profile.answeredCount === profile.lastLevelDecision?.answeredCountAtDecision;
}

// 先頭に足して5件に切る・累計+1
export function applyFinishedAnswer(
  profile: QuizProfile,
  entry: QuizRecentEntry,
  finished: LastFinished,
): Pick<QuizProfile, "recent" | "answeredCount" | "lastFinished"> {
  return {
    recent: [entry, ...profile.recent].slice(0, 5),
    answeredCount: profile.answeredCount + 1,
    lastFinished: finished,
  };
}

// 変化なしは null（design 5.6）
export function levelChangeLine(
  from: QuizLevel,
  to: QuizLevel,
): { character: CharacterKey; expression: Expression; text: string } | null {
  if (from === to) return null;
  const label = `レベル${to}「${QUIZ_LEVELS[to].name}」`;
  if (to > from) {
    return to === 5
      ? { character: "dr-jinbei", expression: "happy", text: `見事じゃ！ここからは${label}の問題じゃ。ワシも本気を出すぞい` }
      : { character: "dr-jinbei", expression: "happy", text: `ほう、なかなかやるのう。次は${label}の問題じゃ。ちょっと難しくなるぞい` };
  }
  return { character: "kawauso", expression: "normal", text: `次は${label}でいくっす！肩の力を抜いて、じっくり観察するっすよ！` };
}
