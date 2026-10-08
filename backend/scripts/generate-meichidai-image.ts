// さかなクン画風リサーチ（docs/research/sakanakun-illustration-style.md）と
// 海遊館データ（メイチダイ）をもとに、Gemini画像生成でメイチダイのイラストを作る。
// ジンベエザメ版より特徴描写を誇張したデフォルメ強めのバージョン。
// 一度だけ手動実行する想定: tsx scripts/generate-meichidai-image.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = "gemini-2.5-flash-image";

const PROMPT = `
メイチダイ（Gymnocranius griseus）を主役にした、生きもの図鑑イラストを1枚描いてください。

【描く生きものの特徴（海遊館の解説より）】
- フエフキダイ科の魚。体は銀灰色〜薄桃色で、卵型に近いずんぐりした体形
- 最大の特徴は、目を通って斜めに走る暗色の帯模様（名前の由来）。この帯を強調して、遠目でも一目でメイチダイと分かるように描く
- 目が大きく丸い（名前の「メイチ（眼血/目立）」を感じさせる、印象的な瞳）
- 岩礁域を泳ぐ、口先がやや尖った顔つき

【画風の方向性（さかなクンの画風リサーチに基づく。前作のジンベエザメより誇張を強めに）】
- 水性・油性のカラーペンや筆ペンで描いたような、手描き感のあるミクストメディアタッチ（ベタ塗りのアニメ調やCG的な質感は避ける）
- 図鑑としての解剖学的な正しさ（ヒレの枚数・位置、体の輪郭、鱗の質感）は保ちつつ、名前の由来である目の帯模様と大きな瞳を誇張して強調する。実物よりも帯を太く濃く、目を一回り大きく描き、表情に驚きや愛嬌を持たせる
- 今にも泳ぎ出しそうな躍動感のあるポーズ（体を少しひねる、ヒレを大きく広げるなど）
- ユーモラスで人間味のある豊かな表情。愛らしさを前面に出しつつ、生きものへの愛情が伝わる素朴なタッチ
- ただし記号的な「ゆるキャラ」までは寄せない。誇張はあくまで実在の魚として説得力を保てる範囲にとどめる
- 背景は淡い水色の海中、余白を活かした構図。図鑑の1ページのような、学びを感じさせる仕上がりに
`.trim();

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("環境変数 GEMINI_API_KEY が設定されていません");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: PROMPT,
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    console.error(JSON.stringify(response, null, 2));
    throw new Error("画像データがレスポンスに含まれていません");
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "..", "images", "charactor");
  const outFile = join(outDir, "meichidai-illustration.png");

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, buffer);

  console.log(`保存しました: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
