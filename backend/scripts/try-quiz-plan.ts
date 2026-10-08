import assert from "node:assert/strict";
import {
  CATEGORY_BRIEFS,
  COMMON_QUIZ_RULES,
  QUIZ_CATEGORIES,
  QUIZ_HISTORY_WINDOW,
  buildReferenceSection,
  pickAllowedCandidate,
  planQuizCategory,
  type QuizCategory,
  type QuizHistoryEntry,
} from "../src/quiz.js";

// docs/specs/791-quiz-history design.md 8節: planQuizCategoryの検証。Firestore・Geminiには触れない。

function entries(...items: Array<[QuizCategory, boolean]>): QuizHistoryEntry[] {
  return items.map(([category, isCorrect]) => ({ category, isCorrect }));
}

function expectFresh(recent: QuizHistoryEntry[]): QuizCategory[] {
  const plan = planQuizCategory(recent);
  assert.equal(plan.kind, "fresh");
  return plan.kind === "fresh" ? plan.candidates : [];
}

// 履歴0件 → 全13カテゴリが候補
assert.equal(expectFresh([]).length, QUIZ_CATEGORIES.length);

// 直近が不正解 → retry（直近のカテゴリ）。それ以前の履歴は見ない
assert.deepEqual(
  planQuizCategory(entries(["水温", false], ["生息地", true])),
  { kind: "retry", category: "水温" },
);

// 直近が正解で5件 → 候補8件、直近5件のカテゴリを含まない
const five = entries(["生息地", true], ["水域", true], ["水温", true], ["深度", true], ["特徴", true]);
const fromFive = expectFresh(five);
assert.equal(fromFive.length, QUIZ_CATEGORIES.length - QUIZ_HISTORY_WINDOW);
for (const entry of five) assert.ok(!fromFive.includes(entry.category));

// 履歴が3件 → 候補10件
assert.equal(expectFresh(entries(["生息地", true], ["水域", true], ["水温", true])).length, 10);

// 直近が正解なら、それ以前に不正解があってもfresh
assert.equal(planQuizCategory(entries(["水温", true], ["水域", false])).kind, "fresh");

// 出題をシミュレート（正解・不正解を混ぜて100問）。新しいカテゴリは常に直近5問と被らず、候補は常に8件以上
const history: QuizHistoryEntry[] = [];
for (let i = 0; i < 100; i++) {
  const recent = history.slice(0, QUIZ_HISTORY_WINDOW);
  const plan = planQuizCategory(recent);

  let category: QuizCategory;
  if (plan.kind === "retry") {
    category = plan.category;
  } else {
    assert.ok(plan.candidates.length >= QUIZ_CATEGORIES.length - QUIZ_HISTORY_WINDOW);
    category = plan.candidates[Math.floor(Math.random() * plan.candidates.length)];
    for (const entry of recent) assert.notEqual(category, entry.category);
  }
  history.unshift({ category, isCorrect: Math.random() < 0.6 });
}

console.log("planQuizCategory: 全ケースOK");

// pickAllowedCandidate: エージェントが候補外のカテゴリを選んでも、候補外は出題されない
const allowed: QuizCategory[] = ["生息地", "水域", "深度"];
const considered = [
  { category: "水温" as QuizCategory, question: "候補外1" },
  { category: "生息地" as QuizCategory, question: "生息地の問題" },
  { category: "ダジャレ" as QuizCategory, question: "候補外2" },
  { category: "深度" as QuizCategory, question: "深度の問題" },
];

// 選ばれたカテゴリが候補内ならそのまま
assert.equal(pickAllowedCandidate(considered, "深度", allowed)?.question, "深度の問題");

// 選ばれたカテゴリが候補外なら、検討済みの候補内カテゴリから選び直す（何度試しても候補外は返らない）
for (let i = 0; i < 50; i++) {
  const picked = pickAllowedCandidate(considered, "ダジャレ", allowed);
  assert.ok(picked && allowed.includes(picked.category));
}

// 検討結果に候補内のカテゴリが1件もなければundefined
assert.equal(pickAllowedCandidate(considered, "水温", ["食物連鎖"]), undefined);
assert.equal(pickAllowedCandidate([], "水温", allowed), undefined);

console.log("pickAllowedCandidate: 全ケースOK");

// CATEGORY_BRIEFS: 全13カテゴリに切り口(focus)と避けること(avoid)が定義されている
for (const category of QUIZ_CATEGORIES) {
  const brief = CATEGORY_BRIEFS[category];
  assert.ok(brief && brief.focus.length > 0 && brief.avoid.length > 0, `${category}の出題方針が未定義`);
}
assert.equal(Object.keys(CATEGORY_BRIEFS).length, QUIZ_CATEGORIES.length);
assert.ok(COMMON_QUIZ_RULES.length > 0);

// buildReferenceSection: 記事のある種は参考資料の節、無い種は空文字
const baseAnimal = { id: "1", name: "テスト", englishName: "", scientificName: "", description: "", img: "", family: "", classification: "", mainExhibition: "", subExhibition: "", exhibitionStatus: "", tag: "" };
assert.equal(buildReferenceSection(baseAnimal), "");
const withWiki = buildReferenceSection({ ...baseAnimal, wikipedia: { lang: "en", title: "Whale shark", url: "u", extract: "本文", fetchedAt: "" } });
assert.ok(withWiki.includes("英語版「Whale shark」") && withWiki.includes("本文"));

console.log("CATEGORY_BRIEFS / buildReferenceSection: 全ケースOK");
