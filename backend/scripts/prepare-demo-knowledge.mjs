// デモ図鑑（demo-zukan）の「知識」欄を作るための入力を用意する。
// 1種ごとに、開いておく知識のカテゴリ（クイズと同じ13カテゴリから3〜10個）を決まった乱数で選び、
// 文を書く材料（海遊館の解説・同じ水槽の種・同じ科の種）と一緒に書き出す。文はこの入力をもとに別途作り、
// data/demo-knowledge.json（{ [animalId]: { [カテゴリ]: 文 } }）にまとめる。seed-demo-user.ts がそれを読む。
// 使い方: node scripts/prepare-demo-knowledge.mjs <出力先ディレクトリ> [分割数=2]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CATEGORIES = ["生息地", "水域", "水温", "深度", "郷土料理", "類似した仲間", "同じ水槽にいる魚", "特徴", "豆知識", "進化の歴史", "食物連鎖", "ダジャレ", "海外の小ネタ"];
const outDir = path.resolve(process.argv[2] ?? ".");
const parts = Number(process.argv[3] ?? 2);

const animals = JSON.parse(await readFile(new URL("../data/kaiyukan-animals.json", import.meta.url), "utf-8"));
let seed = 20261010;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const items = animals.map((a) => {
  const tankmates = animals.filter((b) => b.id !== a.id && a.mainExhibition && b.mainExhibition === a.mainExhibition).slice(0, 6).map((b) => b.name);
  const familyMates = animals.filter((b) => b.id !== a.id && a.family && b.family === a.family).slice(0, 6).map((b) => b.name);
  const usable = CATEGORIES.filter((c) => (c !== "同じ水槽にいる魚" || tankmates.length) && (c !== "類似した仲間" || familyMates.length));
  const n = Math.min(usable.length, 3 + Math.floor(rand() * 8));
  const open = usable.map((c) => ({ c, k: rand() })).sort((x, y) => x.k - y.k).slice(0, n).map((x) => x.c);
  return {
    id: String(a.id), name: a.name, family: a.family, englishName: a.englishName, scientificName: a.scientificName,
    classification: a.classification, exhibition: a.mainExhibition, description: a.description,
    tankmates, familyMates, open: CATEGORIES.filter((c) => open.includes(c)),
  };
});

await mkdir(outDir, { recursive: true });
const size = Math.ceil(items.length / parts);
for (let i = 0; i < parts; i++) {
  const file = path.join(outDir, `input-${i + 1}.json`);
  await writeFile(file, JSON.stringify(items.slice(i * size, (i + 1) * size), null, 1));
  console.log(file, Math.min(size, items.length - i * size), "種");
}
const counts = items.map((x) => x.open.length);
console.log("開く数: 最小", Math.min(...counts), "最大", Math.max(...counts), "合計", counts.reduce((s, x) => s + x, 0));
