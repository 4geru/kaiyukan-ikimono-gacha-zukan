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

let questionCount = 0;

function createQuestion(
  animalId: string,
  category: string,
  level: number,
  question: string,
  correct: string,
  wrong1: string,
  wrong2: string,
  explanation: string,
  factSource: "official" | "wikipedia" | "general" | "none" = "official",
  groundingNames: string[] = []
): QuizQuestion {
  const correctIndex = questionCount % 3;
  questionCount++;

  let choices: string[];
  if (correctIndex === 0) {
    choices = [correct, wrong1, wrong2];
  } else if (correctIndex === 1) {
    choices = [wrong1, correct, wrong2];
  } else {
    choices = [wrong1, wrong2, correct];
  }

  return {
    id: `${animalId}-${category}-${level}`,
    animalId,
    category,
    level,
    question,
    choices,
    correctIndex,
    explanation,
    factSource,
    groundingNames,
    generatedBy: "claude-haiku-4-5",
    generatedAt: new Date().toISOString(),
    review: { status: "pending" },
  };
}

function generateMantaQuestions(animalId: string): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  questionCount = 0;

  // レベル1: 生息地, 水域, 水温, 深度, 特徴, 豆知識, 食物連鎖, ダジャレ (8問)
  questions.push(
    createQuestion(
      animalId, "生息地", 1,
      "なんよう まんたは どこに すんでいる?",
      "あたたかい うみ", "つめたい うみ", "だむ",
      "インド洋から太平洋の暖かい海に住みます", "official"
    ),
    createQuestion(
      animalId, "水域", 1,
      "なんよう まんたは どんな ところに いる?",
      "うみ", "かわ", "いけ",
      "海に住むエイの仲間です", "official"
    ),
    createQuestion(
      animalId, "水温", 1,
      "なんよう まんたが すきな おんどは?",
      "あたたかい", "つめたい", "ふつう",
      "暖かい海域に生息しています", "official"
    ),
    createQuestion(
      animalId, "深度", 1,
      "なんよう まんたは うみの どの ふかさに いる?",
      "うみの うえのほう", "うみのそこ", "いつも ひこうき",
      "浅い海を泳ぐ大きなエイです", "official"
    ),
    createQuestion(
      animalId, "特徴", 1,
      "なんよう まんたの からだは どんな かたち?",
      "羽のように広い", "丸い", "長い",
      "大きな翼のような胸鰭を持っています", "official"
    ),
    createQuestion(
      animalId, "豆知識", 1,
      "なんよう まんたは なにを たべる?",
      "ちいさい えきぶつ", "だいきな さかな", "くさ",
      "説明に「プランクトンを効率よく摂食する」と書いてあります", "official"
    ),
    createQuestion(
      animalId, "食物連鎖", 1,
      "なんよう まんたは だれに たべられる?",
      "さめ", "いるか", "ほとんど いない",
      "大きなエイなので敵がほぼいません", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 1,
      "『マンタ』の なまえは どこから きた?",
      "スペイン語で『毛布』という意味", "大きさから", "色から",
      "スペイン語の『manta』（毛布）が由来です", "general"
    )
  );

  // レベル2: 13カテゴリ (13問)
  questions.push(
    createQuestion(
      animalId, "生息地", 2,
      "ナンヨウマンタが野生でいるのはどこ?",
      "インド洋から太平洋の暖かい海", "北極海", "淡水湖",
      "暖かい海域に分布しています", "official"
    ),
    createQuestion(
      animalId, "水域", 2,
      "ナンヨウマンタはどんな水に住んでいる?",
      "海水", "真水", "塩辛い池",
      "海に生息するエイです", "official"
    ),
    createQuestion(
      animalId, "水温", 2,
      "ナンヨウマンタが好む水温は?",
      "温かい", "冷たい", "どちらでもいい",
      "暖かい海域に生息するので温水を好みます", "official"
    ),
    createQuestion(
      animalId, "深度", 2,
      "ナンヨウマンタはおもにどの深さにいる?",
      "浅い海～中層", "深い海", "海底",
      "浅い海から中層を泳ぎます", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 2,
      "ナンヨウマンタは人間に利用されているか?",
      "ひれが利用される", "完全に食べない", "養殖されている",
      "マンタのひれが水産物として利用されています", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 2,
      "ナンヨウマンタと同じイトマキエイ科の仲間はいるか?",
      "他にマンタの仲間がいる", "イトマキエイだけ", "シロワニ",
      "イトマキエイ科には複数の仲間がいます", "general"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 2,
      "ナンヨウマンタと同じ水族館にいるサメはいるか?",
      "ジンベエザメがいる", "いない", "ホオジロザメ",
      "太平洋コーナーに展示されています", "official",
      ["ジンベエザメ"]
    ),
    createQuestion(
      animalId, "特徴", 2,
      "ナンヨウマンタの最大サイズは?",
      "体盤幅4m以上", "1m程度", "10m以上",
      "説明に「体盤幅が4m以上になる」と書かれています", "official"
    ),
    createQuestion(
      animalId, "豆知識", 2,
      "ナンヨウマンタはどうやってプランクトンを食べているか?",
      "頭びれを広げて効率よく摂食する", "歯で食べる", "吸い込む",
      "説明に「あたまびれを広げることで摂食する」と記載", "official"
    ),
    createQuestion(
      animalId, "進化の歴史", 2,
      "ナンヨウマンタはいつ頃から存在するエイか?",
      "太古の時代から", "近年発見された", "人工的に作られた",
      "エイの仲間として太古から進化してきました", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 2,
      "ナンヨウマンタを食べる生き物は?",
      "サメ", "ほぼいない", "人間だけ",
      "大きなエイは天敵がほぼいません", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 2,
      "『マンタ』という名前の意味は?",
      "スペイン語で『毛布』", "大きなエイ", "海の王様",
      "スペイン語に由来する名前です", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 2,
      "ナンヨウマンタは何カ国で見ることができるか?",
      "多くの東南アジア～太平洋諸国", "1カ国だけ", "北米のみ",
      "インド洋から太平洋の広い地域に分布しています", "general"
    )
  );

  // レベル3: 13カテゴリ (13問)
  questions.push(
    createQuestion(
      animalId, "生息地", 3,
      "ナンヨウマンタの分布が限定される主な理由は?",
      "水温が高い熱帯・亜熱帯海域に限定", "光の深度", "食物の偏在",
      "暖かい海域のみに生息しています", "official"
    ),
    createQuestion(
      animalId, "水域", 3,
      "ナンヨウマンタが多く見られるのはどのような環境?",
      "プランクトンが豊富な沿岸域", "外洋の砂漠域", "河口",
      "プランクトンが豊富な場所に集まります", "general"
    ),
    createQuestion(
      animalId, "水温", 3,
      "ナンヨウマンタが生活できる水温の範囲は?",
      "20℃以上の温かい海", "15℃程度", "0℃以下",
      "熱帯・亜熱帯の温かい水が必要です", "general"
    ),
    createQuestion(
      animalId, "深度", 3,
      "ナンヨウマンタが活動する主な水深帯は?",
      "表層から中層", "深海", "海底",
      "プランクトンを食べるため浅い層で活動します", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 3,
      "マンタのひれが高値で取引される理由は?",
      "スープなどの高級食材として", "薬用", "装飾品",
      "フカヒレ同様に水産物として珍重されています", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 3,
      "ナンヨウマンタと同じイトマキエイ科に属する実在の生物は?",
      "イトマキエイ", "シロワニ", "マグロ",
      "イトマキエイもイトマキエイ科に属しています", "general"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 3,
      "ナンヨウマンタと共存する最大のサメは?",
      "ジンベエザメ", "ホオジロザメ", "トラザメ",
      "太平洋コーナーで一緒に展示されています", "official",
      ["ジンベエザメ"]
    ),
    createQuestion(
      animalId, "特徴", 3,
      "ナンヨウマンタの『あたまびれ』の機能は?",
      "プランクトン摂食時に獲物を誘導する", "推進力を得る", "隠れるため",
      "説明に「頭びれを広げてプランクトンを効率よく摂食」と記載", "official"
    ),
    createQuestion(
      animalId, "豆知識", 3,
      "ナンヨウマンタが大きさのわりに知能が高いという証拠は?",
      "複雑な採食行動と学習能力", "色の認識", "速度",
      "エイの中でも認知能力が高いことが知られています", "general"
    ),
    createQuestion(
      animalId, "進化の歴史", 3,
      "ナンヨウマンタの濾過食への進化は何を示すか?",
      "食物資源の利用可能性への適応", "逃げるための進化", "光合成",
      "プランクトン資源を利用した進化の例です", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 3,
      "ナンヨウマンタが食べるプランクトンの種類は?",
      "主に動物性プランクトン", "植物プランクトンのみ", "魚の卵",
      "微小な海洋生物を食べています", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 3,
      "『マンタレイ』の『レイ』は何を意味するか?",
      "英語の『ray』（エイ）", "光線", "王様",
      "英語でレイはエイを意味します", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 3,
      "ナンヨウマンタが『Mobula alfredi』と学名で呼ばれるのは?",
      "学者の名前『Alfred』に由来", "大きさから", "時代から",
      "人名に由来する学名の例です", "general"
    )
  );

  // レベル4: 13カテゴリ (13問)
  questions.push(
    createQuestion(
      animalId, "生息地", 4,
      "ナンヨウマンタの分布上の限定要因として最も重要なのは?",
      "水温躍層と年間水温の最低値", "塩分濃度", "光量",
      "水温が主要な分布限定要因です", "general"
    ),
    createQuestion(
      animalId, "水域", 4,
      "ナンヨウマンタが高密度で集まるのはどのような環境?",
      "沿岸湧昇流によるプランクトン増殖域", "外洋中央部", "島の陰",
      "栄養物質の供給が多い場所を好みます", "general"
    ),
    createQuestion(
      animalId, "水温", 4,
      "ナンヨウマンタと変温動物の生理的制約は?",
      "15℃以下では活動が大幅に低下する", "温度に無関係", "冷水好適",
      "変温動物として水温に依存した活動をします", "general"
    ),
    createQuestion(
      animalId, "深度", 4,
      "ナンヨウマンタの日周行動パターンは?",
      "昼間は浅い層、夜間は中層～深層へ移動", "一定の深さに留まる", "深海への移動",
      "採食パターンが日中心である可能性があります", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 4,
      "マンタ漁業が持続している地域の経済的背景は?",
      "地域社会における伝統漁業と経済の依存", "高級食材の需要のみ", "スポーツ漁業",
      "多面的な経済的背景があります", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 4,
      "ナンヨウマンタとイトマキエイの生態学的相違点は?",
      "サイズと分布域の違い、採食様式が類似", "食性が異なる", "生息地が別",
      "両種とも濾過食ですが、生態的ニッチが異なります", "general"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 4,
      "ナンヨウマンタとジンベエザメの共存の理由は?",
      "採食戦略や採食時間が異なる資源分割", "同じ食物連鎖位置", "競争排除",
      "異なるプランクトン利用様式により共存可能です", "official",
      ["ジンベエザメ"]
    ),
    createQuestion(
      animalId, "特徴", 4,
      "ナンヨウマンタの頭びれの構造学的特徴は?",
      "ロール状に丸まる構造で採食効率を高める", "鰓に直結", "防御器官",
      "採食に特化した解剖学的適応です", "general"
    ),
    createQuestion(
      animalId, "豆知識", 4,
      "マンタの個体識別が可能である理由は?",
      "腹部の斑紋パターンの個体差", "背側の色彩", "大きさ",
      "科学調査で個体の再捕捉が可能です", "general"
    ),
    createQuestion(
      animalId, "進化の歴史", 4,
      "マンタの濾過食への進化は何によって駆動されたか?",
      "プランクトン資源の豊富さと経時的な利用可能性", "光の深度", "競争",
      "新しい食物資源の利用が進化の駆動力です", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 4,
      "マンタが掃食するプランクトンの栄養学的意義は?",
      "一次生産の上位栄養段階への転送効率を調整", "エネルギーロス", "栄養集約",
      "海洋栄養循環に重要な役割を果たします", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 4,
      "『Mobula』属は何を意味するギリシャ語起源か?",
      "『小さな悪魔』の意で、体形に由来", "大きさ", "速度",
      "古い学名命名法での意図的な比喩です", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 4,
      "マンタが国際漁業の対象になった歴史的背景は?",
      "ひれの市場需要の拡大と価格上昇", "肉質の改善", "観光振興",
      "経済的価値が保全課題になっています", "general"
    )
  );

  // レベル5: 13カテゴリ (13問で60問合計)
  questions.push(
    createQuestion(
      animalId, "生息地", 5,
      "ナンヨウマンタの分布パターンと海流循環系の関係は?",
      "熱帯・亜熱帯環流による分布制御と季節変動", "プランクトン分布のみ", "大陸棚",
      "海洋物理が分布を支配しています", "general"
    ),
    createQuestion(
      animalId, "水域", 5,
      "マンタが集中採食する沿岸湧昇流の栄養学的メカニズムは?",
      "深層水の栄養塩供給による基礎生産増加とプランクトン増殖", "光の反射", "温度低下",
      "海洋学的現象がプランクトン群集を支配します", "general"
    ),
    createQuestion(
      animalId, "水温", 5,
      "マンタの体温調節と代謝の生理学的基盤は?",
      "変温動物としての酵素活動の温度係数(Q10)依存性", "恒温性", "無機的代謝",
      "生化学的制約が活動を制御します", "general"
    ),
    createQuestion(
      animalId, "深度", 5,
      "マンタの垂直分布と光度勾配(こうど)の関係は?",
      "プランクトンの光応答性と採食効率の最適化", "捕食者回避", "圧力適応",
      "光環境がプランクトン分布を支配します", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 5,
      "マンタ漁業の国際規制と保全生物学的背景は?",
      "個体群減少と成熟遅延による回復の遅さ", "商業価値のみ", "文化的利用",
      "生態学的脆弱性が保全を必要とします", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 5,
      "イトマキエイ科内でのナンヨウマンタとイトマキエイの系統分類学的関係は?",
      "姉妹分類群で、板鰓類の濾過食の独立進化を示す", "同一種", "系統不明",
      "分類学的な重要な例示です", "general"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 5,
      "マンタとジンベエザメの生態的地位における適応の違いは?",
      "採食様式・摂食器官・遊泳様式における収束進化と分化", "食性が同じ", "競争関係",
      "異なる進化経路が示されています", "official",
      ["ジンベエザメ"]
    ),
    createQuestion(
      animalId, "特徴", 5,
      "マンタの頭びれと濾過機構の生理解剖学的統合は?",
      "流体力学と採食行動の最適化による摂食効率向上メカニズム", "防御器官化", "衰退構造",
      "複雑な生理学的適応が統合されています", "general"
    ),
    createQuestion(
      animalId, "豆知識", 5,
      "マンタの中央脳構造と認知能力の進化的意義は?",
      "プランクトン採食に基づく複雑な行動学習と社会性", "速度感知", "光感覚",
      "神経生物学的進化が示唆されています", "general"
    ),
    createQuestion(
      animalId, "進化の歴史", 5,
      "マンタ属の濾過食進化の系統地理学的背景は?",
      "インド太平洋の地理的隔離と資源環境への適応分化", "単一進化", "外来導入",
      "地質・地理的要因が進化を制御してきました", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 5,
      "マンタが占める栄養段階とその海洋生態系における役割は?",
      "栄養段階2～3で動物性プランクトン食性による二次消費", "最高位捕食者", "分解者",
      "エネルギー流の主要転送者です", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 5,
      "学名『Mobula alfredi』の命名学的意図と学史的背景は?",
      "マンタ属設立時の記載者『Alfred』への献名と学問的承継", "地名", "時代",
      "19世紀の学名命名慣例を示す例です", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 5,
      "マンタ保全の国際的取り組みとワシントン条約（CITES）の経緯は?",
      "過度な漁獲圧による個体群減少への国際規制の導入", "非保全状態", "観光資源化",
      "国際的な保全ガバナンスの重要な事例です", "general"
    )
  );

  return questions;
}

const output = generateMantaQuestions("206");
const jsonlContent = output.map((q) => JSON.stringify(q)).join("\n");
const outputPath = path.join(__dirname, "../data/quiz-pool/206.jsonl");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, jsonlContent);
console.log(`✓ Generated ${output.length} questions for animalId 206 in ${outputPath}`);
