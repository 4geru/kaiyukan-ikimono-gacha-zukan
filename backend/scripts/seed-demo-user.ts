// LINE アカウントなしで図鑑を見せるデモ用ユーザー（uid: demo-zukan）を作る。
// Firestore の users が1人（末尾6b85）のときだけ、その人の図鑑の記録を demo-zukan にコピーする。
// 個人を特定できる値（LINE userId・表示名など）は持ち込まない。コピーするのは図鑑・クイズ履歴・レベルだけ。
// 使い方:
//   GOOGLE_CLOUD_PROJECT=kaiyukan-gacha-hackathon npx tsx scripts/seed-demo-user.ts --dry   # 中身の確認だけ
//   GOOGLE_CLOUD_PROJECT=kaiyukan-gacha-hackathon npx tsx scripts/seed-demo-user.ts         # 書き込み
// 図鑑は全体の8割（243種のうち195種）が埋まった状態にする。コピー元に無い分は、海遊館のデータから決まった順で足す。
// 知識欄（knowledgeUnlocked）は data/demo-knowledge.json の文で埋める（1種3〜10個が開いた状態。残りのカテゴリは false = 🔒）。
//   demo-knowledge.json は scripts/prepare-demo-knowledge.mjs の入力をもとに作った文をまとめたもの。
import { readFile } from "node:fs/promises";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../src/firestore.js";

const FILL_RATIO = 0.8;

const DEMO_UID = "demo-zukan";
const dry = process.argv.includes("--dry");

// users/{uid} 本体で持ち込んでよいフィールド（図鑑の表示に要るものだけ）
const USER_FIELDS = ["quizProfile", "discoveredCount", "createdAt", "updatedAt"];

const users = (await db.collection("users").get()).docs.filter((d) => d.id !== DEMO_UID);
if (users.length !== 1 || !users[0].id.endsWith("6b85")) {
  console.error(`コピー元のユーザーが1人（末尾6b85）ではないため中止します（${users.length}件）`);
  process.exit(1);
}
const src = users[0];
const srcData = src.data();
console.log("users 本体のフィールド:", Object.keys(srcData).join(", "));

const userDoc: Record<string, unknown> = { demo: true };
for (const key of USER_FIELDS) if (key in srcData) userDoc[key] = srcData[key];

const collection = await src.ref.collection("collection").get();
console.log("collection:", collection.size, "件 / フィールド:", Object.keys(collection.docs[0]?.data() ?? {}).join(", "));

const animals = await src.ref.collection("animals").listDocuments();
const histories: { animalId: string; id: string; data: FirebaseFirestore.DocumentData }[] = [];
for (const animal of animals) {
  const snap = await animal.collection("quizHistory").get();
  for (const h of snap.docs) histories.push({ animalId: animal.id, id: h.id, data: h.data() });
}
console.log("quizHistory:", histories.length, "件");

// 値の中に元の uid が紛れていないか確かめる
const leak = JSON.stringify([userDoc, collection.docs.map((d) => d.data()), histories.map((h) => h.data)]).includes(src.id);
if (leak) {
  console.error("コピーする値の中に元の uid が含まれているため中止します");
  process.exit(1);
}

// 8割まで埋める分（コピー元に無い種を、id の順に足す。発見日は直近30日に散らす）
const animals243 = JSON.parse(await readFile(new URL("../data/kaiyukan-animals.json", import.meta.url), "utf-8")) as { id: string | number; name: string }[];
const target = Math.ceil(animals243.length * FILL_RATIO);
const have = new Set(collection.docs.map((d) => d.id));
// 決まった種（seed）で混ぜてから選ぶ。展示エリアが偏らないよう、ばらけた8割にする
let seed = 20261010;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffled = animals243.filter((a) => !have.has(String(a.id))).map((a) => ({ a, k: rand() })).sort((x, y) => x.k - y.k).map((x) => x.a);
const extra = shuffled.slice(0, Math.max(0, target - have.size));
// 知識欄: クイズと同じ13カテゴリ。開いているものは文、まだのものは false
const QUIZ_CATEGORIES = ["生息地", "水域", "水温", "深度", "郷土料理", "類似した仲間", "同じ水槽にいる魚", "特徴", "豆知識", "進化の歴史", "食物連鎖", "ダジャレ", "海外の小ネタ"];
const knowledge = JSON.parse(await readFile(new URL("../data/demo-knowledge.json", import.meta.url), "utf-8")) as Record<string, Record<string, string>>;
const knowledgeFor = (id: string) => Object.fromEntries(QUIZ_CATEGORIES.map((c) => [c, knowledge[id]?.[c] ?? false]));
const base = Date.now();
const extraDocs = extra.map((a, i) => {
  const t = Timestamp.fromMillis(base - ((i * 37) % 30) * 86_400_000 - i * 60_000);
  return { id: String(a.id), data: { name: a.name, firstFoundAt: t, updatedAt: t, rarity: "unknown", knowledgeUnlocked: knowledgeFor(String(a.id)), completed: false, askedQuizCategories: [] } };
});
const opened = [...have, ...extraDocs.map((d) => d.id)].map((id) => Object.values(knowledgeFor(id)).filter(Boolean).length);
console.log(`知識欄: 開いている数 最小 ${Math.min(...opened)} / 最大 ${Math.max(...opened)}（知識の文が無い種 ${opened.filter((n) => n === 0).length} 件）`);
console.log(`8割まで足す分: ${extraDocs.length} 件（合計 ${have.size + extraDocs.length} / ${animals243.length}）`);
if (dry) {
  console.log("--dry のため書き込みません");
  process.exit(0);
}

const demoRef = db.collection("users").doc(DEMO_UID);
// 前回足した分のうち、今回選ばれなかったものは消す（コピー元の分は残る）
const keep = new Set([...have, ...extraDocs.map((d) => d.id)]);
const old = await demoRef.collection("collection").listDocuments();
const stale = old.filter((d) => !keep.has(d.id));
for (let i = 0; i < stale.length; i += 400) {
  const del = db.batch();
  stale.slice(i, i + 400).forEach((d) => del.delete(d));
  await del.commit();
}
console.log(`前回分から外した: ${stale.length} 件`);
let batch = db.batch();
let n = 0;
const flush = async () => {
  await batch.commit();
  batch = db.batch();
  n = 0;
};
batch.set(demoRef, userDoc);
n++;
for (const d of collection.docs) {
  batch.set(demoRef.collection("collection").doc(d.id), { ...d.data(), knowledgeUnlocked: knowledgeFor(d.id) });
  if (++n >= 400) await flush();
}
for (const d of extraDocs) {
  batch.set(demoRef.collection("collection").doc(d.id), d.data);
  if (++n >= 400) await flush();
}
for (const h of histories) {
  batch.set(demoRef.collection("animals").doc(h.animalId).collection("quizHistory").doc(h.id), h.data);
  if (++n >= 400) await flush();
}
await flush();
console.log(`demo-zukan に書き込みました（図鑑 ${collection.size + extraDocs.length} 件・クイズ履歴 ${histories.length} 件）`);
