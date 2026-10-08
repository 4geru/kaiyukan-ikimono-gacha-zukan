import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Aquarium {
  id: string;
  name: string;
  prefecture: string;
  address: string;
  lat: number;
  lng: number;
  station: string;
  stationCode: number | null;
  access: string;
  url: string;
}

export interface NearbyAquarium extends Aquarium {
  distanceKm: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const AQUARIUMS_FILE = join(__dirname, "..", "data", "kansai-aquariums.json");

// 静的な参照データ(15館)なのでFirestoreには入れず、ローカルJSONを1度だけ読んでキャッシュする
// (getExhibitionNameと同じ方式)。
let cache: Promise<Aquarium[]> | undefined;

export function loadAquariums(): Promise<Aquarium[]> {
  if (!cache) {
    cache = readFile(AQUARIUMS_FILE, "utf-8").then((raw) => JSON.parse(raw) as Aquarium[]);
  }
  return cache;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// 2地点の大円距離(km)。km表示と順位付けが用途なので、Haversineの精度で十分。
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function findNearestAquariums(
  lat: number,
  lng: number,
  limit = 3,
): Promise<NearbyAquarium[]> {
  const aquariums = await loadAquariums();
  return aquariums
    .map((aquarium) => ({
      ...aquarium,
      distanceKm: haversineDistanceKm(lat, lng, aquarium.lat, aquarium.lng),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
