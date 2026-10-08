import "dotenv/config";
import {
  classifyStationAquariumIntent,
  runStationAquariumAgent,
  toPresentationResult,
} from "../src/stationAquariumAgent.js";
import { buildStationAquariumFlexMessage } from "../src/flexMessages.js";

async function testQuery(query: string) {
  console.log(`\n========================================`);
  console.log(`質問: 「${query}」`);
  console.log(`========================================`);

  const isStationQuery = await classifyStationAquariumIntent(query);
  console.log(`意図判定結果 (isStationAquariumQuery): ${isStationQuery}`);

  if (!isStationQuery) {
    console.log("-> 水族館の駅起点質問ではないため、エージェントは起動しません。");
    return;
  }

  console.log("-> エージェント起動中...");
  const start = Date.now();
  try {
    const result = await runStationAquariumAgent(query);
    const elapsed = Date.now() - start;
    console.log(`\nエージェント完了 (${elapsed}ms):`);
    console.log(`シナリオ: ${result.scenario}`);
    console.log(`起点駅名: ${result.baseStationName}`);
    if (result.minutes !== undefined) console.log(`指定分: ${result.minutes}`);
    if (result.clampedNotice) console.log(`丸め注記: ${result.clampedNotice}`);
    console.log(`\nカワウソ: ${result.kawausoLine}`);
    console.log(`ジンベエ: ${result.jinbeiLine}`);
    console.log(`\n水族館 (${result.aquariums.length}館):`);
    for (const a of result.aquariums) {
      console.log(
        `  - ${a.name} (${a.prefecture}) / 玄関口: ${a.station} / 直線: ${a.distanceKm ?? "-"}km / 所要時間: ${a.travelMinutes ?? "-"}分 (乗換${a.transferCount ?? "-"}回)`,
      );
    }

    const presentation = toPresentationResult(result);
    if (presentation) {
      const flex = buildStationAquariumFlexMessage(presentation);
      console.log(`\nFlexMessage 生成成功 (altText: ${flex.altText})`);
    }
  } catch (error) {
    console.error("エージェント実行エラー:", error);
  }
}

async function main() {
  const query = process.argv[2];
  if (query) {
    await testQuery(query);
    return;
  }

  // デフォルトテスト
  // 1. S1: 近い水族館
  await testQuery("神戸駅から近い水族館教えて");

  // 2. S2: 指定時間
  await testQuery("彦根駅から1時間くらいで行ける水族館");

  // 3. 雑談（意図判定でfalseになるはず）
  await testQuery("カワウソの好きな食べ物は何ですか？");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
