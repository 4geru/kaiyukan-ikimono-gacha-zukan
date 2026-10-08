// 生き物ごとにWikipediaの記事を取得し、クイズの参考資料になる抜粋を animalMaster/{id}.wikipedia に保存する。
// 既定はdry-run（取得してレポートを出すだけ。Firestoreには書かない）。--write を付けたときだけ書き込む。
//
// 使い方:
//   npx tsx scripts/fetch-wikipedia-extracts.ts                 # 全件dry-run（結果は .cache/ に保存される）
//   npx tsx scripts/fetch-wikipedia-extracts.ts --write         # キャッシュ済みの結果をFirestoreに反映（再取得しない）
//   npx tsx scripts/fetch-wikipedia-extracts.ts --ids 48,12     # 指定idだけ
//   npx tsx scripts/fetch-wikipedia-extracts.ts --limit 20      # 先頭N件だけ
//   npx tsx scripts/fetch-wikipedia-extracts.ts --refresh       # 対象分（--ids/--limitで絞った分、無指定なら全件）を取り直す
//
// 取得順: 和名(日本語版) → 学名(日本語版) → 学名(英語版)。曖昧さ回避ページと、本文に学名(または属名)が
// 含まれない記事（別の生き物の記事の取り違え）は採用しない。
//
// 速さの工夫:
// - 記事の存在確認は、1リクエストで最大50タイトルをまとめて引く（バッチ）。抜粋の取得は、存在が分かった記事だけ。
// - リクエスト間隔は全ワーカーで共有し、429(Retry-After)が出たら全員が止まる。通信にはタイムアウトを付ける。
// - 結果は .cache/wikipedia-extracts.json に随時保存する。中断しても続きから再開でき、dry-runのあとの
//   --write は再取得せずキャッシュを使う。
// 記事なし(missing)と取得エラーは区別して記録する（取得エラーはキャッシュしない＝次回やり直す）。
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KaiyukanAnimal, WikipediaExtract } from "../src/kaiyukanData.js";

const USER_AGENT = "kaiyukan-quiz-wikipedia-fetch/1.0 (hackathon project; read-only)";
// 存在確認(prop=info)は速いが、本文の取得(prop=extracts)は1ページずつしか引けず、並列3・間隔120msだと
// 429(Retry-After 約56秒)で止められた。順次・間隔400msにする（実測で429にならなかった速さ）。
const REQUEST_INTERVAL_MS = 400; // 全ワーカー共通の最小リクエスト間隔
const CONCURRENCY = 1;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 6;
const BATCH_SIZE = 50;
const MAX_EXTRACT_CHARS = 2500;
const LEAD_CHARS = 800;
const SECTION_CHARS = 550;

// クイズの材料になりやすいセクション（日本語版・英語版）
const KEEP_SECTION = /分布|形態|特徴|生態|食性|繁殖|生活史|分類|名称|呼称|語源|人間との関係|利用|飼育|保全|Distribution|Range|Description|Habitat|Ecology|Behavio|Diet|Feeding|Biology|Life cycle|Reproduction|Taxonomy|Etymology|Human|Conservation|Uses/i;

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = join(backendDir, ".cache", "wikipedia-extracts.json");

type Source = "ja:和名" | "ja:学名" | "en:学名";
type Lang = "ja" | "en";

interface CacheEntry {
  wikipedia: WikipediaExtract | null; // null = 記事なし（取得エラーではない）
  source?: Source;
  rejected: string[]; // 採用しなかった理由（曖昧さ回避・学名不一致など）
}
type Cache = Record<string, CacheEntry>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- HTTP（全ワーカーで間隔を共有し、429で全員が止まる） ----
let nextSlot = 0;
let pauseUntil = 0;
let errorCount = 0;

async function politeGet(url: string): Promise<unknown | undefined> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const now = Date.now();
    const slot = Math.max(now, nextSlot, pauseUntil);
    nextSlot = slot + REQUEST_INTERVAL_MS;
    if (slot > now) await sleep(slot - now);
    try {
      // タイムアウト無しだと、応答が返らない接続で永久に待ってしまう
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.ok) return await res.json();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 5;
        pauseUntil = Date.now() + retryAfter * 1000 + 500;
        console.log(`  429: ${retryAfter}秒待ちます`);
      } else {
        console.log(`  HTTP ${res.status}: 再試行します`);
        await sleep(2000);
      }
    } catch (error) {
      console.log(`  通信エラー(${error instanceof Error ? error.name : "unknown"}): 再試行します`);
      await sleep(1000);
    }
  }
  errorCount++;
  return undefined;
}

function apiUrl(lang: Lang, params: Record<string, string>): string {
  const query = new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", ...params });
  return `https://${lang}.wikipedia.org/w/api.php?${query}`;
}

interface Page {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  extract?: string;
  pageprops?: Record<string, unknown>;
}
interface QueryResponse {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: Page[];
  };
}

// タイトルをまとめて引き、実在して曖昧さ回避でないページの「元のタイトル → 最終タイトル」を返す
async function batchResolve(
  lang: Lang,
  titles: string[],
): Promise<{ found: Map<string, string>; disambiguation: Set<string> }> {
  const found = new Map<string, string>();
  const disambiguation = new Set<string>();
  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const json = (await politeGet(apiUrl(lang, { prop: "info|pageprops", ppprop: "disambiguation", titles: chunk.join("|") }))) as
      | QueryResponse
      | undefined;
    const query = json?.query;
    if (!query?.pages) continue;

    const finalTitle = new Map(chunk.map((title) => [title, title])); // 元タイトル → 正規化・リダイレクト後
    for (const step of [query.normalized ?? [], query.redirects ?? []]) {
      for (const { from, to } of step) {
        for (const [original, current] of finalTitle) if (current === from) finalTitle.set(original, to);
      }
    }
    const pages = new Map(query.pages.map((page) => [page.title, page]));
    for (const [original, final] of finalTitle) {
      const page = pages.get(final);
      if (!page || page.missing || page.invalid) continue;
      if (page.pageprops && "disambiguation" in page.pageprops) disambiguation.add(original);
      else found.set(original, page.title);
    }
  }
  return { found, disambiguation };
}

// 記事の本文（プレーンテキスト）。undefined = 取得エラー、null = 記事なし
async function fetchArticleText(lang: Lang, title: string): Promise<string | null | undefined> {
  const json = (await politeGet(apiUrl(lang, { prop: "extracts", explaintext: "1", titles: title }))) as QueryResponse | undefined;
  if (!json) return undefined;
  const page = json.query?.pages?.[0];
  return !page || page.missing ? null : (page.extract ?? "");
}

// ---- 抜粋 ----
// 別の生き物の記事を取り違えていないか: 本文に学名（または属名）が含まれること
function mentionsScientificName(text: string, scientificName: string): boolean {
  const name = scientificName.trim();
  if (!name) return false;
  const genus = name.split(/\s+/)[0];
  return text.includes(name) || (genus.length >= 3 && text.includes(genus));
}

function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut;
}

// 導入 + クイズの材料になりやすいセクションを、約MAX_EXTRACT_CHARS字に抜粋する
function buildExcerpt(fullText: string): string {
  const headings = [...fullText.matchAll(/^==+\s*(.+?)\s*==+\s*$/gm)];
  const lead = (headings.length > 0 ? fullText.slice(0, headings[0].index) : fullText).trim();

  const parts = [truncateAtSentence(lead, LEAD_CHARS)];
  let used = parts[0].length;

  for (let i = 0; i < headings.length && used < MAX_EXTRACT_CHARS; i++) {
    const heading = headings[i][1];
    if (!KEEP_SECTION.test(heading)) continue;
    const start = (headings[i].index ?? 0) + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : fullText.length;
    const body = fullText.slice(start, end).trim();
    if (!body) continue;
    const section = `【${heading}】${truncateAtSentence(body, Math.min(SECTION_CHARS, MAX_EXTRACT_CHARS - used))}`;
    parts.push(section);
    used += section.length;
  }
  return parts.join("\n");
}

function articleUrl(lang: Lang, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

// ---- 生き物ごとの解決 ----
interface Titles {
  jaName: Awaited<ReturnType<typeof batchResolve>>;
  jaSci: Awaited<ReturnType<typeof batchResolve>>;
  enSci: Awaited<ReturnType<typeof batchResolve>>;
}

const cleanName = (animal: KaiyukanAnimal) => animal.name.replace(/<br\s*\/?>/g, "");

async function resolveAnimal(animal: KaiyukanAnimal, titles: Titles): Promise<{ entry: CacheEntry; hadError: boolean }> {
  const name = cleanName(animal);
  const scientificName = (animal.scientificName ?? "").trim();
  const entry: CacheEntry = { wikipedia: null, rejected: [] };
  let hadError = false;

  if (titles.jaName.disambiguation.has(name)) entry.rejected.push(`ja:和名: 曖昧さ回避「${name}」`);

  const candidates: Array<{ source: Source; lang: Lang; title: string | undefined }> = [
    { source: "ja:和名", lang: "ja", title: titles.jaName.found.get(name) },
    { source: "ja:学名", lang: "ja", title: titles.jaSci.found.get(scientificName) },
    { source: "en:学名", lang: "en", title: titles.enSci.found.get(scientificName) },
  ];

  const tried = new Set<string>();
  for (const { source, lang, title } of candidates) {
    if (!title || tried.has(`${lang}:${title}`)) continue;
    tried.add(`${lang}:${title}`);

    const text = await fetchArticleText(lang, title);
    if (text === undefined) {
      hadError = true;
      continue;
    }
    if (text === null) continue;
    if (!mentionsScientificName(text, scientificName)) {
      // 生き物データの学名には綴りの誤り（Plecogllossus）や古い属名（Paroctopus）があり、学名だけで判定すると
      // 正しい記事まで落とす。和名で引いた記事は、タイトルが和名と完全一致し、導入文に和名があれば採用する
      // （リダイレクトで別の記事に飛んだ場合はタイトルが変わるので、ここで弾かれる）。
      // 学名検索で見つけた記事は、名前の手がかりが無いので学名一致を必須にする。
      const sameNameArticle = source === "ja:和名" && title === name && text.slice(0, 400).includes(name);
      if (!sameNameArticle) {
        entry.rejected.push(`${source}: 学名不一致「${title}」`);
        continue;
      }
      entry.rejected.push(`注意: ${source}「${title}」は学名不一致だが、和名と同じ題名の記事のため採用`);
    }
    entry.source = source;
    entry.wikipedia = {
      lang,
      title,
      url: articleUrl(lang, title),
      extract: buildExcerpt(text),
      fetchedAt: new Date().toISOString(),
    };
    break;
  }
  return { entry, hadError };
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8")) as Cache;
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache), "utf-8");
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const refresh = process.argv.includes("--refresh");
  const idsArg = argValue("--ids");
  const limitArg = argValue("--limit");

  let animals = JSON.parse(await readFile(join(backendDir, "data", "kaiyukan-animals.json"), "utf-8")) as KaiyukanAnimal[];
  if (idsArg) {
    const ids = new Set(idsArg.split(","));
    animals = animals.filter((animal) => ids.has(animal.id));
  }
  if (limitArg) animals = animals.slice(0, Number(limitArg));

  // --refresh は、対象の生き物（--ids / --limit で絞った分）のキャッシュだけを取り直す（他の分は残す）
  const cache = await loadCache();
  if (refresh) for (const animal of animals) delete cache[animal.id];
  const todo = animals.filter((animal) => !(animal.id in cache));
  const errored: KaiyukanAnimal[] = [];
  console.log(`対象: ${animals.length}件 / キャッシュ済み: ${animals.length - todo.length}件 / 取得する: ${todo.length}件 (${write ? "--write: Firestoreに反映する" : "dry-run: 書き込まない"})`);

  if (todo.length > 0) {
    const startedAt = Date.now();
    const seconds = () => Math.round((Date.now() - startedAt) / 1000);

    console.log("記事の存在をまとめて確認しています（バッチ）...");
    const sciNames = [...new Set(todo.map((animal) => (animal.scientificName ?? "").trim()).filter(Boolean))];
    const titles: Titles = {
      jaName: await batchResolve("ja", [...new Set(todo.map(cleanName))]),
      jaSci: await batchResolve("ja", sciNames),
      enSci: await batchResolve("en", sciNames),
    };
    console.log(`  ja和名 ${titles.jaName.found.size} / ja学名 ${titles.jaSci.found.size} / en学名 ${titles.enSci.found.size} 件が存在 (${seconds()}秒)`);

    let done = 0;
    await runPool(todo, async (animal) => {
      const { entry, hadError } = await resolveAnimal(animal, titles);
      if (hadError && !entry.wikipedia) errored.push(animal);
      else cache[animal.id] = entry;
      done++;
      if (done % 10 === 0 || done === todo.length) {
        console.log(`  抜粋を取得: ${done}/${todo.length} (${seconds()}秒)`);
        await saveCache(cache);
      }
    });
    await saveCache(cache);
  }

  // ---- レポート ----
  const entries = animals.filter((animal) => animal.id in cache).map((animal) => ({ animal, entry: cache[animal.id] }));
  const found = entries.filter((e) => e.entry.wikipedia);
  const bySource = (source: Source) => entries.filter((e) => e.entry.source === source).length;
  console.log("\n=== レポート ===");
  console.log(`記事あり: ${found.length}/${animals.length}（ja:和名 ${bySource("ja:和名")} / ja:学名 ${bySource("ja:学名")} / en:学名 ${bySource("en:学名")}）`);
  console.log(`取得エラー(リトライ上限): ${errorCount}回 / エラーで未確定の生き物: ${errored.length}件（次回の実行でやり直す）`);
  const lengths = found.map((e) => e.entry.wikipedia!.extract.length).sort((a, b) => a - b);
  if (lengths.length > 0) {
    console.log(`抜粋の長さ(字): 最小 ${lengths[0]} / 中央 ${lengths[Math.floor(lengths.length / 2)]} / 最大 ${lengths[lengths.length - 1]}`);
  }
  const rejected = entries.filter((e) => e.entry.rejected.length > 0);
  console.log(`\n採用しなかった候補（曖昧さ回避・学名不一致）: ${rejected.length}件`);
  for (const { animal, entry } of rejected.slice(0, 25)) {
    console.log(`  ${cleanName(animal)}: ${entry.rejected.join(" / ")}${entry.wikipedia ? " → 別の候補を採用" : ""}`);
  }
  const notFound = entries.filter((e) => !e.entry.wikipedia);
  console.log(`\n記事なし: ${notFound.length}件`);
  console.log(`  ${notFound.map((e) => cleanName(e.animal)).join("、")}`);
  console.log("\n--- 抜粋のサンプル（先頭3件） ---");
  for (const { animal, entry } of found.slice(0, 3)) {
    const wiki = entry.wikipedia!;
    console.log(`\n[${cleanName(animal)} / ${wiki.lang}:${wiki.title} / ${wiki.extract.length}字]`);
    console.log(wiki.extract.slice(0, 400));
  }

  if (!write) {
    console.log("\ndry-runのため書き込みませんでした。反映するには --write を付けて再実行してください（キャッシュを使うので再取得しません）。");
    return;
  }

  const { db } = await import("../src/firestore.js");
  let batch = db.batch();
  let pending = 0;
  for (const { animal, entry } of found) {
    batch.set(db.collection("animalMaster").doc(animal.id), { wikipedia: entry.wikipedia }, { merge: true });
    if (++pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.log(`\nanimalMasterのwikipediaフィールドを更新しました: ${found.length}件`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
