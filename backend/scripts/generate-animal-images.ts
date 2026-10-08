// 海遊館の生きもの一覧JSON（https://www.kaiyukan.com/connect/encyclopedia/json/animal.json）を取得し、
// さかなクン画風リサーチ（docs/research/sakanakun-illustration-style.md）に基づく図鑑イラストを
// 1匹（1種）ずつ Gemini 画像生成で作って images/animals/ に保存する。
//
// 使い方:
//   tsx scripts/generate-animal-images.ts                  # 未生成の全種を順番に生成（再開可能）
//   tsx scripts/generate-animal-images.ts --limit=5         # 先頭から未生成分を5件だけ生成（お試し用）
//   tsx scripts/generate-animal-images.ts --id=250          # 特定のIDだけ生成
//   tsx scripts/generate-animal-images.ts --force           # 既存ファイルがあっても再生成
//   --ids=1,2,3        複数IDを指定
//   --no-text          画像内に文字を一切描かせない
//   --out-dir=PATH     出力先フォルダ（既定: images/animals。相対パスはリポジトリのPルート基準）
//   --ref-dir=PATH     同IDの既存画像を参照画像として渡し、画風を揃える
//
// 件数が多い（240種超）ため、既定では未生成分のみ・1件ずつ順番に生成する（再実行で再開できる）。
import { writeFile, mkdir, access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const SOURCE_URL = "https://www.kaiyukan.com/connect/encyclopedia/json/animal.json";
const MODEL = "gemini-2.5-flash-image";
const DELAY_MS = 3000;
const MAX_RETRIES = 3;

interface KaiyukanAnimal {
  id: string;
  name: string;
  englishName: string;
  scientificName: string;
  family: string;
  description: string;
  classification: string;
}

function parseArgs(argv: string[]) {
  const args = {
    limit: undefined as number | undefined,
    id: undefined as string | undefined,
    ids: undefined as string[] | undefined,
    force: false,
    noText: false,
    outDir: undefined as string | undefined,
    refDir: undefined as string | undefined,
  };
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--id=")) args.id = arg.slice("--id=".length);
    else if (arg.startsWith("--ids=")) args.ids = arg.slice("--ids=".length).split(",").filter(Boolean);
    else if (arg === "--no-text") args.noText = true;
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg.startsWith("--ref-dir=")) args.refDir = arg.slice("--ref-dir=".length);
    else if (arg === "--force") args.force = true;
  }
  return args;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function buildPrompt(animal: KaiyukanAnimal, noText = false, hasRef = false): string {
  const base = `
「${animal.name}」（学名: ${animal.scientificName}、英名: ${animal.englishName}）を主役にした、生きもの図鑑イラストを1枚描いてください。

【描く生きものの特徴（海遊館の解説より）】
- 分類: ${animal.family || animal.classification}
- 解説: ${animal.description}

【画風の方向性（さかなクンの画風リサーチに基づく）】
- 水性・油性のカラーペンや筆ペンで描いたような、手描き感のあるミクストメディアタッチ（ベタ塗りのアニメ調やCG的な質感は避ける）
- 図鑑並みに緻密で正確な観察に基づく特徴（体形・模様・ヒレや脚などの構造）は実在の生きものとして破綻しないように描きつつ、この生きものらしさが一目で伝わる特徴（模様・体形・顔つきなど）は少し誇張して強調する
- 今にも動き出しそうな躍動感のあるポーズと、ユーモラスで人間味のある豊かな表情
- 技巧よりも「生きものへの愛情が伝わる」素朴で親しみやすいタッチ。過度なリアル路線にも、記号的なゆるキャラ路線にも寄せすぎない、中間のトーン
- 背景は淡い水色でシンプルに、図鑑の1ページのような余白のある構図
${
  noText
    ? "- 画像内には文字を一切描かない（no text, no letters, no characters, no captions, no labels, no signature, no watermark, no numbers）。名前・学名・数値・吹き出しも不要。絵だけで構成する"
    : `- 画像の下部に「${animal.name}（${animal.scientificName}）」という文字ラベルを手書き風フォントで入れる`
}
`.trim();
  if (!hasRef) return base;
  return `${base}

【参照画像について】
添付の画像は同じ生きものの既存イラストです。画風・色使い・構図・ポーズ・背景の雰囲気は参照画像にできるだけ揃えて描き直してください。ただし参照画像に描かれている文字・ラベル・数値は一切写さず、文字のない絵にしてください。`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateOne(
  ai: GoogleGenAI,
  animal: KaiyukanAnimal,
  outFile: string,
  opts: { noText: boolean; refFile?: string },
): Promise<void> {
  const prompt = buildPrompt(animal, opts.noText, !!opts.refFile);
  const contents = opts.refFile
    ? [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/png", data: (await readFile(opts.refFile)).toString("base64") } },
          ],
        },
      ]
    : prompt;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { responseModalities: [Modality.IMAGE] },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((part) => part.inlineData?.data);

      if (!imagePart?.inlineData?.data) {
        throw new Error("画像データがレスポンスに含まれていません");
      }

      const buffer = Buffer.from(imagePart.inlineData.data, "base64");
      await writeFile(outFile, buffer);
      return;
    } catch (error) {
      console.error(`  試行${attempt}/${MAX_RETRIES}失敗: ${(error as Error).message}`);
      if (attempt === MAX_RETRIES) throw error;
      await sleep(DELAY_MS * attempt);
    }
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("環境変数 GEMINI_API_KEY が設定されていません");
  }

  const { limit, id, ids, force, noText, outDir: outDirArg, refDir } = parseArgs(process.argv.slice(2));

  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`海遊館データの取得に失敗しました: ${res.status} ${res.statusText}`);
  }
  const animals = (await res.json()) as KaiyukanAnimal[];

  const targets = id ? animals.filter((a) => a.id === id) : ids ? animals.filter((a) => ids.includes(a.id)) : animals;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pRoot = join(__dirname, "..", "..");
  const outDir = outDirArg ? resolve(pRoot, outDirArg) : join(pRoot, "images", "animals");
  const refDirAbs = refDir ? resolve(pRoot, refDir) : undefined;
  await mkdir(outDir, { recursive: true });

  const ai = new GoogleGenAI({ apiKey });

  let generated = 0;
  for (const animal of targets) {
    if (limit !== undefined && generated >= limit) break;

    const outFile = join(outDir, `${animal.id}-${slugify(animal.scientificName || animal.englishName || animal.name)}.png`);

    if (!force && (await fileExists(outFile))) {
      continue;
    }

    console.log(`生成中: [${animal.id}] ${animal.name} (${animal.scientificName})`);
    try {
      let refFile: string | undefined;
      if (refDirAbs) {
        const prefix = `${animal.id}-`;
        const found = (await readdir(refDirAbs)).find((f) => f.startsWith(prefix) && f.endsWith(".png"));
        if (found) refFile = join(refDirAbs, found);
      }
      await generateOne(ai, animal, outFile, { noText, refFile });
      console.log(`  保存しました: ${outFile}`);
      generated++;
    } catch (error) {
      console.error(`  スキップ（失敗）: ${(error as Error).message}`);
      continue;
    }

    await sleep(DELAY_MS);
  }

  console.log(`完了: ${generated}件生成しました`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
