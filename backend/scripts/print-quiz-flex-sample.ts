import { buildQuizFlexMessage, buildCandidatesFlexMessage } from "../src/flexMessages.js";

const factualQuiz = {
  animalId: "48",
  category: "特徴",
  question: "ジンベエザメは世界で一番大きな魚だって知ってた？じゃあ、そんな大きなジンベエザメはいったい何を食べると思う？",
  choices: ["大きな魚やアザラシ", "小さなプランクトン", "サンゴ"],
  correctIndex: 1,
};

const dajareQuiz = {
  animalId: "48",
  category: "ダジャレ",
  question: "ジンベエ名誉教授が、ジンベエザメについて一言！さて、何と言ったでしょう？",
  choices: [
    "「ジンベエザメって、泳ぎが『ジンベエ』じゃなくて、『スイスイ』だね！」",
    "「ジンベエザメのヒレは、まるで『甚平』みたいだね！」",
    "「このサメ、体は大きいけど、性格は『ジン』と優しいんだよ！」",
  ],
  correctIndex: 2,
  speakerPersona: "ジンベエ名誉教授",
};

const leveledQuiz = { ...factualQuiz, level: 2 as const };
const retryQuiz = { ...factualQuiz, level: 2 as const, eliminatedIndex: 0 };

const candidates = [
  { id: "48", name: "ジンベエザメ", imageUrl: "https://www.kaiyukan.com/connect/encyclopedia/_data/048_jinbezame_thumb.jpg" },
];

console.log("=== buildQuizFlexMessage (事実クイズ) ===");
console.log(JSON.stringify(buildQuizFlexMessage(factualQuiz), null, 2));

console.log("\n=== buildQuizFlexMessage (レベル付き3択) ===");
console.log(JSON.stringify(buildQuizFlexMessage(leveledQuiz, 1234567890), null, 2));

console.log("\n=== buildQuizFlexMessage (ヒント付き2択・Aを消した) ===");
console.log(JSON.stringify(buildQuizFlexMessage(retryQuiz, 1234567891), null, 2));

console.log("\n=== buildQuizFlexMessage (ダジャレ) ===");
console.log(JSON.stringify(buildQuizFlexMessage(dajareQuiz), null, 2));

console.log("\n=== buildCandidatesFlexMessage (1件) ===");
console.log(JSON.stringify(buildCandidatesFlexMessage(candidates), null, 2));
