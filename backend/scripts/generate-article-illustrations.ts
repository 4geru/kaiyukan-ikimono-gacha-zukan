// Zenn 記事4本のアイキャッチ的な挿絵を Gemini で生成する。
// 実行: npx tsx scripts/generate-article-illustrations.ts [slug ...]  （引数なしで全件）
// キャラの見た目は参照画像（2キャラ）を渡して揃える。画像内に文字は描かせない。
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = "gemini-2.5-flash-image";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF_IMAGE = join(
  __dirname,
  "..",
  "..",
  "images",
  "article-videos",
  "Gemini_Generated_Image_bnuz3ybnuz3ybnuz.jpeg",
);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const COMMON = `
添付画像の2キャラクター（眼鏡と学士帽に白衣のジンベエザメの名誉教授と、虫眼鏡を持つ白衣のカワウソの助教授）と同じ見た目・同じ線画タッチ・同じ配色で描いてください。
画像の中に文字・数字・ロゴ・看板の文字は一切描かないでください（no text, no letters, no numbers, no logos）。
横長 16:9 の構図、水族館らしい落ち着いた青緑系の配色、フラットで親しみやすいイラスト。
`.trim();

interface Job {
  slug: string;
  file: string;
  scene: string;
}

const JOBS: Job[] = [
  {
    slug: "station-aquarium-adk-ekispert-mcp",
    file: "eyecatch.png",
    scene:
      "電車の駅のホームと、窓の外に水族館の大きな水槽が見える風景。2キャラクターが駅のホームに並んで立ち、カワウソが虫眼鏡で遠くの路線図のような抽象的な線（文字なし）をのぞき込み、ジンベエ教授が膨大な書類の山から小さな一枚だけをつまみ上げて微笑んでいる。",
  },
  {
    slug: "quiz-agent-adk-category-selection",
    file: "eyecatch.png",
    scene:
      "研究室の大きなテーブルの上に、小さなクイズカードが13枚ほど扇のように並べられている。2キャラクターがそれを見比べて相談していて、ジンベエ教授は1枚のカードを手に取って満足げ、カワウソは残りのカードを抱えて首をかしげている。カードには文字を書かず、小さな魚や貝などの絵柄だけにする。",
  },
  {
    slug: "guide-panel-identify-gemini-vision-scoring",
    file: "eyecatch.png",
    scene:
      "水族館の大水槽の前で、親子連れがスマホを解説パネル（文字や写真は描かず、ぼんやりした模様の板だけ）にかざして撮影している。その横の水中に2キャラクターがいて、カワウソが虫眼鏡でパネルをのぞき、ジンベエ教授が本を開いて照合している。",
  },
  {
    slug: "line-bot-sender-character-dialogue",
    file: "eyecatch.png",
    scene:
      "大きなスマートフォンの画面の左右に、2キャラクターがそれぞれ吹き出し（中は空白、文字なし）を出して掛け合いをしている。カワウソが元気に話しかけ、ジンベエ教授がにこやかに答えている。背景は淡い水の中。",
  },
];

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("環境変数 GEMINI_API_KEY が設定されていません");
  const ai = new GoogleGenAI({ apiKey });

  const refData = (await readFile(REF_IMAGE)).toString("base64");
  const only = process.argv.slice(2);
  const jobs = only.length ? JOBS.filter((j) => only.includes(j.slug)) : JOBS;

  for (const job of jobs) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: refData } },
            { text: `${COMMON}\n\n場面: ${job.scene}` },
          ],
        },
      ],
      config: { responseModalities: [Modality.IMAGE] },
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data);
    if (!img?.inlineData?.data) {
      console.error(`画像なし: ${job.slug}`);
      continue;
    }
    const outDir = join(REPO_ROOT, "images", "articles", job.slug);
    await mkdir(outDir, { recursive: true });
    const out = join(outDir, job.file);
    await writeFile(out, Buffer.from(img.inlineData.data, "base64"));
    console.log(`保存しました: ${out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
