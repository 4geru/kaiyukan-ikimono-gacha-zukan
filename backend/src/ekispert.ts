import { logEvent } from "./log.js";
const BASE_URL = "https://api.ekispert.jp/v1/json";
const TIMEOUT_MS = 3500;

export interface NearestStation {
  code: number;
  name: string;
  distanceM: number;
}

export interface RouteSummary {
  minutes: number;
  transferCount: number;
  fareYen?: number;
}

// 駅すぱあとのJSONは結果が1件のとき配列ではなく単一オブジェクトを返す。
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function toNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// 失敗は全てundefinedで表す（呼び出し側のフォールバックをifだけで書けるようにするため）。
// アクセスキーはクエリパラメータに載るので、URLやレスポンス本文はログに出さない。
async function callApi(path: string, params: Record<string, string>): Promise<any | undefined> {
  const key = process.env.EKISPERT_API_ACCESS_KEY;
  if (!key) return undefined;

  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      logEvent("ekispert_api_error", { path, status: res.status, message: "駅すぱあとAPIがエラーを返しました" }, "WARNING");
      return undefined;
    }
    return await res.json();
  } catch (error) {
    logEvent("ekispert_api_failed", { path, errorName: error instanceof Error ? error.name : "unknown", message: "駅すぱあとAPIの呼び出しに失敗しました" }, "WARNING");
    return undefined;
  }
}

export async function findNearestStation(lat: number, lng: number): Promise<NearestStation | undefined> {
  const body = await callApi("geo/station", {
    // 測地系はWGS84を明示する（LINEの位置情報はGPS=WGS84）
    geoPoint: `${lat},${lng},wgs84,1500`,
    type: "train",
    stationCount: "1",
  });
  if (!body) return undefined;

  const point = toArray<any>(body.ResultSet?.Point)[0];
  const code = toNumber(point?.Station?.code);
  const name = point?.Station?.Name;
  if (code === undefined || typeof name !== "string") return undefined;

  return { code, name, distanceM: toNumber(point?.Distance) ?? 0 };
}

export async function searchRoute(
  fromStationCode: number,
  toStationCode: number,
  date: string,
  time: string,
): Promise<RouteSummary | undefined> {
  const body = await callApi("search/course/extreme", {
    viaList: `${fromStationCode}:${toStationCode}`,
    date,
    time,
    searchType: "departure",
    answerCount: "1",
  });
  if (!body) return undefined;

  const course = toArray<any>(body.ResultSet?.Course)[0];
  const route = course?.Route;
  if (!route) return undefined;

  // 所要時間は乗車・徒歩・その他(乗換待ち等)の3要素合算。timeOtherを落とすと実際の発着時刻差と合わない
  // （design.md 1.5節で実測確認済み）。
  const minutes =
    (toNumber(route.timeOnBoard) ?? 0) + (toNumber(route.timeWalk) ?? 0) + (toNumber(route.timeOther) ?? 0);
  if (minutes <= 0) return undefined;

  const fareSummary = toArray<any>(course.Price).find((price) => price?.kind === "FareSummary");

  return {
    minutes,
    transferCount: toNumber(route.transferCount) ?? 0,
    fareYen: toNumber(fareSummary?.Oneway),
  };
}
