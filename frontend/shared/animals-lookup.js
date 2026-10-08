// animalId → {name, scientificName, family, file(画像URL)} を解決する（design.md 3節）。
// 画像URLの真実の情報源は「海遊館の生きもの一覧マニフェスト」（gacha-demo/animals-manifest.js、公開GCS）。
// Firestore側には持たせず、既存の公開マニフェストをそのまま流用することでバックエンドへの依存を増やさない。
import { ANIMALS_MANIFEST_URL } from "./config.js";

// シンプルなインラインSVGのプレースホルダー（マニフェスト未登録時のフォールバック用）
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%230e1830'/%3E%3Ctext x='50%25' y='50%25' fill='%238fa5c9' font-size='48' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E";

let manifestLoadPromise;

function loadManifestScript() {
  if (window.ANIMALS_MANIFEST) return Promise.resolve();
  if (!manifestLoadPromise) {
    manifestLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ANIMALS_MANIFEST_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("animals-manifest.jsの読み込みに失敗しました"));
      document.head.appendChild(script);
    });
  }
  return manifestLoadPromise;
}

// マニフェストに載っている全生きものを返す（図鑑ページ用）。読み込み失敗時は空配列。
export async function loadAllAnimals() {
  try {
    await loadManifestScript();
  } catch (error) {
    console.warn(error);
  }
  return window.ANIMALS_MANIFEST || [];
}

// fallbackName: マニフェストに該当エントリが無い場合に表示する名前（通常はFirestoreのcollection.nameを渡す）
export async function lookupAnimal(animalId, fallbackName) {
  const list = await loadAllAnimals();
  const found = list.find((animal) => animal.id === animalId);
  if (found) return found;

  return {
    id: animalId,
    name: fallbackName || "？？？",
    scientificName: "",
    family: "",
    file: PLACEHOLDER_IMAGE,
  };
}
