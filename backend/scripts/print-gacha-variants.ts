import { buildGachaFlexMessage, type GachaAnimal } from "../src/flexMessages.js";

const animal: GachaAnimal = {
  id: "48",
  name: "ジンベエザメ",
  family: "ジンベエザメ科",
  scientificName: "Rhincodon typus",
  description:
    "世界中の暖かい海域に生息。12m以上になる世界最大の魚類（サメの仲間）です。大きな体ですが、プランクトンを食べます。",
  imageUrl: "https://www.kaiyukan.com/connect/encyclopedia/_data/048_jinbezame_thumb.jpg",
};

console.log("=== デコレーション版(現行) ===");
console.log(JSON.stringify(buildGachaFlexMessage(animal), null, 2));
