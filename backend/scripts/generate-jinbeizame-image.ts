// さかなクン画風リサーチ（docs/research/sakanakun-illustration-style.md）と
// 海遊館データ（ジンベエザメ）をもとに、Gemini画像生成でジンベエザメのイラストを作る。
// 一度だけ手動実行する想定: tsx scripts/generate-jinbeizame-image.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = "gemini-2.5-flash-image";

const PROMPT = `
ジンベエザメ（Rhincodon typus）を主役にした、生きもの図鑑イラストを1枚描いてください。

【描く生きものの特徴（海遊館の解説より）】
- 世界最大の魚類（サメの仲間）。体長12m以上の堂々とした体格
- 背面は青灰色〜灰褐色で、白い斑点と縦横の白いラインが格子状に並ぶ独特の模様
- 頭部は平たく大きく、口が体幅いっぱいに広い（先端に近い位置についた大きな横長の口）
- 巨体だが性質は穏やかで、口を開けてプランクトンを海水ごと吸い込み、エラで濾して食べる
- 世界中の暖かい海域を悠々と泳ぐ

【画風の方向性（さかなクンの画風リサーチに基づく）】
- 水性・油性のカラーペンや筆ペンで描いたような、手描き感のあるミクストメディアタッチ（ベタ塗りのアニメ調やCG的な質感は避ける）
- 図鑑並みに緻密で正確な観察に基づく解剖学的特徴（ヒレの形・体のライン・斑点模様は実在種として破綻しないように）
- その上で、今にも泳ぎ出しそうな躍動感と、どこかユーモラスで愛らしい表情を加える
- 技巧よりも「生きものへの愛情が伝わる」素朴で親しみやすいタッチ。過度なリアル路線にも、記号的なゆるキャラ路線にも寄せすぎない、中間のトーン
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
  const outFile = join(outDir, "jinbeizame-illustration.png");

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, buffer);

  console.log(`保存しました: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
