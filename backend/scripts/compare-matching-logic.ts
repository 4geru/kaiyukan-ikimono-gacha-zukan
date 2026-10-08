// 照合ロジックだけを固定入力で比較する（Gemini API・Firestore は使わない）。
// 旧ロジック: 初期コミット d1ae6c44 の src/identifyFish.ts の findMatchingAnimal
//   （完全一致か部分一致かを区別せず Array.find で先頭から探す）の和名部分。
//   入力は和名だけなので、学名・英名の判定は結果に影響しない。
// 現行ロジック: src/identifyFish.ts の findBestMatchingAnimal / confidenceFor をそのまま呼ぶ。
// 243種は data/kaiyukan-animals.json（Firestore animalMaster の元データ）の並び順で走査する。
// 実行: cd backend && npx tsx scripts/compare-matching-logic.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  confidenceFor,
  findBestMatchingAnimal,
  type ExtractedName,
} from "../src/identifyFish.js";
import type { KaiyukanAnimal } from "../src/kaiyukanData.js";

const normalize = (v: string) => v.toLowerCase().replace(/[\s・.,、。]/g, "");

// 旧ロジックの再現: 和名のどちらかが他方を含めば最初の1件を即返す
function legacyFind(name: string, animals: KaiyukanAnimal[]): KaiyukanAnimal | undefined {
  const n = normalize(name);
  return animals.find((a) => {
    const m = normalize(a.name);
    return m.includes(n) || n.includes(m);
  });
}

// 記録にある誤マッチ事例。抽出名は「記録に書かれている名前」を固定入力にしたもの
const CASES: { label: string; extracted: string; note: string }[] = [
  { label: "ハリセンボン", extracted: "ハリセンボン", note: "配列順バグ" },
  { label: "モヨウタケウツボ", extracted: "モヨウタケウツボ", note: "データ欠落" },
  { label: "ツバメウオ", extracted: "ツバメウオ", note: "データ欠落" },
  { label: "シマアジ", extracted: "シマアジ", note: "データ欠落" },
  { label: "ハナゴイ", extracted: "ハナゴイ", note: "データ欠落" },
  { label: "カサゴ", extracted: "カサゴ", note: "長さ比導入後に出現" },
  { label: "クエ", extracted: "クエ", note: "完全一致が存在する対照" },
  { label: "タカサゴ", extracted: "タカサゴ", note: "対照" },
];

async function main() {
  const raw = await readFile(join(process.cwd(), "data", "kaiyukan-animals.json"), "utf8");
  const animals = JSON.parse(raw) as KaiyukanAnimal[];
  console.log(`# animals: ${animals.length}`);
  const ids = new Set(animals.map((a) => a.id));
  console.log(`# unique ids: ${ids.size}`);
  const idx = (name: string) => animals.findIndex((a) => a.name === name);

  console.log("\n## 比較表");
  console.log("抽出名\t旧ロジック\t現行ロジック\t現行の種別\t長さ比\tconfidence\t備考");
  for (const c of CASES) {
    const legacy = legacyFind(c.extracted, animals);
    const ex: ExtractedName = { japaneseName: c.extracted };
    const best = findBestMatchingAnimal(ex, animals);
    const legacyStr = legacy ? `${legacy.name}(idx${animals.indexOf(legacy)})` : "なし";
    const curStr = best ? `${best.animal.name}(idx${animals.indexOf(best.animal)})` : "0件";
    const type = best ? best.match.matchType : "-";
    const ratio = best ? best.match.ratio.toFixed(3) : "-";
    const conf = best ? confidenceFor(best.match) : "-";
    console.log([c.label, legacyStr, curStr, type, ratio, conf, c.note].join("\t"));
  }

  // 配列順への依存: 並びを逆順・シャッフルしても現行ロジックの結果が変わらないか
  console.log("\n## 配列順を変えた時の結果の一致");
  const reversed = [...animals].reverse();
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const shuffles = Array.from({ length: 20 }, () => {
    const a = [...animals];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  for (const c of CASES) {
    const ex: ExtractedName = { japaneseName: c.extracted };
    const key = (list: KaiyukanAnimal[]) => {
      const b = findBestMatchingAnimal(ex, list);
      return b ? `${b.animal.id}` : "0件";
    };
    const base = key(animals);
    const curOk = [reversed, ...shuffles].every((l) => key(l) === base);
    const legacyKeys = new Set(
      [animals, reversed, ...shuffles].map((l) => legacyFind(c.extracted, l)?.id ?? "なし"),
    );
    console.log(`${c.label}\t現行: 21通りの並びで${curOk ? "同一" : "不一致"}\t旧: ${legacyKeys.size}通りの結果`);
  }

  // 長さ比の算術
  console.log("\n## 長さ比（和名の正規化後の文字数）");
  const pairs: [string, string][] = [
    ["カサゴ", "タカサゴ"],
    ["シマアジ", "マアジ"],
    ["ハナゴイ", "アカネハナゴイ"],
    ["モヨウタケウツボ", "ウツボ"],
    ["ツバメウオ", "ヒメツバメウオ"],
  ];
  for (const [a, b] of pairs) {
    const r = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    console.log(`${a}/${b}\t${Math.min(a.length, b.length)}/${Math.max(a.length, b.length)}\t${r.toFixed(3)}\t${r >= 0.75 ? "high" : r >= 0.5 ? "low" : "除外"}`);
  }
  console.log(`\n# index: ヒトヅラハリセンボン=${idx("ヒトヅラハリセンボン")} ハリセンボン=${idx("ハリセンボン")} ウツボ=${idx("ウツボ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
