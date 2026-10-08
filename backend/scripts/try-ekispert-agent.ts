import "dotenv/config";
import { z } from "zod/v3";
import { Agent, InMemoryRunner, MCPToolset, isFinalResponse } from "@google/adk";
import { findNearestAquariums } from "../src/aquariumData.js";
import { findNearestStation, searchRoute } from "../src/ekispert.js";
import { toJstDateTime } from "../src/nearestAquarium.js";

// ADKエージェントがekispert MCPを自分で呼んで経路を出せるかの検証。
// 本番(nearestAquarium.ts)のREST直呼びと同じ入力で走らせ、結果と所要時間を並べて比較する。
//   npx tsx scripts/try-ekispert-agent.ts [緯度 経度]   (既定: 梅田付近)

const MCP_URL = "https://api-mcp.ekispert.jp/mcp";
const MODEL = process.env.QUIZ_AGENT_MODEL ?? "gemini-2.5-flash";

const routeSchema = z.object({
  found: z.boolean().describe("経路を取得できたらtrue。ツールが失敗した・駅が見つからない場合はfalse"),
  fromStationName: z.string().optional().describe("現在地の最寄り鉄道駅名"),
  minutes: z.number().optional().describe("所要時間(分)。ツールの結果に書かれた値だけを使う"),
  transferCount: z.number().optional().describe("乗換回数"),
  fareYen: z.number().optional().describe("片道運賃(円)"),
});

const INSTRUCTION = `あなたは駅すぱあとのツールを使う経路案内エージェントです。
現在地の緯度経度と目的の駅が渡されるので、次を行ってください。
1. 現在地から最寄りの鉄道駅を、周辺駅検索のツールで探す（鉄道駅のみ・測地系はwgs84・半径1500m・1件）
2. その駅から目的の駅までの経路を、経路探索のツールで探す（出発日時は渡された値、駅はコードで指定する）
3. ツールの結果に書かれている値だけを使って回答する。推測で数値を作らない。取得できなければ found=false にする`;

async function runAgent(lat: number, lng: number, station: { name: string; code: number }) {
  const { date, time } = toJstDateTime(new Date());
  const toolset = new MCPToolset(
    {
      type: "StreamableHTTPConnectionParams",
      url: MCP_URL,
      transportOptions: {
        requestInit: { headers: { "ekispert-api-access-key": process.env.EKISPERT_API_ACCESS_KEY ?? "" } },
      },
    },
    ["ekispert_api_get_stations_from_geo", "ekispert_api_search_routes"],
  );

  try {
    const agent = new Agent({
      name: "ekispert_route_agent",
      model: MODEL,
      instruction: INSTRUCTION,
      tools: [toolset],
      outputSchema: routeSchema,
    });
    const runner = new InMemoryRunner({ agent });

    const prompt = `現在地: 緯度${lat} 経度${lng}
目的の駅: ${station.name}（駅コード ${station.code}）
出発日時: ${date} ${time}（JST。dateはYYYYMMDD、timeはHHMM）`;

    let finalText: string | undefined;
    const toolCalls: string[] = [];
    for await (const event of runner.runEphemeral({
      userId: "try-ekispert-agent",
      newMessage: { role: "user", parts: [{ text: prompt }] },
    })) {
      for (const part of event.content?.parts ?? []) {
        if (part.functionCall) toolCalls.push(`${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`);
      }
      if (isFinalResponse(event)) {
        const text = event.content?.parts?.find((p) => "text" in p && p.text);
        if (text && "text" in text && text.text) finalText = text.text;
      }
    }
    return { toolCalls, result: finalText ? routeSchema.parse(JSON.parse(finalText)) : undefined };
  } finally {
    await toolset.close();
  }
}

async function main() {
  if (!process.env.EKISPERT_API_ACCESS_KEY) {
    console.error("EKISPERT_API_ACCESS_KEY が未設定です（backend/.env に設定してください）");
    process.exit(1);
  }

  const lat = Number(process.argv[2] ?? 34.7025);
  const lng = Number(process.argv[3] ?? 135.4959);

  const nearest = (await findNearestAquariums(lat, lng, 1))[0];
  if (!nearest || nearest.stationCode === null) {
    console.error("最寄りの水族館か、その駅コードが見つかりませんでした");
    process.exit(1);
  }
  const target = { name: nearest.station, code: nearest.stationCode };
  console.log(`現在地 (${lat}, ${lng}) → ${nearest.name}（玄関口: ${target.name}駅 ${target.code}）\n`);

  const { date, time } = toJstDateTime(new Date());

  let start = Date.now();
  const rest = await (async () => {
    const from = await findNearestStation(lat, lng);
    return { from, route: from ? await searchRoute(from.code, target.code, date, time) : undefined };
  })();
  console.log(`--- REST直呼び (${Date.now() - start}ms) ---`);
  console.log(JSON.stringify({ from: rest.from?.name, ...rest.route }, null, 2));

  start = Date.now();
  const agent = await runAgent(lat, lng, target);
  console.log(`\n--- ADK + MCP (${Date.now() - start}ms) ---`);
  console.log("ツール呼び出し:");
  agent.toolCalls.forEach((call) => console.log(`  ${call}`));
  console.log(JSON.stringify(agent.result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
