// data/kansai-aquariums.json の station(玄関口駅名)から駅すぱあとの駅コードを引き、stationCodeを埋める。
// ランタイムでは駅名を引き直さずこの焼き込み済みコードを使う（同名別事業者の駅を取り違えないため）。
// 一度だけ手動実行する想定:
//   tsx scripts/fetch-aquarium-station-codes.ts
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://api.ekispert.jp/v1/json/station";

interface Aquarium {
  id: string;
  name: string;
  prefecture: string;
  station: string;
  stationCode: number | null;
  [key: string]: unknown;
}

interface StationCandidate {
  code: string;
  name: string;
  type?: string;
  prefecture?: string;
}

// 駅すぱあとのJSONは結果が1件のとき配列ではなく単一オブジェクトを返す（design.md 1.5節）。
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

async function fetchCandidates(name: string, key: string): Promise<StationCandidate[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("key", key);
  url.searchParams.set("name", name);
  url.searchParams.set("gcs", "wgs84");

  const res = await fetch(url);
  if (!res.ok) {
    // キーがクエリに載るためURLはログに出さない
    throw new Error(`駅名検索に失敗しました (${name}): ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as {
    ResultSet?: { Point?: unknown };
  };

  return toArray(body.ResultSet?.Point as Record<string, any> | Record<string, any>[]).map((point) => ({
    code: String(point?.Station?.code ?? ""),
    name: String(point?.Station?.Name ?? ""),
    type: point?.Station?.Type,
    prefecture: point?.Prefecture?.Name ?? point?.Station?.Prefecture?.Name,
  }));
}

function pickStation(
  candidates: StationCandidate[],
  stationName: string,
  prefecture: string,
): { picked?: StationCandidate; others: StationCandidate[] } {
  // 「大倉山」(神戸/横浜)「別府」(兵庫/大分)のように同名駅が複数あるため、
  // 鉄道駅(train)かつ府県が一致するものに絞ってから、駅名完全一致を優先する。
  const trains = candidates.filter((c) => c.type === "train");
  const inPrefecture = trains.filter((c) => (c.prefecture ?? "").startsWith(prefecture));
  const pool = inPrefecture.length > 0 ? inPrefecture : trains;
  const exact = pool.filter((c) => c.name === stationName);
  const finalPool = exact.length > 0 ? exact : pool;

  return { picked: finalPool[0], others: finalPool.slice(1) };
}

async function main(): Promise<void> {
  const key = process.env.EKISPERT_API_ACCESS_KEY;
  if (!key) throw new Error("EKISPERT_API_ACCESS_KEY が設定されていません");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const file = join(__dirname, "..", "data", "kansai-aquariums.json");
  const aquariums = JSON.parse(await readFile(file, "utf-8")) as Aquarium[];

  for (const aquarium of aquariums) {
    const candidates = await fetchCandidates(aquarium.station, key);
    const { picked, others } = pickStation(candidates, aquarium.station, aquarium.prefecture);

    if (!picked) {
      console.warn(`× ${aquarium.name}: 「${aquarium.station}」の駅が見つかりませんでした`);
      continue;
    }

    aquarium.stationCode = Number(picked.code);
    console.log(`○ ${aquarium.name}: ${picked.name} (${picked.prefecture ?? "府県不明"}) code=${picked.code}`);
    if (others.length > 0) {
      // 絞り込んでも複数残る場合は取り違えの可能性があるため、目視確認用に併記する
      const list = others.map((c) => `${c.name}/${c.prefecture ?? "?"}/${c.code}`).join(", ");
      console.warn(`  ! 他の候補が残っています（要確認）: ${list}`);
    }
  }

  await writeFile(file, JSON.stringify(aquariums, null, 2) + "\n", "utf-8");
  console.log(`\n保存しました: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
