// 候補カード（写真・名前で探したときの「見つけた！」カード）のテスト。
// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCandidatesFlexMessage } from "../src/flexMessages.js";
import type { FishCandidate } from "../src/identifyFish.js";

const base: FishCandidate = { id: "48", name: "ジンベエザメ", imageUrl: "https://example.com/a.png", confidence: "high" };
const texts = (candidate: FishCandidate) =>
  JSON.stringify(buildCandidatesFlexMessage([candidate]).contents).match(/"text":"[^"]*"/g) ?? [];

test("展示エリアがあればカードに「🌊 ○○展示エリア」を出す", () => {
  assert.ok(texts({ ...base, exhibitionName: "太平洋" }).includes('"text":"🌊 太平洋展示エリア"'));
});

test("展示エリアが分からなければその行を出さない", () => {
  assert.ok(!texts(base).some((t) => t.includes("展示エリア")));
  assert.ok(!texts({ ...base, exhibitionName: "" }).some((t) => t.includes("展示エリア")));
});

test("複数件はカルーセルで、各カードに展示エリアが出る", () => {
  const message = buildCandidatesFlexMessage([
    { ...base, exhibitionName: "太平洋" },
    { ...base, id: "1", name: "ネコザメ", exhibitionName: "日本海溝" },
  ]);
  assert.equal(message.contents.type, "carousel");
  const json = JSON.stringify(message.contents);
  assert.ok(json.includes("🌊 太平洋展示エリア"));
  assert.ok(json.includes("🌊 日本海溝展示エリア"));
});
