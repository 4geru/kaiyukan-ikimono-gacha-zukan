// data/kaiyukan-animals.json を Firestore の animalMaster コレクションへ投入(upsert)する。
// 実行: npm run seed:animal-master
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/firestore.js";
import type { KaiyukanAnimal } from "../src/kaiyukanData.js";

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dataFile = join(__dirname, "..", "data", "kaiyukan-animals.json");
  const animals = JSON.parse(await readFile(dataFile, "utf-8")) as KaiyukanAnimal[];

  const seenIds = new Set<string>();
  for (const animal of animals) {
    if (!animal.id) {
      throw new Error(`idを持たないレコードがあります: ${JSON.stringify(animal)}`);
    }
    if (seenIds.has(animal.id)) {
      throw new Error(`idが重複しています: ${animal.id}`);
    }
    seenIds.add(animal.id);
  }

  const batch = db.batch();
  for (const { id, ...fields } of animals) {
    // merge: scripts/fetch-wikipedia-extracts.tsが投入したwikipediaフィールドを、再投入で消さないため
    batch.set(db.collection("animalMaster").doc(id), fields, { merge: true });
  }
  await batch.commit();

  console.log(`animalMasterへ投入しました: ${animals.length}件`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
