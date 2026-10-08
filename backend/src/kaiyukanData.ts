import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./firestore.js";

export interface KaiyukanAnimal {
  id: string;
  name: string;
  englishName: string;
  scientificName: string;
  description: string;
  img: string;
  family: string;
  classification: string;
  mainExhibition: string;
  subExhibition: string;
  exhibitionStatus: string;
  tag: string;
  // Wikipediaの抜粋(scripts/fetch-wikipedia-extracts.tsで事前取得して投入)。クイズの参考資料に使う。
  // 記事が無い種は持たない。lang='en'は英語版の記事（問題は日本語で作る）。
  wikipedia?: WikipediaExtract;
}

export interface WikipediaExtract {
  lang: "ja" | "en";
  title: string;
  url: string;
  extract: string;
  fetchedAt: string;
}

let cache: Promise<KaiyukanAnimal[]> | undefined;

export function loadKaiyukanAnimals(): Promise<KaiyukanAnimal[]> {
  if (!cache) {
    cache = db
      .collection("animalMaster")
      .get()
      .then((snapshot) =>
        snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as KaiyukanAnimal
        )
      );
  }
  return cache;
}

export async function findAnimalById(id: string): Promise<KaiyukanAnimal | undefined> {
  const animals = await loadKaiyukanAnimals();
  return animals.find((animal) => animal.id === id);
}

function pickRandomN<T>(items: T[], n: number): T[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// 「すいそうの仲間」: 同じ展示エリア(水槽)にいる他の生き物からランダムにN件。
// subExhibitionまで一致するものを優先し、無ければmainExhibitionだけの一致にフォールバックする。
export async function findTankmates(animalId: string, limit = 3): Promise<KaiyukanAnimal[]> {
  const animals = await loadKaiyukanAnimals();
  const base = animals.find((animal) => animal.id === animalId);
  if (!base) return [];

  const others = animals.filter((animal) => animal.id !== animalId);
  const sameSubExhibition =
    base.subExhibition && others.filter((a) => a.subExhibition === base.subExhibition);
  const pool =
    sameSubExhibition && sameSubExhibition.length > 0
      ? sameSubExhibition
      : others.filter((a) => a.mainExhibition === base.mainExhibition);

  return pickRandomN(pool, limit);
}

// 「しんせきの仲間」: 同じ科(family)の他の生き物からランダムにN件。
export async function findFamilyMates(animalId: string, limit = 3): Promise<KaiyukanAnimal[]> {
  const animals = await loadKaiyukanAnimals();
  const base = animals.find((animal) => animal.id === animalId);
  if (!base) return [];

  const pool = animals.filter((animal) => animal.id !== animalId && animal.family === base.family);
  return pickRandomN(pool, limit);
}

// リッチメニュー「水槽から探す」: 選んだ展示エリア(mainExhibition)にいる生き物からランダムにN件。
// findTankmates/findFamilyMatesと同じ「全件フィルタ→ランダム抽出」のパターン。
export async function findAnimalsByExhibition(slug: string, limit = 3): Promise<KaiyukanAnimal[]> {
  const animals = await loadKaiyukanAnimals();
  const pool = animals.filter((animal) => animal.mainExhibition === slug);
  return pickRandomN(pool, limit);
}

// クイズの「類似した仲間」「同じ水槽にいる魚」カテゴリで、実在しない種を捏造しないための
// グラウンディング用データ（Geminiのプロンプトに実名リストとして渡す）。
export async function findTankmateNames(animalId: string, limit = 5): Promise<string[]> {
  const animals = await loadKaiyukanAnimals();
  const base = animals.find((animal) => animal.id === animalId);
  if (!base) return [];
  return animals
    .filter((animal) => animal.id !== animalId && animal.mainExhibition === base.mainExhibition)
    .slice(0, limit)
    .map((animal) => animal.name);
}

export async function findFamilyMateNames(animalId: string, limit = 5): Promise<string[]> {
  const animals = await loadKaiyukanAnimals();
  const base = animals.find((animal) => animal.id === animalId);
  if (!base) return [];
  return animals
    .filter((animal) => animal.id !== animalId && animal.family === base.family)
    .slice(0, limit)
    .map((animal) => animal.name);
}

// 名前の照合用に表記ゆれをそろえる: 全角半角(NFKC)・大文字小文字・ひらがな→カタカナ・<br>や空白・中黒を除く。
// 濁点・半濁点も外す（「サメ」で「ジンベエザメ」に当たるように）
export function normalizeAnimalName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[\s・･.,、。]/g, "")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .normalize("NFD")
    .replace(/[\u3099\u309A]/g, "")
    .normalize("NFC");
}

// 名前で探す（部分一致）。入力が名前のどこかに含まれる種を、完全一致→前方一致→短い名前の順で返す。
// 「入力 ⊂ 名前」だけを見るので、「ジンベエザメってどれくらい大きいの？」のような文章は当たらない。
export const MIN_NAME_QUERY_LENGTH = 2;
export async function searchAnimalsByName(query: string, limit = 10): Promise<KaiyukanAnimal[]> {
  return matchAnimalsByName(await loadKaiyukanAnimals(), query, limit);
}

// searchAnimalsByName の照合部分（Firestore を読まないのでテストから直接呼べる）
export function matchAnimalsByName<T extends { name: string }>(animals: T[], query: string, limit = 10): T[] {
  const q = normalizeAnimalName(query);
  if (q.length < MIN_NAME_QUERY_LENGTH) return [];
  return animals
    .map((animal) => ({ animal, name: normalizeAnimalName(animal.name) }))
    .filter(({ name }) => name.includes(q))
    .sort((a, b) => {
      const rank = (name: string) => (name === q ? 0 : name.startsWith(q) ? 1 : 2);
      return rank(a.name) - rank(b.name) || a.name.length - b.name.length;
    })
    .slice(0, limit)
    .map(({ animal }) => animal);
}

export function toAbsoluteImageUrl(imgPath: string): string {
  if (/^https?:\/\//.test(imgPath)) return imgPath;
  return `https://www.kaiyukan.com${imgPath}`;
}

export interface KaiyukanExhibition {
  name: string;
  slug: string;
  img: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXHIBITIONS_FILE = join(__dirname, "..", "data", "kaiyukan-exhibitions.json");

let exhibitionsCache: Promise<KaiyukanExhibition[]> | undefined;

function loadExhibitions(): Promise<KaiyukanExhibition[]> {
  if (!exhibitionsCache) {
    exhibitionsCache = readFile(EXHIBITIONS_FILE, "utf-8").then(
      (raw) => JSON.parse(raw) as KaiyukanExhibition[]
    );
  }
  return exhibitionsCache;
}

// 展示エリアのslug(例: "pacific")を人間が読める名前(例: "太平洋")に変換する。
// 静的な参照データ(19件)なのでFirestoreには入れず、ローカルJSON(data/kaiyukan-exhibitions.json)を読む。
// 一致しない場合はslugをそのままフォールバックとして返す。
// 水槽（展示エリア）の名前で探す（部分一致）。照合の仕方は生きものの名前（matchAnimalsByName）と同じ
export async function searchExhibitionsByName(query: string): Promise<KaiyukanExhibition[]> {
  return matchAnimalsByName(await loadExhibitions(), query, 19);
}

// 写真の看板から読んだエリア名を水槽と照合する。看板は「グレート・バリア・リーフ水槽」のように前後に言葉が付くことがあるので、
// テキスト入力（読んだ名前 ⊂ 水槽の名前）に加えて「水槽の名前 ⊂ 読んだ名前」も当たりにする
export async function findExhibitionsInNames(names: string[]): Promise<KaiyukanExhibition[]> {
  return matchExhibitionsInNames(await loadExhibitions(), names);
}

export function matchExhibitionsInNames<T extends { name: string; slug: string }>(exhibitions: T[], names: string[]): T[] {
  const found = new Map<string, T>();
  for (const raw of names) {
    const q = normalizeAnimalName(raw);
    if (q.length < MIN_NAME_QUERY_LENGTH) continue;
    for (const exhibition of exhibitions) {
      const name = normalizeAnimalName(exhibition.name);
      if (name.includes(q) || q.includes(name)) found.set(exhibition.slug, exhibition);
    }
  }
  return [...found.values()];
}

export async function getExhibitionName(slug: string): Promise<string> {
  if (!slug) return slug;
  const exhibitions = await loadExhibitions();
  return exhibitions.find((e) => e.slug === slug)?.name ?? slug;
}

// リッチメニュー「水槽から探す」: エリア選択一覧の表示用。19件の静的参照データなので全件返す。
export async function listExhibitions(): Promise<Array<{ name: string; slug: string }>> {
  const exhibitions = await loadExhibitions();
  return exhibitions.map(({ name, slug }) => ({ name, slug }));
}
