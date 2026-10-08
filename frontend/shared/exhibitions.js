// 海遊館の展示エリア（水槽）19件。マニフェストの mainExhibition（slug）→ 表示名。
// 名前は backend/data/kaiyukan-exhibitions.json（海遊館の公式表記）と同じ。short はチップなど狭い所で使う短い表記。
// 並びは館内をめぐる順（kaiyukan-exhibitions.json の並び）
export const EXHIBITIONS = [
  { slug: "japanforest", name: "日本の森" },
  { slug: "aleutian", name: "アリューシャン列島" },
  { slug: "monterey", name: "モンタレー湾" },
  { slug: "panama", name: "パナマ湾" },
  { slug: "ecuador", name: "エクアドル熱帯雨林" },
  { slug: "antarctica", name: "南極大陸" },
  { slug: "tasman", name: "タスマン海" },
  { slug: "gbr", name: "グレート・バリア・リーフ" },
  { slug: "pacific", name: "太平洋" },
  { slug: "seto", name: "瀬戸内海" },
  { slug: "seasonal_exhibits", name: "特設水槽" },
  { slug: "chile", name: "チリの岩礁地帯" },
  { slug: "cook", name: "クック海峡" },
  { slug: "japandeep", name: "日本海溝" },
  { slug: "aquagate", name: "アクアゲート" },
  { slug: "jellyfish", name: "海月銀河", short: "海月銀河（クラゲ）" },
  { slug: "arctic", name: "北極圏" },
  { slug: "falkland", name: "フォークランド諸島（マルビナス）", short: "フォークランド諸島" },
  { slug: "gyugyutto_cute", name: "企画展示/ぎゅぎゅっとキュート", short: "ぎゅぎゅっとキュート" },
];

const BY_SLUG = new Map(EXHIBITIONS.map((e) => [e.slug, e]));

// slug → 展示エリア。未知の slug は undefined
export function findExhibition(slug) {
  return slug ? BY_SLUG.get(slug) : undefined;
}

// 狭い所に出す短い表記（無ければ正式名）。未知の slug は空文字
export function exhibitionLabel(slug) {
  const exhibition = findExhibition(slug);
  return exhibition ? exhibition.short || exhibition.name : "";
}
