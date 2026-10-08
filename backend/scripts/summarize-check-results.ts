// illustration-text-check.jsonl の結果をサマライズして、
// docs/illustration-text-check.md を生成する。
//
// 使い方:
//   tsx scripts/summarize-check-results.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cacheFile = join(__dirname, "..", ".cache", "illustration-text-check.jsonl");
  const outputFile = join(__dirname, "..", "..", "docs", "illustration-text-check.md");

  const lines = readFileSync(cacheFile, "utf-8").split("\n").filter((l) => l.trim());
  const results: CheckResult[] = lines.map((line) => JSON.parse(line));

  // ステータス別に分類
  const noText = results.filter((r) => r.status === "no-text");
  const matched = results.filter((r) => r.status === "match");
  const mismatched = results.filter((r) => r.status === "mismatch");

  // 不一致の詳細出力
  const mismatchedDetails = mismatched
    .map((r) => {
      const imagePath = `images/animals/${r.id}-*.png`;
      return `- **${r.name}** (ID: ${r.id})\n  - 正しい和名: ${r.name}\n  - 画像の中の文字: ${r.extractedText}\n  - ファイルパス: \`${imagePath}\``;
    })
    .join("\n\n");

  // ヘコアユ（いないか確認）
  const hekoayu = results.find(
    (r) => r.name === "ヘコアユ" || r.name.includes("ヘコアユ")
  );
  const hekoyuStatus = hekoayu
    ? hekoayu.status === "mismatch"
      ? `【検出あり】${hekoayu.name} は画像に "${hekoayu.extractedText}" と表記されています。`
      : `【確認】${hekoayu.name} は正確に表記されています。`
    : "【未検出】ヘコアユが結果に含まれていません。";

  const markdown = `# イラスト文字点検結果

点検日: ${new Date().toISOString()}

## サマリー

- **総数**: ${results.length}件
- **文字なし**: ${noText.length}件
- **一致**: ${matched.length}件
- **不一致**: ${mismatched.length}件

## 不一致リスト（${mismatched.length}件）

${mismatchedDetails || "（不一致なし）"}

## ヘコアユ（ユーザー指定の検証対象）

${hekoyuStatus}

---

詳細は \`backend/.cache/illustration-text-check.jsonl\` を参照。`;

  writeFileSync(outputFile, markdown, "utf-8");
  console.log(`✓ 結果をまとめました: ${outputFile}`);
  console.log(`  - 総数: ${results.length}件`);
  console.log(`  - 文字なし: ${noText.length}件`);
  console.log(`  - 一致: ${matched.length}件`);
  console.log(`  - 不一致: ${mismatched.length}件`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
