// images/animals/ に生成済みの画像と、海遊館データ（backend/data/kaiyukan-animals.json）を突き合わせて
// ガチャ演出デモ（gacha-demo*.html）が読み込む animals-manifest.js を作る。
// バックグラウンドの画像生成が進むたびに再実行すればラインナップが増える想定。
//
// 使い方:
//   node build-manifest.mjs                                      # ローカル用（相対パス ../images/animals/）
//   node build-manifest.mjs --base-url=https://.../animals/ --out=dist-cloud/animals-manifest.js
//                                                                 # デプロイ用（画像の絶対URLを埋め込む）
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { baseUrl: "../images/animals/", out: "animals-manifest.js" };
  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
  }
  return args;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "backend", "data", "kaiyukan-animals.json");
const imagesDir = join(__dirname, "..", "images", "animals");

async function main() {
  const { baseUrl, out } = parseArgs(process.argv.slice(2));
  const outPath = join(__dirname, out);

  const animals = JSON.parse(await readFile(dataPath, "utf-8"));
  const files = await readdir(imagesDir);

  const byId = new Map(animals.map((a) => [a.id, a]));

  const manifest = files
    .filter((f) => f.endsWith(".png"))
    .map((f) => {
      const id = f.split("-")[0];
      const animal = byId.get(id);
      if (!animal) return null;
      return {
        id: animal.id,
        name: animal.name,
        scientificName: animal.scientificName,
        englishName: animal.englishName,
        family: animal.family,
        classification: animal.classification,
        mainExhibition: animal.mainExhibition,
        file: `${baseUrl}${f}`,
      };
    })
    .filter(Boolean);

  const js = `// build-manifest.mjs が自動生成。手で編集しない\nwindow.ANIMALS_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, js, "utf-8");
  console.log(`書き出しました: ${outPath} (${manifest.length}件)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
