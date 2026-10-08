// 文字で送られた名前の照合（部分一致）のテスト。照合は海遊館243種のローカルデータ（data/kaiyukan-animals.json）で行う。
// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchAnimalsByName, normalizeAnimalName } from "../src/kaiyukanData.js";

const animals = JSON.parse(
  readFileSync(new URL("../data/kaiyukan-animals.json", import.meta.url), "utf-8"),
) as { id: string; name: string }[];
const names = (query: string, limit?: number) => matchAnimalsByName(animals, query, limit).map((a) => a.name);

test("表記ゆれをそろえる（ひらがな・半角カナ・濁点・<br>・空白）", () => {
  assert.equal(normalizeAnimalName("じんべえざめ"), normalizeAnimalName("ジンベエザメ"));
  assert.equal(normalizeAnimalName("ｼﾞﾝﾍﾞｴｻﾞﾒ"), normalizeAnimalName("ジンベエザメ"));
  assert.equal(normalizeAnimalName("ジンベエザメ"), normalizeAnimalName("ジンヘエサメ"));
  assert.equal(normalizeAnimalName("ミナミイワトビ<br>ペンギン"), normalizeAnimalName("ミナミイワトビ ペンギン"));
});

test("完全一致は1件だけ返す", () => {
  assert.deepEqual(names("マンボウ"), ["マンボウ"]);
  assert.deepEqual(names("ジンベエザメ"), ["ジンベエザメ"]);
});

test("ひらがな・半角カナの途中までの入力でも当たる", () => {
  assert.deepEqual(names("じんべえ"), ["ジンベエザメ"]);
  assert.deepEqual(names("ｼﾞﾝﾍﾞｴ"), ["ジンベエザメ"]);
});

test("部分一致: 「サメ」で濁点つきの「〜ザメ」も当たる", () => {
  const sharks = names("サメ", 50);
  assert.ok(sharks.includes("ジンベエザメ"));
  assert.ok(sharks.length > 10);
  assert.ok(sharks.every((n) => normalizeAnimalName(n).includes(normalizeAnimalName("サメ"))));
});

test("<br> 入りの名前にも当たる", () => {
  assert.deepEqual(names("ミナミイワトビペンギン"), ["ミナミイワトビ<br>ペンギン"]);
});

test("並び順: 完全一致 → 前方一致 → 短い名前", () => {
  const rays = names("エイ", 50);
  assert.equal(rays[0], "エイラクブカ"); // 前方一致が先
  const rest = rays.slice(1).map((n) => normalizeAnimalName(n).length);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b)); // 残りは短い順
});

test("件数の上限を守る", () => {
  assert.equal(names("サメ", 10).length, 10);
  assert.equal(names("サメ", 3).length, 3);
});

test("1文字だけ・文章・駅の質問は当たらない（今までどおり雑談・駅の判定へ回る）", () => {
  assert.deepEqual(names("ア"), []);
  assert.deepEqual(names("こんにちは"), []);
  assert.deepEqual(names("ジンベエザメってどれくらい大きいの？"), []);
  assert.deepEqual(names("梅田駅から1時間で行ける水族館"), []);
});
