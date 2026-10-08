import "dotenv/config";
import assert from "node:assert/strict";
import { findAnimalById } from "../src/kaiyukanData.js";
import type { QuizQuestion } from "../src/quiz.js";
import type { QuizLevel } from "../src/quizLevel.js";
import { checkHint, generateQuizHint, normalizeForCheck } from "../src/quizHint.js";

// ---- 1. checkHint の assert（LLM 不要）----
const q = (question: string, choices: string[], correctIndex = 0) => ({ question, choices, correctIndex });
const base = q("ジンベエザメの口があるのは頭のどこ？", ["頭の先（正面）", "頭の下側", "頭の上"]);

assert.equal(normalizeForCheck("１２ｍ"), "12m");
assert.equal(normalizeForCheck("十二"), "12");
assert.equal(normalizeForCheck("プランクトン"), "ぷらんくとん");
assert.equal(checkHint("正解は頭の先じゃ", base, 1), "contains_answer"); // 正解そのもの
assert.equal(checkHint("頭の上ではないぞい", base, 1), "reveals_other"); // 残る誤答の否定
assert.equal(checkHint("ふむ、多くのサメは口が下にあるが、ワシは泳ぎながら海水をまっすぐ吸いこむのじゃ", base, 1), null); // 合格例
assert.equal(checkHint("  ！？ ", base, 1), "empty");
assert.equal(checkHint("あ".repeat(81), base, 1), "too_long");
assert.equal(checkHint("あ".repeat(80), base, 1), null);

const plank = q("ジンベエザメは何を食べる？", ["小さなプランクトン", "大きな魚", "サンゴ"]);
assert.equal(checkHint("ぷらんくとんを食べるのじゃ", plank, 1), "contains_answer"); // カタカナ↔ひらがな
const num = q("ジンベエザメの大きさは？", ["12m", "5m", "30m"]);
assert.equal(checkHint("１２ｍくらいじゃ", num, 1), "contains_answer"); // 全角数字
assert.equal(checkHint("十二メートルくらいじゃ", num, 1), "contains_answer"); // 漢数字・単位違い
assert.equal(checkHint("12メートルほどじゃのう", num, 1), "contains_answer"); // 単位違い
assert.equal(checkHint("「12m」じゃぞい", num, 1), "contains_answer"); // 括弧付き
const kanjiNum = q("体長は？", ["十二メートル", "5メートル", "30メートル"]);
assert.equal(checkHint("12mくらいじゃ", kanjiNum, 1), "contains_answer"); // 「十二」と「12」
const one = q("口の数は？", ["3", "1", "2"]);
assert.equal(checkHint("3つじゃ", one, 1), "contains_answer"); // 1文字の正解
const inQ = q("ジンベエザメの口は頭のどこ？", ["頭の先", "頭の下側", "頭の上"]);
assert.equal(checkHint("ジンベエザメの口をよく見るのじゃ", inQ, 1), null); // 問題文にある語は弾かない
const shared = q("口は？", ["海水を吸う前", "海水を吸う下", "上"]);
assert.equal(checkHint("海水を吸うのがポイントじゃ", shared, 2), null); // 正解と誤答の共通語は弾かない
console.log("checkHint assert: OK");

// ---- 2. 固定の問題での generateQuizHint ----
interface Fixed { animalId: string; level: QuizLevel; quiz: QuizQuestion }
const fixed: Fixed[] = [
  { animalId: "48", level: 1, quiz: { animalId: "48", category: "特徴", question: "ジンベエザメの口はどこにある？", choices: ["あたまの まえ", "おなか", "しっぽ"], correctIndex: 0 } },
  { animalId: "48", level: 3, quiz: { animalId: "48", category: "特徴", question: "ジンベエザメの口があるのは頭のどこ？", choices: ["頭の先（正面）", "頭の下側", "頭の上"], correctIndex: 0 } },
  { animalId: "48", level: 5, quiz: { animalId: "48", category: "特徴", question: "ジンベエザメの呼吸に関わる器官について正しいものは？", choices: ["軟骨魚類なので鰓蓋を持たず鰓裂が露出している", "硬骨魚類と同じく鰓蓋で鰓を覆っている", "肺で空気呼吸をする"], correctIndex: 0 } },
  { animalId: "48", level: 2, quiz: { animalId: "48", category: "ダジャレ", question: "ジンベエ名誉教授が、ジンベエザメについて一言！さて、何と言ったでしょう？", choices: ["「このサメ、体は大きいけど、性格は『ジン』と優しいんだよ！」", "「ジンベエザメのヒレは、まるで『甚平』みたいだね！」", "「泳ぎが『ジンベエ』じゃなくて『スイスイ』だね！」"], correctIndex: 1, speakerPersona: "ジンベエ名誉教授" } },
  { animalId: "48", level: 4, quiz: { animalId: "48", category: "生息地", question: "ジンベエザメが主に暮らしているのは？", choices: ["熱帯から温帯の暖かい海", "北極の氷の下", "日本の川"], correctIndex: 0 } },
  { animalId: "206", level: 3, quiz: { animalId: "206", category: "類似した仲間", question: "ナンヨウマンタに近い仲間はどれ？", choices: ["イトマキエイ", "ホシザメ", "ウミガメ"], correctIndex: 0 } },
  { animalId: "48", level: 3, quiz: { animalId: "48", category: "水温", question: "ジンベエザメが快適に過ごす水温は？", choices: ["約25℃", "約5℃", "約40℃"], correctIndex: 0 } },
];

async function main() {
  const rows: { level: QuizLevel; hint: string; src: string; reason: string | null; ms: number; limit: number }[] = [];
  const limits: Record<QuizLevel, number> = { 1: 30, 2: 40, 3: 60, 4: 60, 5: 60 };
  for (const f of fixed) {
    const animal = await findAnimalById(f.animalId);
    if (!animal) throw new Error(`animal ${f.animalId} not found`);
    const wrongs = f.quiz.choices.map((_c, i) => i).filter((i) => i !== f.quiz.correctIndex);
    for (const eliminated of wrongs) {
      const r = await generateQuizHint(animal, f.quiz, eliminated, f.level);
      rows.push({ level: f.level, hint: r.hint, src: r.hintSource, reason: r.hintRejectReason, ms: r.latencyMs, limit: limits[f.level] });
      // 表示されるヒントに正解・残る誤答の語が無いこと（検査で必ず止まる）
      assert.equal(checkHint(r.hint, f.quiz, eliminated), null, `漏れ: ${r.hint}`);
    }
  }
  const n = rows.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(0)}%`;
  const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
  const fb = rows.filter((r) => r.src === "fallback").length;
  const llm = rows.filter((r) => r.src === "llm");
  const inLimit = llm.filter((r) => [...r.hint].length <= r.limit).length;
  const tone = llm.filter((r) => /じゃ|のう|ぞい/.test(r.hint)).length;
  console.log(`\n件数 ${n} / fallback ${fb} (${pct(fb)}) [基準 20%以下] / timeout ${rows.filter((r) => r.reason === "timeout").length} [基準 1以下]`);
  console.log(`時間 p95 ${sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]}ms [基準 4000以内] / 字数内 ${inLimit}/${llm.length} [基準 90%] / 口調 ${tone}/${llm.length} [基準 80%]`);
  console.log("\n--- 目視用一覧（答えに近づける / 中身がある / 意味の漏れ無し を ○/× で）---");
  rows.forEach((r, i) => console.log(`${i + 1}. [L${r.level} ${r.src}${r.reason ? ":" + r.reason : ""} ${r.ms}ms] ${r.hint}   [ ] [ ] [ ]`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
