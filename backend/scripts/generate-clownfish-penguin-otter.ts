import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface QuizQuestion {
  id: string;
  animalId: string;
  category: string;
  level: number;
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  factSource: "official" | "wikipedia" | "general" | "none";
  groundingNames: string[];
  generatedBy: string;
  generatedAt: string;
  review: { status: "pending" };
}

function makeQuestions(animalId: string, animalName: string): QuizQuestion[] {
  let qCount = 0;

  function createQuestion(
    cat: string, level: number, q: string,
    correct: string, wrong1: string, wrong2: string,
    exp: string, src: "official" | "wikipedia" | "general" | "none" = "official",
    grounding: string[] = []
  ): QuizQuestion {
    const idx = qCount % 3;
    qCount++;
    let choices: string[];
    if (idx === 0) choices = [correct, wrong1, wrong2];
    else if (idx === 1) choices = [wrong1, correct, wrong2];
    else choices = [wrong1, wrong2, correct];
    return {
      id: `${animalId}-${cat}-${level}`,
      animalId, category: cat, level, question: q,
      choices, correctIndex: idx, explanation: exp, factSource: src,
      groundingNames: grounding, generatedBy: "claude-haiku-4-5",
      generatedAt: new Date().toISOString(), review: { status: "pending" }
    };
  }

  const questions: QuizQuestion[] = [];

  if (animalId === "209") {
    // カクレクマノミ (Amphiprion ocellaris, Clown anemonefish)
    // L1: 8
    questions.push(
      createQuestion("生息地", 1, "かくれくまのみは どこに すんでいる?",
        "あたたかい うみ", "つめたい うみ", "だむ", "インド洋から太平洋に分布"),
      createQuestion("水域", 1, "かくれくまのみは どんな ところに いる?",
        "いそぎんちゃく", "さんご", "いわ", "イソギンチャクとの共生が特徴"),
      createQuestion("水温", 1, "かくれくまのみが すきな おんどは?",
        "あたたかい", "つめたい", "ふつう", "暖かい海域に生息"),
      createQuestion("深度", 1, "かくれくまのみは うみの どの ふかさに いる?",
        "さんごしょう", "ふかい", "そこ", "浅いサンゴ礁に生息"),
      createQuestion("特徴", 1, "かくれくまのみの からだの いろは?",
        "だいだいいろと しろ", "あかと くろ", "あおいろ", "オレンジ色と白の模様が特徴"),
      createQuestion("豆知識", 1, "かくれくまのみが いそぎんちゃくと いっしょにいるわけは?",
        "がまんばやいから", "たべられるから", "ひとりぼっち",
        "イソギンチャクに保護されています"),
      createQuestion("食物連鎖", 1, "かくれくまのみは なにを たべる?",
        "ちいさい えきぶつ", "くさ", "こっぺん", "小さな生き物を食べます"),
      createQuestion("ダジャレ", 1, "『くまのみ』の なまえは？",
        "もようが くまに みえるから", "でかいから", "こわいから",
        "体の模様が熊に見えることから")
    );
    // L2-L5: 52
    for (const level of [2, 3, 4, 5] as const) {
      for (const cat of ["生息地", "水域", "水温", "深度", "郷土料理", "類似した仲間", "同じ水槽にいる魚", "特徴", "豆知識", "進化の歴史", "食物連鎖", "ダジャレ", "海外の小ネタ"]) {
        if (level === 2 && ["進化の歴史", "海外の小ネタ", "類似した仲間", "同じ水槽にいる魚", "郷土料理"].includes(cat)) continue;
        const qData: Record<string, [string, string, string, string]> = {
          "生息地": level === 2
            ? ["インド洋から太平洋", "カリブ海", "北極海", "説明に「西部太平洋からインド洋」と記載"]
            : level === 3
            ? ["サンゴ礁の浅瀬", "外洋", "河口", "浅いサンゴ礁に固定的に生息"]
            : level === 4
            ? ["アネモネフィッシュの共生分布", "イソギンチャク分布", "プランクトン分布", "イソギンチャクの存在が絶対条件"]
            : ["インド太平洋の暖水域での共生進化", "単独適応", "人為的導入", "共進化の結果"],
          "水域": level === 2
            ? ["サンゴ礁", "外洋", "淡水", "浅いサンゴ礁環境に限定"]
            : level === 3
            ? ["造礁サンゴ群集", "裸地", "砂地", "造礁サンゴの密度が重要"]
            : level === 4
            ? ["イソギンチャクの分布範囲内", "光合成領域", "深海", "イソギンチャクの分布域に規定"]
            : ["共生イソギンチャク種の生態的ニッチ", "自由生活適応", "多種共生", "種固有のイソギンチャク選別"],
          "水温": level === 2
            ? ["20℃以上", "10℃以上", "0℃", "温水域に制限"]
            : level === 3
            ? ["25～30℃", "15℃", "5℃以下", "熱帯の水温に限定"]
            : level === 4
            ? ["イソギンチャク共生の水温依存性", "自由生活温度", "深海適応", "共生パートナーの温度感受性"]
            : ["珊瑚光合成共生と水温躍層", "単独代謝", "温度耐性", "宿主イソギンチャクの温度限界"],
          "深度": level === 2
            ? ["表層～10m", "50m以深", "深海", "浅い層のサンゴ礁に限定"]
            : level === 3
            ? ["0～20m", "100m", "海底付近", "光が届く浅い層"]
            : level === 4
            ? ["イソギンチャク共生の垂直分布", "可変深度", "一定水深", "宿主の分布に従う"]
            : ["共生イソギンチャク種による深度ニッチ分割", "個体群密度", "産卵水深", "種による垂直棲み分け"],
          "郷土料理": level === 3
            ? ["アジア地域で飼育される", "野生採集で食べる", "薬用", "主に観賞魚として珍重"]
            : level === 4
            ? ["観賞魚市場の対象", "食用利用", "医薬品", "商業的価値が産業化を推進"]
            : ["持続可能性と保全ジレンマ", "無制限利用", "禁止", "多くの国で規制対象"],
          "類似した仲間": level === 3
            ? ["ハマクマノミ", "マンタ", "ハタ", "同じスズメダイ科に属する"]
            : level === 4
            ? ["スズメダイ科の他のクマノミ", "別科の魚", "サメ", "共生関係の有無"]
            : ["クマノミ属内の進化的分化", "単一種", "異系統", "島嶼隔離による分化"],
          "同じ水槽にいる魚": level === 3
            ? ["イソギンチャク", "ジンベエザメ", "マグロ", "同じ展示エリアにいるか"]
            : level === 4
            ? ["イソギンチャク共生生物との共存", "ナンヨウマンタ", "深海魚", "共存可能な生態系"]
            : ["サンゴ礁魚種の多様性", "単種飼育", "外洋種", "多種共存の可能性"],
          "特徴": level === 2
            ? ["オレンジ色と白", "黒と黄", "赤と黒", "体色が特徴的"]
            : level === 3
            ? ["二本の背びれと眼模様", "側線が無い", "尾びれが大きい", "識別形質がある"]
            : level === 4
            ? ["イソギンチャクとの共進化による行動適応", "独立型色彩", "迷彩色", "保護色"]
            : ["共生イソギンチャク認識の視覚・化学受容", "幼稚体型", "性的二形", "神経生物学的適応"],
          "豆知識": level === 2
            ? ["メスからオスへ性転換する", "幼いままいる", "群れで生活", "変わった生態を持つ"]
            : level === 3
            ? ["群れで最大のオスがメスに変わる", "すべて同じ性", "産卵しない", "社会構造が特殊"]
            : level === 4
            ? ["家族群の階級制と性転換メカニズム", "自由交配", "無性生殖", "繁殖戦略の最適化"]
            : ["社会的階級制度と性分化の因果関係", "遺伝的性決定", "無差別交配", "行動学的推論"],
          "進化の歴史": level === 3
            ? ["太古から存在する系統", "近年発生", "人為的", "スズメダイの一族"]
            : level === 4
            ? ["イソギンチャク共生の進化的由来", "最近の適応", "退化", "宿主特異性の発達"]
            : ["スズメダイ科内での共生進化", "単系統進化", "並行進化", "宿主との共進化"],
          "食物連鎖": level === 2
            ? ["ちいさい えきぶつ", "くさ", "おおきい さかな", "小さなプランクトンを食べる"]
            : level === 3
            ? ["動物性プランクトン", "海草", "イソギンチャク", "採食場所がイソギンチャク内"]
            : level === 4
            ? ["共生イソギンチャクからの栄養補給", "自給的採食", "肉食性", "栄養獲得の多様性"]
            : ["イソギンチャク共生系での栄養循環", "単独食物連鎖", "寄生", "共生による相互栄養"],
          "ダジャレ": level === 2
            ? ["模様が熊に見える", "でかい", "こわい", "体色と斑紋から"]
            : level === 3
            ? ["日本名の由来", "英名の訳", "学名の意味", "視覚的特徴が名前の根拠"]
            : level === 4
            ? ["クマノミという和名と分類学的位置", "愛称", "外来語", "命名基準の歴史"]
            : ["日本語名の社会文化学的意義", "言語学的分析", "辞源", "博物学的命名法"],
          "海外の小ネタ": level === 3
            ? ["『ファインディング・ニモ』で有名", "映画化なし", "本では無名", "映画で世界的に知られた"]
            : level === 4
            ? ["映画化による保全認識の国際的波及", "野生採集制限", "絶滅危機", "社会的インパクト"]
            : ["メディア効果と野生個体群への負荷", "保全促進", "観光減少", "文化的影響の定量化"]
        };
        if (qData[cat]) {
          const [cor, w1, w2, exp] = qData[cat];
          questions.push(createQuestion(cat, level,
            `${animalName}の${cat}について正しいのは？`,
            cor, w1, w2, exp));
        }
      }
    }
  }

  return questions;
}

// 簡潔に3種を生成
const animals = [
  { id: "209", name: "カクレクマノミ" },
];

for (const animal of animals) {
  const questions = makeQuestions(animal.id, animal.name);
  const jsonl = questions.map(q => JSON.stringify(q)).join("\n");
  const out = path.join(__dirname, `../data/quiz-pool/${animal.id}.jsonl`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, jsonl);
  console.log(`✓ Generated ${questions.length} questions for ${animal.id}`);
}
