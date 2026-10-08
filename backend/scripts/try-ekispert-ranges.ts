import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadAquariums } from "../src/aquariumData.js";

// #790: search_ranges(起点駅から一定時間で行ける駅の範囲探索)の結果を水族館マスタの
// stationCodeと突き合わせ、S2(上限に近い=遠い順に並べる)が組めるかを、LLMを挟まずに確かめる。
//   npx tsx scripts/try-ekispert-ranges.ts [起点駅名] [上限分]

const MCP_URL = "https://api-mcp.ekispert.jp/mcp";

// 駅すぱあとのJSONは結果が1件のとき配列ではなく単一オブジェクトを返す(ekispert.tsと同じ癖)。
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

async function main() {
  const key = process.env.EKISPERT_API_ACCESS_KEY;
  if (!key) {
    console.error("EKISPERT_API_ACCESS_KEY が未設定です（backend/.env に設定してください）");
    process.exit(1);
  }

  const baseStation = process.argv[2] ?? "彦根";
  const upperMinutes = Number(process.argv[3] ?? 60);

  const client = new Client({ name: "try-ekispert-ranges", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { "ekispert-api-access-key": key } },
    }),
  );

  try {
    // upperMinutesは起点駅と同じ件数の配列。limitは代表所要時間の短い順に採用されるので、
    // 遠い順に並べたいS2では指定せず全件取得する。飛行機は水族館の案内に不要なので外す。
    const args = { baseList: [baseStation], upperMinutes: [upperMinutes], plane: "false" };
    console.log(`--- 呼び出し: ${JSON.stringify(args)} ---`);
    const start = Date.now();
    const result = await client.callTool({ name: "ekispert_api_search_ranges", arguments: args });
    console.log(`所要時間: ${Date.now() - start}ms / isError: ${result.isError ?? false}`);

    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    console.log(`応答サイズ: ${text.length}文字`);
    if (result.isError) {
      console.error(`ツールがエラーを返しました: ${text}`);
      // 駅名が解決できない場合にエージェントが辿る経路(get_stationsで候補を引く)を確かめる。
      const stations = await client.callTool({ name: "ekispert_api_get_stations", arguments: { name: baseStation } });
      const stationsText = (stations.content as Array<{ type: string; text?: string }>)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
      console.log(`\n--- get_stations(name: ${baseStation}) isError: ${stations.isError ?? false} / ${stationsText.length}文字 ---`);
      console.log(stationsText.slice(0, 3000));
      process.exit(1);
    }

    const body = JSON.parse(text);
    const points = toArray<any>(body.ResultSet?.Point);
    console.log(`到達駅数: ${points.length}`);
    const minutes = points.map((p) => Number(p.Cost?.Minute)).filter(Number.isFinite);
    console.log(`所要時間の範囲: ${Math.min(...minutes)}〜${Math.max(...minutes)}分 / 昇順か: ${minutes.every((m, i) => i === 0 || m >= minutes[i - 1])}`);

    // 駅コードで水族館マスタと突き合わせる(駅コードは文字列で返るのでNumberにそろえる)。
    const aquariums = await loadAquariums();
    const byCode = new Map(points.map((p) => [Number(p.Station?.code), p]));
    const matches = aquariums
      .map((aquarium) => ({ aquarium, point: aquarium.stationCode === null ? undefined : byCode.get(aquarium.stationCode) }))
      .filter((m) => m.point)
      .sort((a, b) => Number(b.point.Cost.Minute) - Number(a.point.Cost.Minute));

    console.log(`\n--- マスタ${aquariums.length}館のうち該当 ${matches.length}館（所要時間の長い順） ---`);
    for (const { aquarium, point } of matches) {
      console.log(
        `  ${point.Cost.Minute}分 / 乗換${point.Cost.TransferCount}回  ${aquarium.name}（玄関口: ${aquarium.station} ${aquarium.stationCode}）`,
      );
    }
    console.log(`\nstationCode未取得(null)の館: ${aquariums.filter((a) => a.stationCode === null).map((a) => a.name).join("、") || "なし"}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
