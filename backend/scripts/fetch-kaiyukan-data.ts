// 海遊館サイトが内部的に読み込んでいる静的JSON（非公開API）を取得し、data/kaiyukan-animals.json に保存する。
// 一度だけ手動実行する想定: tsx scripts/fetch-kaiyukan-data.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://www.kaiyukan.com/connect/encyclopedia/json/animal.json";

interface RawKaiyukanAnimal {
  id: string;
  name: string;
  img: string;
  url: string;
  family: string;
  englishName: string;
  scientificName: string;
  description: string;
  classification: string;
  mainExhibition: string;
  subExhibition: string;
  exhibitionStatus: string;
  tag: string;
  topView: string;
}

async function main(): Promise<void> {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`海遊館データの取得に失敗しました: ${res.status} ${res.statusText}`);
  }

  const animals = (await res.json()) as RawKaiyukanAnimal[];
  if (!Array.isArray(animals)) {
    throw new Error("想定外のレスポンス形式です（配列ではありません）");
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "data");
  const outFile = join(outDir, "kaiyukan-animals.json");

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(animals, null, 2) + "\n", "utf-8");

  console.log(`保存しました: ${outFile} (${animals.length}件)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
