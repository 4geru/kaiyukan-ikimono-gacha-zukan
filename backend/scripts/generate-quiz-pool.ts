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
  // Distribute correctIndex equally: 0, 1, 2, 0, 1, 2, ...
  const correctIndex = questionCount % 3;
  questionCount++;

  // Arrange choices based on correctIndex
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

function generateWhaleSharkQuestions(animalId: string): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  questionCount = 0; // Reset for each animal

  // レベル1: 生息地, 水域, 水温, 深度, 特徴, 豆知識, 食物連鎖, ダジャレ (8問)
  questions.push(
    createQuestion(
      animalId, "生息地", 1,
      "じんべえざめは どこに すんでいる?",
      "あたたかい うみ", "つめたい うみ", "だむ",
      "説明に「世界中の暖かい海域に生息」と書いてあります", "official"
    ),
    createQuestion(
      animalId, "水域", 1,
      "じんべえざめは どんな ところに いる?",
      "うみ", "かわ", "いけ",
      "海に住む魚の仲間です", "official"
    ),
    createQuestion(
      animalId, "水温", 1,
      "じんべえざめが すきな おんどは?",
      "あたたかい", "つめたい", "ふつう",
      "暖かい海域に生息していますね", "official"
    ),
    createQuestion(
      animalId, "深度", 1,
      "じんべえざめは うみの どの ふかさに いる?",
      "うみの うえのほう", "うみのそこ", "いつも ひこうき",
      "大きなサメなので浅い海を泳ぎます", "official"
    ),
    createQuestion(
      animalId, "特徴", 1,
      "じんべえざめの からだは どんな おおきさ?",
      "とっても おおきい", "ちいさい", "ふつう",
      "説明に「12m以上になる世界最大の魚類」と書いてあります", "official"
    ),
    createQuestion(
      animalId, "豆知識", 1,
      "じんべえざめは なにを たべる?",
      "ちいさい えきぶつ", "だいきな さかな", "くさ",
      "説明に「プランクトンを食べます」と書いてあります", "official"
    ),
    createQuestion(
      animalId, "食物連鎖", 1,
      "じんべえざめは だれに たべられる?",
      "ほとんど たべられない", "いるか", "あざらし",
      "世界最大の魚なので天敵がほぼいません", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 1,
      "じんべえざめは『じんべえ』と よばれるのは、なぜ?",
      "じんべえの もように みえるから", "にほんじんだから", "でかいから",
      "体の模様が着物の甚兵衛（じんべえ）に似ているから名前がつきました", "general"
    )
  );

  // レベル2: 13カテゴリ (13問)
  questions.push(
    createQuestion(
      animalId, "生息地", 2,
      "ジンベエザメが野生でいるのはどこ?",
      "世界中の暖かい海", "北極海", "山",
      "説明に「世界中の暖かい海域に生息」とあります", "official"
    ),
    createQuestion(
      animalId, "水域", 2,
      "ジンベエザメはどんな水に住んでいる?",
      "海水", "真水", "塩辛い池",
      "海に生息するサメです", "official"
    ),
    createQuestion(
      animalId, "水温", 2,
      "ジンベエザメが好む水温は?",
      "温かい", "冷たい", "どちらでもいい",
      "暖かい海域に生息するので温水を好みます", "official"
    ),
    createQuestion(
      animalId, "深度", 2,
      "ジンベエザメはおもにどの深さにいる?",
      "浅い海", "深い海", "海底",
      "浅い海を泳いでいる大型の魚です", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 2,
      "ジンベエザメは人間に利用されているか?",
      "サメの仲間として利用される", "完全に食べない", "高級食材",
      "サメのひれなどが使われることがあります", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 2,
      "ジンベエザメの科に属する他のサメはいるか?",
      "いない、独自の科", "シロワニ", "マグロ",
      "ジンベエザメは独自の科を形成しています", "official"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 2,
      "ジンベエザメと同じ水族館にいる別のエイはいるか?",
      "ナンヨウマンタがいる", "マンボウ", "タコ",
      "太平洋コーナーに展示されています", "official",
      ["ナンヨウマンタ"]
    ),
    createQuestion(
      animalId, "特徴", 2,
      "ジンベエザメの最大のとくちょうは?",
      "とても大きい", "色が派手", "すばやい",
      "世界最大の魚として知られています", "official"
    ),
    createQuestion(
      animalId, "豆知識", 2,
      "ジンベエザメは何を食べて生きている?",
      "プランクトン", "大きな魚", "海草",
      "説明に「プランクトンを食べます」と書かれています", "official"
    ),
    createQuestion(
      animalId, "進化の歴史", 2,
      "ジンベエザメはいつ頃から存在するサメか?",
      "太古の時代から", "近年発見された", "人工的に作られた",
      "サメの仲間として太古から進化してきました", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 2,
      "ジンベエザメを食べる生き物は?",
      "ほぼいない", "シャチ", "人間",
      "世界最大の魚は天敵がほぼいません", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 2,
      "ジンベエザメの「ジンベエ」ってなぜ？",
      "着物の甚兵衛に似たもようだから", "人気があるから", "神様だから",
      "体の模様が着物の甚兵衛に似ていることが名前の由来です", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 2,
      "ジンベエザメの英語での呼び名は?",
      "Whale shark", "Giant shark", "Big fish",
      "Whale（クジラのような）という言葉が使われます", "general"
    )
  );

  // レベル3: 生息地, 水域, 水温, 深度, 郷土料理, 類似した仲間, 同じ水槽にいる魚, 特徴, 豆知識, 進化の歴史, 食物連鎖, ダジャレ, 海外の小ネタ (13問)
  questions.push(
    createQuestion(
      animalId, "生息地", 3,
      "ジンベエザメが野生で生息する地域として最も正しいのはどれ?",
      "赤道付近の暖かい海", "カナダの沿岸", "北極海",
      "説明に「世界中の暖かい海域に生息」と記載されています", "official"
    ),
    createQuestion(
      animalId, "水域", 3,
      "ジンベエザメの生息環境は次のどれ?",
      "外洋の沿岸域", "河口", "冷たい外洋",
      "温かい海の沿岸域で見られます", "general"
    ),
    createQuestion(
      animalId, "水温", 3,
      "ジンベエザメが生活できる水温の特性は?",
      "熱帯・亜熱帯の温かい水", "冷水", "温度変化に強い",
      "暖かい海域に生息することから温水を必要とします", "official"
    ),
    createQuestion(
      animalId, "深度", 3,
      "ジンベエザメが活動する水深はおおよそ?",
      "表層から中層", "深海", "海底",
      "プランクトンを食べるため、浅い層で活動します", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 3,
      "ジンベエザメは人間の食べ物として?",
      "食べられることもあった", "完全に食べない", "高級食材",
      "サメの仲間として利用されることもあります", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 3,
      "ジンベエザメと同じサメ科に属する実在する生物がこの水族館にいるか?",
      "いない、独特な科", "シロワニ", "マグロ",
      "ジンベエザメは独自の科を形成しています", "official"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 3,
      "ジンベエザメと同じ水槽にいるのは?",
      "ナンヨウマンタ", "ダイオウイカ", "クマノミ",
      "太平洋コーナーに展示されています", "official",
      ["ナンヨウマンタ"]
    ),
    createQuestion(
      animalId, "特徴", 3,
      "世界最大の魚であるジンベエザメの最大サイズは約?",
      "12m以上", "5m", "20m",
      "説明に「12m以上になる世界最大の魚類」と記載", "official"
    ),
    createQuestion(
      animalId, "豆知識", 3,
      "ジンベエザメが最大の魚なのに小さなプランクトンを食べているのは何故か?",
      "口が大きくて濾過(ろか)できるから", "歯が弱いから", "顎が小さいから",
      "大きな口でプランクトンを食べる濾過食動物です", "general"
    ),
    createQuestion(
      animalId, "進化の歴史", 3,
      "ジンベエザメは何の時代から存在している?",
      "太古の昔から存在する系統", "近年発見された", "人工的に作られた",
      "サメの仲間として太古から進化してきた系統です", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 3,
      "ジンベエザメが食べるプランクトンとは何?",
      "小さな海の生き物", "海草", "魚の卵",
      "微細な海洋生物の総称がプランクトンです", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 3,
      "ジンベエザメは『甚兵衛鮫』と書くのは体の何が理由?",
      "模様(もよう)", "大きさ", "色",
      "体の模様が着物の甚兵衛に似ていることから", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 3,
      "ジンベエザメの英名『Whale shark』の『Whale』は何を意味する?",
      "クジラのような大きさ", "クジラの食べ物", "クジラの敵",
      "Whaleはクジラ、大きさを表します", "general"
    )
  );

  // レベル4: 生息地, 水域, 水温, 深度, 郷土料理, 類似した仲間, 同じ水槽にいる魚, 特徴, 豆知識, 進化の歴史, 食物連鎖, ダジャレ, 海外の小ネタ (13問)
  questions.push(
    createQuestion(
      animalId, "生息地", 4,
      "ジンベエザメの分布域における主な水温制限要因は?",
      "年間平均21℃以上の温かい海", "15℃程度", "0℃以下",
      "暖かい海域に限定されます", "general"
    ),
    createQuestion(
      animalId, "水域", 4,
      "ジンベエザメが高密度で集まるのはどのような環境?",
      "プランクトンが豊富な沿岸域", "深海", "内湾",
      "プランクトンの豊富さが集まる場所を決めます", "general"
    ),
    createQuestion(
      animalId, "水温", 4,
      "ジンベエザメと変温動物の関係は?",
      "冷たい水では活動が鈍くなる", "温度に無関係", "冷たい水を好む",
      "変温動物として水温に依存した活動をします", "general"
    ),
    createQuestion(
      animalId, "深度", 4,
      "ジンベエザメが主に活動する水深帯の理由は?",
      "プランクトンが表層に多いから", "酸素が深いところにあるから", "圧力が低いから",
      "食料となるプランクトンの分布に適応しています", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 4,
      "アジア地域でサメのひれが利用されるのは何のためか?",
      "スープや高級食材として", "薬用", "装飾品",
      "フカヒレとして高級食材として珍重されています", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 4,
      "ジンベエザメと同じオーダー（目）に属する他のサメは?",
      "シロワニ", "トビウオ", "マグロ",
      "シロワニもサメ目に属しています", "general"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 4,
      "ジンベエザメと共存する大型の板鰓類(ばんさいるい)は?",
      "ナンヨウマンタ", "オコゼ", "ハタ",
      "ナンヨウマンタは同じ太平洋コーナーにいます", "official",
      ["ナンヨウマンタ"]
    ),
    createQuestion(
      animalId, "特徴", 4,
      "ジンベエザメが濾過食をしているという解剖学的証拠は?",
      "口が非常に大きく鰓裂が発達している", "歯がない", "味覚器官が発達",
      "濾過食に適応した口の構造を持ちます", "general"
    ),
    createQuestion(
      animalId, "豆知識", 4,
      "世界最大の魚が小さなプランクトンを食べるというのは何を示すか?",
      "プランクトンの豊富さが生態系を支える", "大きさは食性に無関係", "食物連鎖の頂点",
      "豊富な食料に適応した進化の例です", "general"
    ),
    createQuestion(
      animalId, "進化の歴史", 4,
      "ジンベエザメの濾過食への進化は何によってもたらされたか?",
      "プランクトン資源の利用可能性", "光合成の発達", "天敵の出現",
      "新しい食物資源の利用が進化の駆動力になりました", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 4,
      "ジンベエザメが掃食する動物性プランクトンの海洋生態系での役割は?",
      "栄養物質循環と資源補充の制御", "毒性物質の蓄積", "温暖化の指標",
      "海の栄養循環に大きな役割を果たします", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 4,
      "ジンベエザメの「甚兵衛」が加わったのは日本での観察が基になったのか?",
      "体の模様が着物に似ていたから", "日本での発見が遅かったから", "サイズが変わったから",
      "视覚的特徴が名前の由来になった例です", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 4,
      "学名『Rhincodon typus』における『Rhincodon』が意味するのは?",
      "鼻のあるサメ", "大きなサメ", "古い種",
      "Rhinodon=鼻のあるという意で、特徴的な鼻孔が由来です", "general"
    )
  );

  // レベル5: 13カテゴリ (13問で60問合計)
  questions.push(
    createQuestion(
      animalId, "生息地", 5,
      "インド太平洋域でのジンベエザメの分布が制限される主要な生物物理的要因は?",
      "水温躍層(おんどやくそう)の深度と季節変動", "プランクトン群集の組成", "塩分濃度",
      "水温が主要な分布限定要因です", "general"
    ),
    createQuestion(
      animalId, "水域", 5,
      "ジンベエザメが季節的に沿岸域に集中する生態学的メカニズムは?",
      "湧昇流による栄養塩供給とプランクトン増殖", "産卵のための行動", "捕食者回避",
      "海洋学的現象がプランクトンを介して影響します", "general"
    ),
    createQuestion(
      animalId, "水温", 5,
      "ジンベエザメの生理的体温調節能と水温適応の制約は?",
      "約15℃以下では摂食活動が停止する", "20℃以上で活動する", "温度非依存",
      "変温動物の生理的制約があります", "general"
    ),
    createQuestion(
      animalId, "深度", 5,
      "ジンベエザメが実施する日周鉛直移動の生態学的機能は?",
      "食物資源追従と捕食者回避", "産卵行動", "体温調節",
      "プランクトンの日周移動に応答した行動と考えられます", "general"
    ),
    createQuestion(
      animalId, "郷土料理", 5,
      "ジンベエザメを対象とした持続的漁業が存続している地域の条件は?",
      "伝統的漁業文化と食料安全保障の両立の必要性", "商業的価値のみの考慮", "食物連鎖での地位",
      "文化的・経済的背景が関連しています", "general"
    ),
    createQuestion(
      animalId, "類似した仲間", 5,
      "ジンベエザメ科と他のサメの系統分類学的相違は?",
      "濾過食の完全な適応と単一科の独自性", "大きさ", "色の多様性",
      "分類学的な独自性があります", "general"
    ),
    createQuestion(
      animalId, "同じ水槽にいる魚", 5,
      "ジンベエザメとナンヨウマンタの生態的地位における資源分割は?",
      "濾過食vs遊泳摂食による採食戦略の相違", "同じ生態的地位", "相互競争による排除",
      "異なる採食様式により共存が可能です", "official",
      ["ナンヨウマンタ"]
    ),
    createQuestion(
      animalId, "特徴", 5,
      "ジンベエザメの濾過機構としての鰓裂構造の進化的適応は?",
      "濾過機構としての発達と鰓把(さいは)の高度化", "鰓の数の増加", "呼吸機能の低下",
      "濾過食に特化した解剖学的特徴です", "general"
    ),
    createQuestion(
      animalId, "豆知識", 5,
      "ジンベエザメの個体群動態の現状についての科学的評価基準は?",
      "国際自然保護連合(IUCN)による保全状況評価", "目撃情報のみ", "漁獲記録のみ",
      "IUCNの評価が公式な評価基準です", "general"
    ),
    createQuestion(
      animalId, "進化の歴史", 5,
      "ジンベエザメの濾過食への進化は鯨類との収束進化の例として何を示すか?",
      "異なる系統が同じ生態的地位を占める適応進化", "単系統進化の例", "平行進化",
      "進化生物学の重要な概念です", "general"
    ),
    createQuestion(
      animalId, "食物連鎖", 5,
      "ジンベエザメが食物連鎖で占める栄養段階(トロフィックレベル)は?",
      "栄養段階2～3（二次消費者）", "一次消費者", "最上位捕食者",
      "プランクトン食性により低い栄養段階です", "general"
    ),
    createQuestion(
      animalId, "ダジャレ", 5,
      "学名『Rhincodon typus』における『-codon』接尾辞の命名学的意義は?",
      "ギリシャ語で歯を意味し、分類体系を示す", "大きさを表す用語", "捕食性を示す接尾辞",
      "古い学名命名法の標準接尾辞です", "general"
    ),
    createQuestion(
      animalId, "海外の小ネタ", 5,
      "ジンベエザメが国際商業漁業の主要対象となった最大の経済的理由は?",
      "フカヒレと肝臓油の高い市場価値", "肉の品質の優位性", "観光資源としての価値のみ",
      "経済的価値が保全の課題になっています", "general"
    )
  );

  return questions;
}

const output = generateWhaleSharkQuestions("48");
const jsonlContent = output.map((q) => JSON.stringify(q)).join("\n");
const outputPath = path.join(__dirname, "../data/quiz-pool/48.jsonl");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, jsonlContent);
console.log(`✓ Generated ${output.length} questions for animalId 48 in ${outputPath}`);
