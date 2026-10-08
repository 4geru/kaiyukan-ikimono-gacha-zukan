import { findNearestAquariums, type NearbyAquarium } from "./aquariumData.js";
import { findNearestStation, searchRoute } from "./ekispert.js";

// 対応エリア(関西)から離れていると判断する直線距離のしきい値。
const FAR_AWAY_KM = 100;
const CANDIDATE_COUNT = 3;

export interface AquariumRoute {
  fromStationName: string;
  minutes: number;
  transferCount: number;
  fareYen?: number;
}

export interface NearestAquariumResult {
  nearest: NearbyAquarium;
  others: NearbyAquarium[];
  route?: AquariumRoute;
  introLine: string;
  closingLine: string;
}

const INTRO_LINE = "位置情報キャッチっす！ここから一番近い水族館は……";

// 定型の状況説明なのでGemini(characterChat)は使わず定数で持つ。生成のレイテンシと
// ハルシネーションのリスクを負う理由がない（design.md 5.1節）。
const CLOSING_LINES = {
  normal: "電車でひとっ走りじゃな。気をつけて行っておいで。",
  farAway: "ふむ、ここからはだいぶ遠いのう。わしの知っとるのは関西の海だけなんじゃ。",
  routeUnavailable: "すまんな、電車の時刻は今わからんかった。駅までの道は上に書いておいたぞ。",
  sameStation: "おや、もう最寄り駅におるではないか。すぐそこじゃぞ。",
} as const;

// Cloud RunのプロセスTZはUTCなので、駅すぱあとに渡す出発日時はJSTへ明示的に変換する。
export function toJstDateTime(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}${get("month")}${get("day")}`,
    time: `${get("hour")}${get("minute")}`,
  };
}

export async function findNearestAquariumWithRoute(
  lat: number,
  lng: number,
  now: Date = new Date(),
): Promise<NearestAquariumResult | undefined> {
  // 1. 直線距離での順位付けは外部APIに依存しないので、ここまでで最低限の返信は必ず作れる
  const candidates = await findNearestAquariums(lat, lng, CANDIDATE_COUNT);
  const nearest = candidates[0];
  if (!nearest) return undefined;

  const others = candidates.slice(1);
  const isFarAway = nearest.distanceKm > FAR_AWAY_KM;

  // 2. 現在地の最寄り駅（失敗・駅なしなら経路なしで返す）
  const currentStation = await findNearestStation(lat, lng);
  if (!currentStation || nearest.stationCode === null) {
    return {
      nearest,
      others,
      introLine: INTRO_LINE,
      closingLine: isFarAway ? CLOSING_LINES.farAway : CLOSING_LINES.routeUnavailable,
    };
  }

  // 3. 現在地の最寄り駅が館の玄関口駅と同じなら、経路検索はしない
  if (currentStation.code === nearest.stationCode) {
    return {
      nearest,
      others,
      introLine: INTRO_LINE,
      closingLine: isFarAway ? CLOSING_LINES.farAway : CLOSING_LINES.sameStation,
    };
  }

  const { date, time } = toJstDateTime(now);
  const route = await searchRoute(currentStation.code, nearest.stationCode, date, time);

  return {
    nearest,
    others,
    route: route && { fromStationName: currentStation.name, ...route },
    introLine: INTRO_LINE,
    closingLine: isFarAway
      ? CLOSING_LINES.farAway
      : route
        ? CLOSING_LINES.normal
        : CLOSING_LINES.routeUnavailable,
  };
}
