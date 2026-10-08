// 友だち追加ウェルカム Flex 用の画像を Gemini で生成する。
// 実行: npx tsx scripts/generate-welcome-images.ts [name ...]  （引数なしで全件）
// 出力: images/welcome/<name>.png。画像内に文字は描かせない。JPEG 化・アップロードは別途。
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = "gemini-2.5-flash-image";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REF_IMAGE = join(__dirname, "..", "..", "images", "article-videos", "Gemini_Generated_Image_bnuz3ybnuz3ybnuz.jpeg");
const OUT_DIR = join(__dirname, "..", "..", "images", "welcome");

const COMMON = `
添付画像の2キャラクター（眼鏡と学士帽に白衣のジンベエザメの名誉教授と、虫眼鏡を持つ白衣のカワウソの助教授）と同じ見た目・同じ線画タッチ・同じ配色で描いてください。
画像の中に文字・数字・ロゴ・看板の文字は一切描かないでください（no text, no letters, no numbers, no logos）。
スマホの小さな画面で見るので、細かい図は避け、大きくシンプルな主役を中央に1つだけ置く。背景は単純に。背景色は画像の端から端まで全面に塗りつぶし、円形や楕円形の枠・白い余白は作らない（full-bleed, no white margin, no vignette）。
水族館らしい落ち着いた青緑系の配色、フラットで親しみやすいイラスト。
`.trim();

const JOBS: { name: string; scene: string }[] = [
  { name: "welcome-1-panel", scene: "水槽の横で、子どもがスマホを大きく構えて解説パネル（文字は描かず、模様のない板と線だけの模型のような絵）を撮影している。横でカワウソが嬉しそうに見守っている。" },
  { name: "welcome-2-zukan", scene: "大きく開いた図鑑の本（ページは真っ白で、文字や記号の代わりに魚の小さなシルエットの絵だけ）から、きらきら光るカードが1枚飛び出している。ジンベエ教授とカワウソが両側で拍手して喜んでいる。" },
  { name: "welcome-3-quiz", scene: "カワウソが大きな「？」の形の吹き出しを頭上に浮かべ（中に文字なし）、ジンベエ教授が電球のマークでヒントを出している。" },
  { name: "welcome-4-station", scene: "画面の左半分に正面やや斜めから見た、明るい色のかわいい電車（先頭車両のみ）。その窓からカワウソが顔を出して手を振っている。画面の右奥の離れた場所に、白と黄色とオレンジの水族館の建物（看板や札は一切なし、のっぺりした壁の模型のような簡単な絵）が線路の先に見える。電車と建物は別々で、建物は電車の上に乗らない。ジンベエ教授は登場しない。" },
];

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("環境変数 GEMINI_API_KEY が設定されていません");
  const ai = new GoogleGenAI({ apiKey });
  const refData = (await readFile(REF_IMAGE)).toString("base64");
  const only = process.argv.slice(2);
  const jobs = only.length ? JOBS.filter((j) => only.includes(j.name)) : JOBS;
  await mkdir(OUT_DIR, { recursive: true });
  for (const job of jobs) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: refData } }, { text: `${COMMON}\n\n場面: ${job.scene}` }] }],
      config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "3:2" } },
    });
    const img = (response.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
    if (!img?.inlineData?.data) { console.error(`画像なし: ${job.name}`); continue; }
    const out = join(OUT_DIR, `${job.name}.png`);
    await writeFile(out, Buffer.from(img.inlineData.data, "base64"));
    console.log(`保存しました: ${out}`);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
