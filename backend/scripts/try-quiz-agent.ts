import "dotenv/config";
import { findAnimalById, loadKaiyukanAnimals } from "../src/kaiyukanData.js";
import { QUIZ_CATEGORIES } from "../src/quiz.js";
import { generateQuizWithAgent } from "../src/quizAgent.js";

async function main() {
  const animalName = process.argv[2] ?? "ジンベエザメ";
  // 3つ目以降の引数は、候補から除外するカテゴリ（直近の出題と被らないようにする動作の確認用）
  const excludedCategories = process.argv.slice(3);
  const candidateCategories = QUIZ_CATEGORIES.filter((c) => !excludedCategories.includes(c));

  const animals = await loadKaiyukanAnimals();
  const animal = animals.find((a) => a.name === animalName) ?? (await findAnimalById(animalName));
  if (!animal) {
    console.error(`生き物が見つかりませんでした: ${animalName}`);
    process.exit(1);
  }

  console.log(`--- ${animal.name} のクイズをエージェントに考えさせています ---\n`);
  const start = Date.now();
  const result = await generateQuizWithAgent(animal, candidateCategories);
  const elapsedMs = Date.now() - start;

  console.log(`--- 13カテゴリ分の候補クイズ (所要時間: ${elapsedMs}ms) ---`);
  console.log(JSON.stringify(result.consideredCategories, null, 2));

  console.log(`\n--- 選ばれた出題（${result.quiz.category}） ---`);
  console.log(`理由: ${result.selectionReason}`);
  console.log(`Q: ${result.quiz.question}`);
  result.quiz.choices.forEach((choice, i) => {
    console.log(`  ${i === result.quiz.correctIndex ? "◎" : "・"} ${choice}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
