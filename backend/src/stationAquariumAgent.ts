import "dotenv/config";
import { z } from "zod/v3";
import { Agent, InMemoryRunner, FunctionTool, isFinalResponse } from "@google/adk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GoogleGenAI, Type } from "@google/genai";
import { loadAquariums, findNearestAquariums } from "./aquariumData.js";
import type { StationAquariumItem, StationAquariumResultPresentation } from "./flexMessages.js";
import { runAgent, withLlmLog, withToolLog, type AgentRunContext, type AgentRunRecord } from "./agentRun.js";
import { buildUserInput, extractJsonObject, INJECTION_GUARD_NOTICE, isSafeCharacterLine, stripUrls } from "./guards.js";
import { logEvent } from "./log.js";

const MCP_URL = "https://api-mcp.ekispert.jp/mcp";
const MODEL = process.env.QUIZ_AGENT_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 25000;
export const STATION_PROMPT_VERSION = "station-v2";

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

// ---------------------------------------------------------------------------
// 1. 意図判定（Intent Classifier）
// ---------------------------------------------------------------------------

const intentResponseSchema = {
  type: Type.OBJECT,
  properties: {
    isStationAquariumQuery: {
      type: Type.BOOLEAN,
      description:
        "駅や地名を起点に水族館（近い水族館、○分・○時間で行ける水族館）を尋ねる意図であればtrue。それ以外の雑談や生きものの質問はfalse",
    },
  },
  required: ["isStationAquariumQuery"],
};

const INTENT_SYSTEM_INSTRUCTION = `あなたはメッセージの意図を分類する分類器です。
ユーザーのメッセージが「駅や地名を起点にして水族館を尋ねる質問（例: ○○駅に近い水族館、○○駅から○分で行ける水族館、○○周辺の水族館）」であるかを判定してください。
- 該当する例:
  - 「神戸駅から近い水族館」
  - 「大阪駅の近くの水族館教えて」
  - 「彦根駅から1時間くらいで行ける水族館」
  - 「京都駅から30分以内の水族館ある？」
  - 「天王寺から電車で行ける水族館」
- 該当しない例:
  - 「こんにちは」
  - 「カワウソって魚食べるの？」
  - 「海遊館のジンベエザメ見たい」
  - 「大阪駅への行き方教えて」
  - 「水族館に行きたいな」${INJECTION_GUARD_NOTICE}`;

let genAiClient: GoogleGenAI | undefined;

function getGenAiClient(): GoogleGenAI {
  if (genAiClient) return genAiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");
  genAiClient = new GoogleGenAI({ apiKey });
  return genAiClient;
}

export async function classifyStationAquariumIntent(userMessage: string): Promise<boolean> {
  const ai = getGenAiClient();
  try {
    const contents = buildUserInput(userMessage);
    const response = await withLlmLog("intent", MODEL, contents.length, () =>
      ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction: INTENT_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: intentResponseSchema,
        },
      }),
    );

    if (!response.text) return false;
    const parsed = JSON.parse(response.text) as { isStationAquariumQuery?: boolean };
    return Boolean(parsed.isStationAquariumQuery);
  } catch (error) {
    // llm_call(ok=false)に記録済み。JSONの解析失敗などここで落ちた場合のみ追加で残す
    logEvent("intent_classify_failed", { error }, "WARNING");
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. 出力スキーマと結果インターフェース
// ---------------------------------------------------------------------------

export const stationAquariumOutputSchema = z.object({
  scenario: z.enum(["nearest", "travel_time", "not_found"]).describe("実行したシナリオ"),
  baseStationName: z.string().describe("実際に起点として使った駅名（例: 神戸(兵庫県)、大阪、彦根など）"),
  minutes: z.number().optional().describe("S2の場合の上限所要時間（分）"),
  clampedNotice: z.string().optional().describe("S2で時間を丸めた場合の注記メッセージ"),
  aquariums: z
    .array(
      z.object({
        name: z.string().describe("水族館名（マスタの値のみ使用）"),
        prefecture: z.string(),
        address: z.string(),
        station: z.string().describe("玄関口駅"),
        stationCode: z.number().nullable(),
        access: z.string(),
        url: z.string(),
        distanceKm: z.number().optional().describe("S1の場合の起点駅からの直線距離(km)"),
        travelMinutes: z.number().optional().describe("S2の場合の起点駅からの所要時間(分)"),
        transferCount: z.number().optional().describe("S2の場合の乗換回数"),
      }),
    )
    .max(3),
  kawausoLine: z.string().describe("カワウソ助教授のセリフ（テンポよく元気、語尾「〜っす」）"),
  jinbeiLine: z
    .string()
    .describe(
      "ジンベエ名誉教授のセリフ（長老、語尾「〜じゃ」「〜のう」。所要時間は電車のみであること、あるいは0件時の提案など）",
    ),
});

export type StationAquariumAgentResult = z.infer<typeof stationAquariumOutputSchema>;

// ---------------------------------------------------------------------------
// 3. エージェント用ツールの作成
// ---------------------------------------------------------------------------

export function createMcpClient(accessKey: string): Client {
  return new Client({ name: "station-aquarium-agent", version: "1.0.0" });
}

export async function connectMcpClient(client: Client, accessKey: string): Promise<void> {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { "ekispert-api-access-key": accessKey } },
    }),
  );
}

export function buildSearchStationsTool(mcpClient: Client, ctx?: AgentRunContext) {
  return new FunctionTool({
    name: "searchStations",
    description:
      "駅すぱあとMCPで駅名候補を検索する。同名駅や表記ゆれがある場合は候補一覧が返るので、関西圏（兵庫県・大阪府・京都府・滋賀県・奈良県・和歌山県など）の水族館を案内するのに最適な駅を1つ選択すること。",
    parameters: z.object({
      name: z.string().describe("検索したい駅名（例: 神戸、大阪、彦根）"),
    }),
    // 引数の駅名は利用者の発言に由来しうるのでログには出さない（件数だけ）
    execute: withToolLog(ctx, "searchStations", async ({ name }: { name: string }) => {
      try {
        // requirements: gcs(wgs84), types(["train"])など結果を左右するツール引数をコード側で固定
        const res = await mcpClient.callTool({
          name: "ekispert_api_get_stations",
          arguments: { name, simplify: "false", gcs: "wgs84", type: "train" },
        });

        if (res.isError) {
          return { error: "駅の検索に失敗しました", stations: [] };
        }

        const text = (res.content as Array<{ type: string; text?: string }>)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("");

        const body = JSON.parse(text);
        const points = toArray<any>(body.ResultSet?.Point);
        const stations = points.map((p) => ({
          name: p.Station?.Name ?? "",
          code: Number(p.Station?.code),
          prefecture: p.Prefecture?.Name ?? "",
          latitude: Number(p.GeoPoint?.lati_d),
          longitude: Number(p.GeoPoint?.longi_d),
        }));

        return { stations };
      } catch (error) {
        return { error: String(error), stations: [] };
      }
    }),
  });
}

function buildFindAquariumsNearGeoTool(ctx?: AgentRunContext) {
  return new FunctionTool({
    name: "findAquariumsNearStationGeo",
    description:
      "S1用: 起点駅の緯度経度から、関西15水族館マスタの中で直線距離（Haversine）が近い順にトップ3を取得する。",
    parameters: z.object({
      latitude: z.number().describe("起点駅の緯度(wgs84)"),
      longitude: z.number().describe("起点駅の経度(wgs84)"),
    }),
    // 緯度経度はログに出さない
    execute: withToolLog(ctx, "findAquariumsNearStationGeo", async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      const nearest = await findNearestAquariums(latitude, longitude, 3);
      return {
        aquariums: nearest.map((a) => ({
          name: a.name,
          prefecture: a.prefecture,
          address: a.address,
          station: a.station,
          stationCode: a.stationCode,
          access: a.access,
          url: a.url,
          distanceKm: Number(a.distanceKm.toFixed(1)),
        })),
      };
    }),
  });
}

export function buildFindAquariumsByTravelTimeTool(mcpClient: Client, ctx?: AgentRunContext) {
  return new FunctionTool({
    name: "findAquariumsByTravelTime",
    description:
      "S2用: 起点駅（駅コードまたは駅名）から指定時間（分）以内に行ける水族館を検索する。検索範囲は10〜200分に自動調整され、到達可能な水族館を所要時間の長い順（上限に近い順）に最大3館返す。",
    parameters: z.object({
      baseStationNameOrCode: z
        .string()
        .describe("起点駅の駅コード（推奨）または駅名。searchStationsで特定した値を使う"),
      upperMinutes: z.number().describe("希望の上限所要時間（分）。例: 1時間は60、1時間半は90"),
    }),
    execute: withToolLog(ctx, "findAquariumsByTravelTime", async ({ baseStationNameOrCode, upperMinutes }: { baseStationNameOrCode: string; upperMinutes: number }) => {
      let clampedMinutes = upperMinutes;
      let clampedNotice: string | undefined;

      // requirements: 指定時間がsearch_rangesの許容範囲（10〜200分）外なら範囲内に丸める
      if (upperMinutes < 10) {
        clampedMinutes = 10;
        clampedNotice = "駅すぱあとの検索範囲（10〜200分）に合わせて、10分で検索したぞい。";
      } else if (upperMinutes > 200) {
        clampedMinutes = 200;
        clampedNotice = "駅すぱあとの検索範囲（10〜200分）に合わせて、200分で検索したぞい。";
      }

      try {
        const res = await mcpClient.callTool({
          name: "ekispert_api_search_ranges",
          arguments: {
            baseList: [baseStationNameOrCode],
            upperMinutes: [clampedMinutes],
            plane: "false",
          },
        });

        if (res.isError) {
          return { error: "到達範囲の探索に失敗しました", aquariums: [], clampedNotice };
        }

        const text = (res.content as Array<{ type: string; text?: string }>)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("");

        const body = JSON.parse(text);
        const points = toArray<any>(body.ResultSet?.Point);

        const aquariums = await loadAquariums();
        const byCode = new Map<number, any>();
        for (const p of points) {
          const code = Number(p.Station?.code);
          if (Number.isFinite(code)) {
            byCode.set(code, p);
          }
        }

        const matches = aquariums
          .map((aquarium) => ({
            aquarium,
            point: aquarium.stationCode === null ? undefined : byCode.get(aquarium.stationCode),
          }))
          .filter((m) => m.point)
          .sort((a, b) => Number(b.point.Cost.Minute) - Number(a.point.Cost.Minute))
          .slice(0, 3);

        const resultAquariums = matches.map(({ aquarium, point }) => ({
          name: aquarium.name,
          prefecture: aquarium.prefecture,
          address: aquarium.address,
          station: aquarium.station,
          stationCode: aquarium.stationCode,
          access: aquarium.access,
          url: aquarium.url,
          travelMinutes: Number(point.Cost.Minute),
          transferCount: Number(point.Cost.TransferCount ?? 0),
        }));

        return {
          foundCount: resultAquariums.length,
          clampedMinutes,
          clampedNotice,
          aquariums: resultAquariums,
        };
      } catch (error) {
        return { error: String(error), aquariums: [], clampedNotice };
      }
    }, { logArgs: ({ upperMinutes }) => ({ minutes: upperMinutes }) }),
  });
}

// ---------------------------------------------------------------------------
// 4. エージェントのプロンプトと実行
// ---------------------------------------------------------------------------

const INSTRUCTION = `あなたは関西の水族館を案内する調査エージェントです。
ユーザーから「〇〇駅に近い水族館」または「〇〇駅から△分（時間）くらいで行ける水族館」という質問が届きます。
以下の手順に従って調査を行い、結果を構造化して出力してください。

1. 【起点駅の特定】
   - searchStations ツールを呼び出し、ユーザーが指定した駅名（例: 神戸、大阪、彦根）で検索してください。
   - 同名駅や表記ゆれがある場合は、関西圏（兵庫県・大阪府・京都府・滋賀県・奈良県・和歌山県）の水族館案内として最も自然な駅（例: 神戸なら「神戸(兵庫県)」）をあなたの判断で1つ選んでください。曖昧さの解決ルールを固定せず、文脈に応じて自律的に判断してください。
   - 選定した駅の名前（Name）と駅コード（code）、緯度経度を把握してください。

2. 【水族館の検索】
   - S1: 「〇〇駅に近い水族館」「近くの水族館」「調べて」などの場合:
     findAquariumsNearStationGeo ツールに特定した駅の緯度経度を渡し、直線距離で近い水族館トップ3を取得してください。
   - S2: 「〇〇駅から△分（時間）くらいで行ける水族館」の場合:
     「1時間」は60分、「1時間半」は90分のように分単位に換算してください。
     findAquariumsByTravelTime ツールに特定した駅コード（文字列）と指定時間（分）を渡し、所要時間で行ける水族館を取得してください。

3. 【回答の作成】
   - ツールの結果に書かれている値だけを使って回答してください。水族館名や数値を推測で捏造しないでください。
   - baseStationName には、実際に起点として使った駅名（例: 「神戸(兵庫県)」や「彦根」）を設定してください。
   - kawausoLine: カワウソ助教授のセリフ（テンポよく元気、語尾「〜っす」）。調査完了を元気に報告してください。
   - jinbeiLine: ジンベエ名誉教授のセリフ（長老、語尾「〜じゃ」「〜のう」）。
     - S1の場合: 直線距離での順位であることや、お勧めの言葉を添えてください。
     - S2の場合: 「起点駅からの電車の所要時間じゃ。玄関口駅からのバスや徒歩の時間は含んでおらんので気をつけるのじゃぞ。」と必ず注意を明記してください。
     - 時間の丸め注記（clampedNotice）がある場合は、セリフに含めてください。
     - 水族館が0件の場合は、時間を延ばして探す提案をしてください。${INJECTION_GUARD_NOTICE}`;

export async function runStationAquariumAgent(
  userMessage: string,
  opts: { onFinish?: (record: AgentRunRecord) => void | Promise<void> } = {},
): Promise<StationAquariumAgentResult> {
  // 25秒の打ち切り・agent_run の出力は runAgent が行う（#832）。キー未設定も agent_run に残すため中で投げる
  return runAgent(
    { agent: "station", model: MODEL, promptVersion: STATION_PROMPT_VERSION, timeoutMs: TIMEOUT_MS, onFinish: opts.onFinish },
    async (ctx) => {
      const accessKey = process.env.EKISPERT_API_ACCESS_KEY;
      if (!accessKey) {
        throw new Error("EKISPERT_API_ACCESS_KEY が設定されていません");
      }

      const mcpClient = createMcpClient(accessKey);
      await connectMcpClient(mcpClient, accessKey);

      try {
        const agent = new Agent({
          name: "station_aquarium_agent",
          model: MODEL,
          instruction: INSTRUCTION,
          tools: [
            buildSearchStationsTool(mcpClient, ctx),
            buildFindAquariumsNearGeoTool(ctx),
            buildFindAquariumsByTravelTimeTool(mcpClient, ctx),
          ],
          outputSchema: stationAquariumOutputSchema,
        });

        const runner = new InMemoryRunner({ agent });

        let finalText: string | undefined;
        for await (const event of runner.runEphemeral({
          userId: "station-aquarium-agent",
          newMessage: { role: "user", parts: [{ text: buildUserInput(userMessage) }] },
        })) {
          if (!event.author || event.author === "user") continue;
          if (!event.partial) ctx.addUsage(event.usageMetadata);
          if (isFinalResponse(event)) {
            const textPart = event.content?.parts?.find((p) => "text" in p && p.text);
            if (textPart && "text" in textPart && textPart.text) {
              finalText = textPart.text;
            }
          }
        }

        if (!finalText) {
          throw new Error("ADKエージェントからの最終レスポンスが空でした");
        }

        let result: StationAquariumAgentResult;
        try {
          result = stationAquariumOutputSchema.parse(JSON.parse(extractJsonObject(finalText)));
        } catch {
          // 断りの文章などで JSON が返らなかったときは、見つからなかった扱いの決まった返事にする（試験 #9・#17）
          ctx.guard("schema_invalid", "fell_back", "出力がスキーマに合いません");
          result = UNREADABLE_OUTPUT_RESULT;
        }
        result = await sanitizeStationResult(result, ctx);

        ctx.setDecision({
          scenario: result.scenario,
          baseStation: result.baseStationName,
          minutes: result.minutes ?? null,
          clamped: Boolean(result.clampedNotice),
          toolOrder: [...ctx.toolOrder],
          resultCount: result.aquariums.length,
          aquariums: result.aquariums.map((a) => a.name),
        });
        ctx.setMessage(
          `駅の水族館エージェントが「${result.baseStationName}」を起点に${result.aquariums.length}件を選びました (${result.scenario})`,
        );
        return result;
      } finally {
        await mcpClient.close().catch(() => {});
      }
    },
  );
}

// 出力の後始末: 水族館はマスタにある名前だけ残して住所・URL などをマスタの値で上書きし、
// セリフからは URL を外す。口調が崩れたセリフは決まったセリフに差し替える（#833 の試験 #8 への対策）
const UNREADABLE_OUTPUT_RESULT: StationAquariumAgentResult = {
  scenario: "not_found",
  baseStationName: "",
  aquariums: [],
  kawausoLine: "うーん、うまく調べられなかったっす……！",
  jinbeiLine: "ふむ、駅の名前を入れて、もう一度聞いておくれ。",
};

const SAFE_STATION_LINE = {
  kawausoLine: "調査完了っす！見つかった水族館を並べたっす！",
  jinbeiLine: "ふむ、気をつけて行ってくるのじゃぞ。",
} as const;

async function sanitizeStationResult(
  result: StationAquariumAgentResult,
  ctx: { guard(guard: "output_sanitized" | "tone_broken", action: "replaced", detail?: string): void },
): Promise<StationAquariumAgentResult> {
  const master = new Map((await loadAquariums()).map((a) => [a.name, a]));
  const aquariums = result.aquariums.flatMap((a) => {
    const m = master.get(a.name);
    if (!m) return [];
    return [{ ...a, prefecture: m.prefecture, address: m.address, station: m.station, stationCode: m.stationCode, access: m.access, url: m.url }];
  });
  if (aquariums.length !== result.aquariums.length) ctx.guard("output_sanitized", "replaced", "unknown_aquarium");

  const clean = (key: "kawausoLine" | "jinbeiLine", character: "kawauso" | "dr-jinbei"): string => {
    const { text, removed } = stripUrls(result[key]);
    if (removed) ctx.guard("output_sanitized", "replaced", `url:${key}`);
    if (!text || !isSafeCharacterLine(character, text)) {
      ctx.guard("tone_broken", "replaced", key);
      return SAFE_STATION_LINE[key];
    }
    return text;
  };
  return {
    ...result,
    aquariums,
    kawausoLine: clean("kawausoLine", "kawauso"),
    jinbeiLine: clean("jinbeiLine", "dr-jinbei"),
  };
}

// ---------------------------------------------------------------------------
// 5. Flexメッセージ組み立て用ヘルパー
// ---------------------------------------------------------------------------

export function toPresentationResult(
  result: StationAquariumAgentResult,
): StationAquariumResultPresentation | undefined {
  if (result.scenario === "not_found" || result.aquariums.length === 0) {
    return undefined;
  }

  const items: StationAquariumItem[] = result.aquariums.map((a) => ({
    name: a.name,
    prefecture: a.prefecture,
    address: a.address,
    station: a.station,
    access: a.access,
    url: a.url,
    distanceKm: a.distanceKm,
    travelMinutes: a.travelMinutes,
    transferCount: a.transferCount,
  }));

  return {
    scenario: result.scenario === "travel_time" ? "travel_time" : "nearest",
    baseStationName: result.baseStationName,
    aquariums: items,
  };
}
