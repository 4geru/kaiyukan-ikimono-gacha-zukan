import "dotenv/config";
import { findFamilyMates, getExhibitionName, toAbsoluteImageUrl } from "../src/kaiyukanData.js";
import { buildMatesFlexMessage, type MateCard } from "../src/flexMessages.js";

async function main() {
  const animalId = process.argv[2] ?? "48"; // ジンベエザメ
  const familyMates = await findFamilyMates(animalId, 3);

  if (familyMates.length === 0) {
    console.error(`animalId ${animalId} のしんせきの仲間が見つかりませんでした`);
    process.exit(1);
  }

  const cards: MateCard[] = await Promise.all(
    familyMates.map(async (mate) => ({
      id: mate.id,
      name: mate.name,
      imageUrl: toAbsoluteImageUrl(mate.img),
      exhibitionName: await getExhibitionName(mate.mainExhibition),
    })),
  );

  console.log(`--- しんせきの仲間サンプル (基準animalId=${animalId}, ${cards.length}件) ---`);
  console.log(JSON.stringify(buildMatesFlexMessage("🧬 しんせきの仲間", "#8E7CC3", cards), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
