import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import {
  buildFindAquariumsByTravelTimeTool,
  buildSearchStationsTool,
  connectMcpClient,
  createMcpClient,
} from "../src/stationAquariumAgent.js";

// 駅すぱあと MCP の生のレスポンスと、FunctionTool が LLM に返す内容のサイズを比べる（記事 #823 用）。
// LLM による生成は行わない。トークン数は Gemini の countTokens API で数える。
// 実行: npx tsx scripts/measure-ekispert-response-size.ts

const MODEL = process.env.QUIZ_AGENT_MODEL ?? "gemini-2.5-flash";

const CASES = [
  { station: "彦根", minutes: 60 },
  { station: "大阪", minutes: 60 },
  { station: "神戸", minutes: 30 },
];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function countTokens(text: string): Promise<number> {
  const res = await ai.models.countTokens({ model: MODEL, contents: text });
  return res.totalTokens ?? NaN;
}

async function measure(label: string, text: string) {
  return { label, chars: text.length, bytes: Buffer.byteLength(text), tokens: await countTokens(text) };
}

function rawText(res: Awaited<ReturnType<ReturnType<typeof createMcpClient>["callTool"]>>): string {
  return (res.content as Array<{ type: string; text?: string }>)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

async function main() {
  const accessKey = process.env.EKISPERT_API_ACCESS_KEY;
  if (!accessKey) throw new Error("EKISPERT_API_ACCESS_KEY が設定されていません");

  const client = createMcpClient(accessKey);
  await connectMcpClient(client, accessKey);
  const searchStations = buildSearchStationsTool(client);
  const findByTravelTime = buildFindAquariumsByTravelTimeTool(client);

  try {
    for (const { station, minutes } of CASES) {
      // 駅の検索: 生の get_stations と searchStations の返り値
      const rawStations = rawText(
        await client.callTool({
          name: "ekispert_api_get_stations",
          arguments: { name: station, simplify: "false", gcs: "wgs84", type: "train" },
        }),
      );
      const toolStations = (await searchStations.runAsync({ args: { name: station } } as any)) as {
        stations: Array<{ name: string; code: number }>;
      };
      const base = toolStations.stations[0];

      // 到達範囲: 生の search_ranges と findAquariumsByTravelTime の返り値
      const rawRangesText = rawText(
        await client.callTool({
          name: "ekispert_api_search_ranges",
          arguments: { baseList: [String(base.code)], upperMinutes: [minutes], plane: "false" },
        }),
      );
      const rawPoints = JSON.parse(rawRangesText).ResultSet?.Point;
      const pointCount = Array.isArray(rawPoints) ? rawPoints.length : rawPoints ? 1 : 0;
      const toolRanges = (await findByTravelTime.runAsync({
        args: { baseStationNameOrCode: String(base.code), upperMinutes: minutes },
      } as any)) as { aquariums: Array<{ name: string }> };

      const rows = [
        await measure("get_stations（生）", rawStations),
        await measure("searchStations（返り値）", JSON.stringify(toolStations)),
        await measure("search_ranges（生）", rawRangesText),
        await measure("findAquariumsByTravelTime（返り値）", JSON.stringify(toolRanges)),
      ];

      console.log(`\n## ${station}駅から${minutes}分（起点: ${base.name} / 到達駅 ${pointCount}件 → 水族館 ${toolRanges.aquariums.length}件: ${toolRanges.aquariums.map((a) => a.name).join("、")}）`);
      console.log("| 対象 | 文字数 | バイト | トークン |");
      console.log("| --- | ---: | ---: | ---: |");
      for (const r of rows) console.log(`| ${r.label} | ${r.chars} | ${r.bytes} | ${r.tokens} |`);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
