// 学年別漢字配当表（2020年度施行の小学校学習指導要領）の1年生80字・2年生160字。
// validate-quiz-pool.ts のレベル2の漢字検査（docs/specs/831-quiz-pool/pool-format.md の追加ルール1）で使う。

export const KANJI_GRADE_1 =
  "一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六";

export const KANJI_GRADE_2 =
  "引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話";

// 一覧の写し間違いを防ぐため、読み込み時に件数と重複を確かめる
for (const [label, chars, expected] of [
  ["1年", KANJI_GRADE_1, 80],
  ["2年", KANJI_GRADE_2, 160],
] as const) {
  const list = [...chars];
  if (list.length !== expected || new Set(list).size !== expected) {
    throw new Error(`漢字配当表（${label}）の件数が ${expected} 字ではありません: ${list.length} 字（重複なし ${new Set(list).size} 字）`);
  }
}

export const KANJI_GRADE_1_SET = new Set(KANJI_GRADE_1);
export const KANJI_GRADE_2_SET = new Set(KANJI_GRADE_2);
export const KANJI_GRADE_12_SET = new Set(KANJI_GRADE_1 + KANJI_GRADE_2);
