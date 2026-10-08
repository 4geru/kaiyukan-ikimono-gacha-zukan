import { GoogleGenAI, Type, createPartFromBase64, createUserContent } from '@google/genai';
import {
  findExhibitionsInNames,
  getExhibitionName,
  loadKaiyukanAnimals,
  type KaiyukanAnimal,
  type KaiyukanExhibition,
} from './kaiyukanData.js';
import { withLlmLog } from './agentRun.js';
import { logEvent } from './log.js';

export interface FishCandidate {
  id: string;
  name: string;
  imageUrl: string;
  confidence: 'high' | 'low';
  // どの展示エリア（水槽）にいるか。例: 「太平洋」。カードに「🌊 太平洋展示エリア」と出す
  exhibitionName?: string;
}

export interface ExtractedName {
  japaneseName?: string;
  scientificName?: string;
  englishName?: string;
}

const PANEL_READING_PROMPT = `これは水族館の水槽横にある解説パネルの写真です。パネルのレイアウトは様々です:
- 1種類だけを大きく紹介するパネル(和名・学名・英名・生息水深・飼育水温・説明文つきのこともある)
- 複数種類が縦や格子状に並んだ帯状・タッチパネル形式のパネル(名前と学名だけの簡素な表記のことが多い)
- 体長・体重・寿命・分布地図など詳細な情報が並ぶ図鑑形式のパネル
- 「泳ぎ回るエイ」のような分類・テーマの見出しに、個別種の小さな名札が添えられているパネル

写真に写っている、実際の生きものの種名(和名のカタカナ/漢字表記)を、パネルに書かれている数だけすべて読み取ってください。文字が小さい・斜めから撮影されている・反射で読みにくい場合も、可能な限り推測して構いません。
「泳ぎ回るエイ」のような分類やテーマの見出し自体は種名ではないので抽出しないでください(ただしその横に個別の種名が小さく書かれていればそれは抽出対象です)。
学名(イタリック体のラテン語表記)や英名が併記されていれば、それぞれ対応する種名と一緒に記録してください。読み取れない項目は省略して構いません。
生きものの種名が1つも見当たらない場合は空の配列を返してください。

あわせて、水槽や展示エリアの看板・見出しに書かれたエリア名（例:「グレート・バリア・リーフ」「太平洋」「日本の森」のような地域名・エリア名）があれば exhibitionNames に入れてください。
解説文の中に出てくる地名（「北部太平洋に分布」の「北部太平洋」など）や、生きものの種名は exhibitionNames に入れないでください。見当たらなければ空の配列にしてください。`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    species: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          japaneseName: { type: Type.STRING },
          scientificName: { type: Type.STRING },
          englishName: { type: Type.STRING },
        },
      },
    },
    // 水槽・展示エリアの看板の名前（種名が読めなかったときに「水槽から探す」と同じ動きにする）
    exhibitionNames: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['species'],
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s・.,、。]/g, '');
}

type MatchType = 'exact' | 'partial';

export interface FieldMatch {
  matchType: MatchType;
  ratio: number; // 1 = 完全一致。部分一致は min(len)/max(len) の長さ比
}

// design.mdの「正規化後3文字未満は除外」という絶対長の閾値はほぼ機能しないため、
// 抽出文字列と候補文字列の長さの比で相対的にフィルタする(Fableレビュー参照)。
const MIN_PARTIAL_RATIO = 0.5;
const HIGH_CONFIDENCE_PARTIAL_RATIO = 0.75;

function evaluateFieldMatch(fieldValue: string | undefined, needle: string | undefined): FieldMatch | undefined {
  if (!fieldValue || !needle) return undefined;
  const a = normalize(fieldValue);
  const b = normalize(needle);
  if (!a || !b) return undefined;
  if (a === b) return { matchType: 'exact', ratio: 1 };
  // 正引き(a⊃b)・逆引き(b⊃a)の両方向を同じ基準で扱う
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return { matchType: 'partial', ratio };
  }
  return undefined;
}

function betterMatch(a: FieldMatch, b: FieldMatch): FieldMatch {
  if (a.matchType === 'exact' && b.matchType !== 'exact') return a;
  if (b.matchType === 'exact' && a.matchType !== 'exact') return b;
  return a.ratio >= b.ratio ? a : b;
}

function evaluateAnimalMatch(animal: KaiyukanAnimal, extracted: ExtractedName): FieldMatch | undefined {
  const fieldMatches = [
    evaluateFieldMatch(animal.name, extracted.japaneseName),
    evaluateFieldMatch(animal.scientificName, extracted.scientificName),
    evaluateFieldMatch(animal.englishName, extracted.englishName),
  ].filter((m): m is FieldMatch => m !== undefined);

  if (fieldMatches.length === 0) return undefined;
  return fieldMatches.reduce(betterMatch);
}

// Fableレビュー: Array.findによる早期リターンは配列の並び順に結果が依存するバグを生む
// (例: 「ハリセンボン」で検索した時、本来の完全一致より前にある劣った部分一致が先に採用されてしまう)。
// 243件全部をスキャンしてスコアリングし、最良の1件を選ぶことで配列順への依存を断つ。
export function findBestMatchingAnimal(
  extracted: ExtractedName,
  animals: KaiyukanAnimal[],
): { animal: KaiyukanAnimal; match: FieldMatch } | undefined {
  let best: { animal: KaiyukanAnimal; match: FieldMatch } | undefined;

  for (const animal of animals) {
    const match = evaluateAnimalMatch(animal, extracted);
    if (!match) continue;
    if (match.matchType === 'partial' && match.ratio < MIN_PARTIAL_RATIO) continue;

    if (!best) {
      best = { animal, match };
      continue;
    }
    const winner = betterMatch(best.match, match);
    if (winner === match && winner !== best.match) {
      best = { animal, match };
    }
  }

  return best;
}

export function confidenceFor(match: FieldMatch): 'high' | 'low' {
  if (match.matchType === 'exact') return 'high';
  return match.ratio >= HIGH_CONFIDENCE_PARTIAL_RATIO ? 'high' : 'low';
}

function toAbsoluteImageUrl(imgPath: string): string {
  if (/^https?:\/\//.test(imgPath)) return imgPath;
  return `https://www.kaiyukan.com${imgPath}`;
}

// 写真の読み取り結果。candidates が空で exhibitions があれば「水槽から探す」と同じ動きにする（server.ts）
export interface PanelReading {
  candidates: FishCandidate[];
  exhibitions: KaiyukanExhibition[];
}

// 種の候補だけ欲しい呼び出し元（scripts/ の精度確認など）向け
export async function identifyFishFromImage(imageBuffer: Buffer, mimeType: string): Promise<FishCandidate[]> {
  return (await readPanelFromImage(imageBuffer, mimeType)).candidates;
}

export async function readPanelFromImage(imageBuffer: Buffer, mimeType: string): Promise<PanelReading> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }

  const ai = new GoogleGenAI({ apiKey });

  let extractedSpecies: ExtractedName[];
  let extractedExhibitions: string[];
  try {
    const imagePart = createPartFromBase64(imageBuffer.toString('base64'), mimeType);
    // 画像そのものはログに出さない。inputChars は指示文の長さだけ
    const response = await withLlmLog('identify', 'gemini-2.5-flash', PANEL_READING_PROMPT.length, () =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: createUserContent([PANEL_READING_PROMPT, imagePart]),
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // 案内板の文字読み取りに推論は不要。2.5 Flashはデフォルトでthinkingが走り数秒〜十数秒遅くなる。
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    );

    const text = response.text;
    if (!text) {
      throw new Error('Geminiからのレスポンスにテキストが含まれていません');
    }
    const parsed = JSON.parse(text) as { species?: ExtractedName[]; exhibitionNames?: string[] };
    extractedSpecies = parsed.species ?? [];
    extractedExhibitions = parsed.exhibitionNames ?? [];
  } catch (error) {
    throw new Error(`Gemini Visionでの案内板読み取りに失敗しました: ${(error as Error).message}`);
  }

  // マッチング前の生読み取り結果。OCR誤読とマッチングロジックの誤りを切り分けるためのログ(Fableレビュー参照)。
  // 案内板から読んだ種名は個人情報ではないので出してよい（design 3.4）
  logEvent('identify_extracted', { extractedSpecies, extractedExhibitions, message: '案内板から種名を読み取りました' });

  const exhibitions = await findExhibitionsInNames(extractedExhibitions);
  if (extractedSpecies.length === 0) {
    return { candidates: [], exhibitions };
  }

  const animals = await loadKaiyukanAnimals();

  const candidates: FishCandidate[] = [];
  const candidateById = new Map<string, FishCandidate>();

  for (const extracted of extractedSpecies) {
    const best = findBestMatchingAnimal(extracted, animals);
    if (!best) continue;

    const confidence = confidenceFor(best.match);
    const existing = candidateById.get(best.animal.id);
    if (existing) {
      if (confidence === 'high' && existing.confidence === 'low') {
        existing.confidence = 'high';
      }
      continue;
    }

    const candidate: FishCandidate = {
      id: best.animal.id,
      name: best.animal.name,
      imageUrl: toAbsoluteImageUrl(best.animal.img),
      confidence,
      exhibitionName: await getExhibitionName(best.animal.mainExhibition),
    };
    candidateById.set(best.animal.id, candidate);
    candidates.push(candidate);
  }

  return { candidates, exhibitions };
}
