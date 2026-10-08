// 写真の読み取り（readPanelFromImage）を実際の Gemini で試す。種の候補と、水槽の看板から読めた展示エリアを表示する。
// 使い方: GOOGLE_CLOUD_PROJECT=kaiyukan-gacha-hackathon npx tsx scripts/try-panel-reading.ts <画像>...
//   例: npx tsx scripts/try-panel-reading.ts ../images/guide/o-11-4species-panel-hedai-a.jpeg
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readPanelFromImage } from "../src/identifyFish.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("画像のパスを1つ以上指定してください");
  process.exit(1);
}
for (const file of files) {
  const { candidates, exhibitions } = await readPanelFromImage(readFileSync(file), "image/jpeg");
  const species = candidates.map((c) => `${c.name}(${c.exhibitionName ?? "?"})`).join("、") || "-";
  const areas = exhibitions.map((e) => e.name).join("、") || "-";
  // 種が読めたときは種の候補、読めず水槽だけ読めたときは「水槽から探す」と同じ動きになる（server.ts）
  const action = candidates.length > 0 ? "種の候補" : exhibitions.length > 0 ? "水槽から探す" : "見つからない";
  console.log(`${basename(file)} | 種: ${species} | 水槽: ${areas} | → ${action}`);
}
process.exit(0);
