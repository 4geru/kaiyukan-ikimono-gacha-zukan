// 海遊館サイトが内部的に読み込んでいる展示エリア名マッピング（非公開API）を取得し、
// data/kaiyukan-exhibitions.json に保存する。一度だけ手動実行する想定:
// tsx scripts/fetch-exhibition-data.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://www.kaiyukan.com/connect/encyclopedia/json/exhibition.json";

interface RawExhibition {
  name: string;
  slug: string;
  img: string;
}

async function main(): Promise<void> {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`展示エリアデータの取得に失敗しました: ${res.status} ${res.statusText}`);
  }

  const exhibitions = (await res.json()) as RawExhibition[];
  if (!Array.isArray(exhibitions)) {
    throw new Error("想定外のレスポンス形式です（配列ではありません）");
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "data");
  const outFile = join(outDir, "kaiyukan-exhibitions.json");

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(exhibitions, null, 2) + "\n", "utf-8");

  console.log(`保存しました: ${outFile} (${exhibitions.length}件)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
