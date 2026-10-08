import "dotenv/config";
import { findAnimalById, findTankmateNames, findFamilyMateNames } from "../src/kaiyukanData.js";
import { generateQuizForAnimal, pickRandomCategory, type QuizCategory } from "../src/quiz.js";
import { isQuizLevel, levelLabel, type QuizLevel } from "../src/quizLevel.js";

// 使い方: npx tsx scripts/try-quiz-category.ts [animalId] [category] [levels=1,3,5]
// 同じ生きもの・カテゴリをレベル別に作って並べる（design 11.3。表示のみで合否にはしない）。
const KANJI = /[\u4e00-\u9fff]/;
const DIGIT = /[0-9０-９]/;

async function main() {
  const animalId = process.argv[2] ?? "48";
  const category = (process.argv[3] as QuizCategory | undefined) ?? pickRandomCategory();

  const animal = await findAnimalById(animalId);
  if (!animal) {
    console.error(`animalId ${animalId} が見つかりません`);
    process.exit(1);
  }

  const groundingNames =
    category === "類似した仲間"
      ? await findFamilyMateNames(animalId)
      : category === "同じ水槽にいる魚"
        ? await findTankmateNames(animalId)
        : [];

  console.log(`--- ${animal.name} / カテゴリ: ${category} (grounding: ${groundingNames.join(",") || "なし"}) ---`);
  const levels = (process.argv[4] ?? "1,3,5").split(",").map(Number).filter(isQuizLevel) as QuizLevel[];
  for (const level of levels) {
    const quiz = await generateQuizForAnimal(animal, category, groundingNames, undefined, level);
    const text = [quiz.question, ...quiz.choices].join("");
    console.log(`\n## ${levelLabel(level)}`);
    console.log(`Q: ${quiz.question}`);
    quiz.choices.forEach((c, i) => console.log(`  ${i === quiz.correctIndex ? "◎" : "・"} ${c}`));
    console.log(`  [問題文 ${quiz.question.length}字 / 漢字: ${KANJI.test(text) ? "あり" : "なし"} / 数字: ${DIGIT.test(text) ? "あり" : "なし"}]`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
