// localhost専用のモックデータ層（design.md/requirements.mdのローカル検証方針:
// 本番Firestoreにも、エミュレータにも一切接続しない。Java等の追加インストールも不要）。
// firestore-client.js から shouldUseEmulator() 相当の判定でこちらに切り替える。
// ?debugUserId=test-user と組み合わせて使う想定。
// knowledgeUnlocked は backend/data/demo-knowledge.json（デモ図鑑の知識）から写したもの。

const MOCK_USERS = {
  "test-user": {
    doc: { fishDoctorRank: "見習い研究員" },
    collection: {
      "134": {
        name: "ハマギギ",
        rarity: "super",
        firstFoundAt: new Date().toISOString(),
        completed: false,
        knowledgeUnlocked: {"生息地":"中南米の太平洋側の、沿岸や河口付近にすむ。","水域":false,"水温":false,"深度":false,"郷土料理":"広く知られた郷土料理は、特にない。","類似した仲間":false,"同じ水槽にいる魚":false,"特徴":false,"豆知識":false,"進化の歴史":"ナマズの仲間は、淡水から汽水へ生活の場を広げたグループ。","食物連鎖":false,"ダジャレ":"ハマにいるギギ、ひげでギギッと餌を探す。","海外の小ネタ":"英名は「テテ（Tete）の海のナマズ」という意味。"},
      },
      "48": {
        name: "ジンベエザメ",
        rarity: "normal",
        firstFoundAt: new Date().toISOString(),
        completed: true,
        knowledgeUnlocked: {"生息地":false,"水域":false,"水温":"世界の温かい海に、広くすむ。","深度":false,"郷土料理":"食用にはされず、保護される動物として知られる。","類似した仲間":false,"同じ水槽にいる魚":false,"特徴":false,"豆知識":"12m以上になる、世界最大の魚。","進化の歴史":false,"食物連鎖":false,"ダジャレ":"甚平を着たような模様から、「ジンベエ」と呼ばれる。","海外の小ネタ":false},
      },
      "250": {
        name: "メイチダイ",
        rarity: "rare",
        firstFoundAt: new Date().toISOString(),
        completed: false,
        knowledgeUnlocked: {},
      },
    },
  },
};

// #832: 判断の記録つき／なしの履歴（古い履歴は selectionReason が無い）
const MOCK_QUIZ_HISTORY = [
  {
    id: "h2",
    category: "食物連鎖",
    question: "ジンベエザメが主に食べるものはどれ？",
    isCorrect: true,
    generatedBy: "live-agent",
    runId: "7c1e9a24b3f0",
    selectionReason: "ジンベエザメがプランクトンを食べる大型魚という意外性があり、この生き物ならではの問題になるため",
    consideredCategories: [
      { category: "生息地", question: "ジンベエザメが暮らす海域は？", grounded: true },
      { category: "ダジャレ", question: "ジンベエ名誉教授のダジャレクイズ", grounded: false },
      { category: "食物連鎖", question: "ジンベエザメが主に食べるものはどれ？", grounded: true },
    ],
    guard: null,
  },
  { id: "h1", category: "水温", question: "ジンベエザメが快適な水温は？", isCorrect: false, generatedBy: null },
];

export async function mockGetQuizHistory() {
  return MOCK_QUIZ_HISTORY;
}

export async function mockGetUserDoc(userId) {
  return MOCK_USERS[userId]?.doc ?? null;
}

export async function mockGetCollectionEntry(userId, animalId) {
  return MOCK_USERS[userId]?.collection?.[animalId] ?? null;
}

export function mockWatchCollection(userId, onChange) {
  const entries = Object.entries(MOCK_USERS[userId]?.collection ?? {}).map(([id, data]) => ({
    id,
    ...data,
  }));
  // 実際のonSnapshotと同じく非同期で一度だけ呼ぶ
  Promise.resolve().then(() => onChange(entries));
  return Promise.resolve(() => {}); // unsubscribe相当(no-op)
}
