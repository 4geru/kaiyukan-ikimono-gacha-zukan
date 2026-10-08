// 文字で送られた水槽（展示エリア）の名前の照合（部分一致）のテスト。19エリアのローカルデータで行う。
// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchAnimalsByName, matchExhibitionsInNames, normalizeAnimalName } from "../src/kaiyukanData.js";

const exhibitions = JSON.parse(
  readFileSync(new URL("../data/kaiyukan-exhibitions.json", import.meta.url), "utf-8"),
) as { name: string; slug: string }[];
const animals = JSON.parse(
  readFileSync(new URL("../data/kaiyukan-animals.json", import.meta.url), "utf-8"),
) as { name: string }[];
// server.ts の searchExhibitionsByName と同じ照合
const slugs = (query: string) => matchAnimalsByName(exhibitions, query, 19).map((e) => e.slug);

test("水槽の名前で当たる（完全一致・部分一致・ひらがな）", () => {
  assert.deepEqual(slugs("太平洋"), ["pacific"]);
  assert.deepEqual(slugs("グレートバリアリーフ"), ["gbr"]);
  assert.deepEqual(slugs("フォークランド"), ["falkland"]);
  assert.deepEqual(slugs("ぎゅぎゅっと"), ["gyugyutto_cute"]);
});

test("複数の水槽に当たるときは全部返す", () => {
  assert.deepEqual(slugs("日本").sort(), ["japandeep", "japanforest"]);
});

test("1文字・文章・生きものの名前は水槽に当たらない", () => {
  assert.deepEqual(slugs("海"), []);
  assert.deepEqual(slugs("太平洋の水槽にはどんな魚がいる？"), []);
  assert.deepEqual(slugs("ジンベエザメ"), []);
});

test("水槽の名前と生きものの名前はぶつからない（水槽の名前を先に判定しても魚が取られない）", () => {
  for (const exhibition of exhibitions) {
    const q = normalizeAnimalName(exhibition.name);
    const clash = animals.filter((a) => normalizeAnimalName(a.name).includes(q));
    assert.deepEqual(clash.map((a) => a.name), [], `${exhibition.name} が生きものの名前に含まれている`);
  }
});

// 写真の看板から読んだ名前（server.ts の写真の流れ → findExhibitionsInNames と同じ照合）
const fromPhoto = (names: string[]) => matchExhibitionsInNames(exhibitions, names).map((e) => e.slug);

test("写真: 看板の名前で水槽に当たる（前後に言葉が付いても・表記ゆれがあっても）", () => {
  assert.deepEqual(fromPhoto(["グレート・バリア・リーフ"]), ["gbr"]);
  assert.deepEqual(fromPhoto(["グレートバリアリーフ水槽"]), ["gbr"]);
  assert.deepEqual(fromPhoto(["グレードバリアリーフ"]), ["gbr"]); // 濁点の読み違い
  assert.deepEqual(fromPhoto(["GREAT", "太平洋"]), ["pacific"]);
});

test("写真: 同じ水槽を何度読んでも1件、読めなければ0件", () => {
  assert.deepEqual(fromPhoto(["太平洋", "太平洋水槽"]), ["pacific"]);
  assert.deepEqual(fromPhoto([]), []);
  assert.deepEqual(fromPhoto(["海"]), []);
});
