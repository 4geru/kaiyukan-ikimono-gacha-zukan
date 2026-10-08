// images/animals/ の生成済みイラスト243枚に描き込まれた文字が、
// 正しい和名・英名・学名と合致しているかを Gemini で点検する。
//
// 使い方:
//   tsx scripts/check-illustration-text.ts            # 未点検分を順番に全件点検
//   tsx scripts/check-illustration-text.ts --limit=5   # 先頭から未点検分を5件だけ実行
//   --dir=PATH(Pルート基準) 点検対象フォルダ / --cache=FILE 結果jsonl / --ids=1,2 対象ID
//
// 結果は backend/.cache/illustration-text-check.jsonl に追記（途中で止まっても再開可能）

import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Part } from "@google/genai";
import pLimit from "p-limit";
import * as fs from "node:fs";
import * as dotenv from "dotenv";

// 環境変数を読み込む
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const MODEL = "gemini-2.5-flash-image";
const MAX_CONCURRENT = 4;
const DELAY_MS = 1000;

interface KaiyukanAnimal {
  id: string;
  name: string;
  englishName: string;
  scientificName: string;
}

interface CheckResult {
  id: string;
  name: string;
  englishName: string;
  scientificName: string;
  extractedText: string;
  status: "no-text" | "match" | "mismatch";
  details: string;
  timestamp: string;
}

function parseArgs(argv: string[]) {
  const args = { limit: undefined as number | undefined, dir: undefined as string | undefined, cache: undefined as string | undefined, ids: undefined as string[] | undefined };
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--dir=")) args.dir = arg.slice("--dir=".length);
    else if (arg.startsWith("--cache=")) args.cache = arg.slice("--cache=".length);
    else if (arg.startsWith("--ids=")) args.ids = arg.slice("--ids=".length).split(",").filter(Boolean);
  }
  return args;
}

async function loadAlreadyChecked(cacheFile: string): Promise<Set<string>> {
  const checked = new Set<string>();
  if (fs.existsSync(cacheFile)) {
    const lines = fs.readFileSync(cacheFile, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        checked.add(obj.id);
      } catch {
        // skip malformed lines
      }
    }
  }
  return checked;
}

function compareText(extractedText: string, name: string, englishName: string, scientificName: string): { status: "no-text" | "match" | "mismatch"; details: string } {
  const text = extractedText.trim();

  // テキストがない場合
  // 「文字がない」旨の返答（例: 「この画像には文字が描かれていません。」「空です。」）も文字なし扱い
  const noTextAnswer = /^[（(]?空|文字[はが]?(描かれて|含まれて|ありません|ない)/;
  if (!text || (text.length < 30 && noTextAnswer.test(text))) {
    return { status: "no-text", details: "画像に文字がない" };
  }

  // 和名が含まれるかチェック（完全一致あるいは部分一致）
  const hasName = text.includes(name);
  const hasEnglish = text.includes(englishName);
  const hasScientific = text.includes(scientificName);

  if (hasName || hasEnglish || hasScientific) {
    const matches = [];
    if (hasName) matches.push(`和名(${name})`);
    if (hasEnglish) matches.push(`英名(${englishName})`);
    if (hasScientific) matches.push(`学名(${scientificName})`);
    return { status: "match", details: `一致: ${matches.join(", ")}` };
  }

  // 不一致: 実際に書かれている文字と期待される文字の差異を記録
  return {
    status: "mismatch",
    details: `不一致。画像の文字: "${text}"`,
  };
}

async function extractTextFromImage(ai: GoogleGenAI, imagePath: string): Promise<string> {
  try {
    const imageData = await readFile(imagePath);
    const base64 = imageData.toString("base64");

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "この画像に描かれている文字をすべてそのまま書き出してください。文字がなければ空で答えてください。",
            } as Part,
            {
              inlineData: {
                mimeType: "image/png",
                data: base64,
              },
            } as Part,
          ],
        },
      ],
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return text;
  } catch (error) {
    throw new Error(`画像処理失敗 (${imagePath}): ${(error as Error).message}`);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

async function checkOne(
  ai: GoogleGenAI,
  animal: KaiyukanAnimal,
  imagesDir: string,
  cacheFile: string
): Promise<void> {
  try {
    const imagePath = join(imagesDir, `${animal.id}-${slugify(animal.scientificName || animal.englishName || animal.name)}.png`);

    // 画像ファイルが存在するか確認
    if (!fs.existsSync(imagePath)) {
      console.log(`  [${animal.id}] 画像ファイルが見つかりません: ${imagePath}`);
      return;
    }

    console.log(`  抽出中: [${animal.id}] ${animal.name}`);
    const extractedText = await extractTextFromImage(ai, imagePath);

    const { status, details } = compareText(extractedText, animal.name, animal.englishName, animal.scientificName);

    const result: CheckResult = {
      id: animal.id,
      name: animal.name,
      englishName: animal.englishName,
      scientificName: animal.scientificName,
      extractedText,
      status,
      details,
      timestamp: new Date().toISOString(),
    };

    // 結果を追記
    fs.appendFileSync(cacheFile, JSON.stringify(result) + "\n");
    console.log(`    ✓ ${status}: ${details}`);
  } catch (error) {
    console.error(`  エラー [${animal.id}] ${animal.name}: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("環境変数 GEMINI_API_KEY が設定されていません");
  }

  const { limit, dir, cache, ids } = parseArgs(process.argv.slice(2));

  // 動物マスタデータを読み込む
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dataFile = join(__dirname, "..", "data", "kaiyukan-animals.json");
  const animalsData = JSON.parse(fs.readFileSync(dataFile, "utf-8")) as KaiyukanAnimal[];

  // キャッシュファイルの準備
  const cacheDir = join(__dirname, "..", ".cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const cacheFile = cache ? resolve(cache) : join(cacheDir, "illustration-text-check.jsonl");

  // 既に点検済みの id を読む
  const alreadyChecked = await loadAlreadyChecked(cacheFile);
  console.log(`既に点検済み: ${alreadyChecked.size}件`);

  // 未点検の動物をフィルター
  const targets = animalsData.filter((a) => !alreadyChecked.has(a.id) && (!ids || ids.includes(a.id)));
  console.log(`未点検: ${targets.length}件`);

  if (targets.length === 0) {
    console.log("すべて点検済みです");
    return;
  }

  // limit が指定されていれば適用
  const toCheck = limit ? targets.slice(0, limit) : targets;
  console.log(`点検対象: ${toCheck.length}件\n`);

  const ai = new GoogleGenAI({ apiKey });
  const limiter = pLimit(MAX_CONCURRENT);

  const imagesDir = dir ? resolve(join(__dirname, "..", ".."), dir) : join(__dirname, "..", "..", "images", "animals");

  // 並列実行（最大4件まで）
  const tasks = toCheck.map((animal) => limiter(() => checkOne(ai, animal, imagesDir, cacheFile)));

  await Promise.all(tasks);

  console.log(`\n完了: ${toCheck.length}件を点検キャッシュに追記しました`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
