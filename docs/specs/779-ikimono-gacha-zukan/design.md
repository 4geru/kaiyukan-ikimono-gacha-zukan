Issue: https://github.com/4geru/tweet-bookmark/issues/779

# 設計: 海遊館いきものガチャ図鑑

requirements.md の要件と、[Fableヒアリング](../../2026-09-18-22-40-fable-design-hearing.md)で指摘された設計上の借金（ユーザー識別欠如・状態管理・識別精度・自律性の欠如）を解消するための設計。対象範囲は次の3点。

1. ユーザー識別・状態管理・Firestore構造
2. 魚識別マッチングの精度改善
3. クイズのエージェント化（最重要・新規要求）

コードの実装はこのdesign.mdの対象外。設計のみ。

> **[Fableレビュー](../../2026-09-18-22-55-fable-design-review.md)を受けた追記（2026-09-18）**: このdesign.mdが解消するのは「クイズの出題カテゴリを自律的に選ぶ」という**出題内容選択の自律性**のみ。requirements.mdの「対話学習」セクションが求める「基礎情報を一通り話すまでクイズを保留する」という**会話フロー全体の自律的な進行管理**は対象外（意図的な絞り込み）。この部分は別issueで設計すること。

---

## 1. ユーザー識別・状態管理・Firestore構造

### 1.1 問題

現状の `server.ts` は `pendingQuizByAnimalId: Map<string, QuizQuestion>` というグローバルMapで、キーが `animalId` のみ。userIdを一切扱っていない。これは2つの独立した欠陥を持つ。

- **単一インスタンスでも壊れる**: 2人のユーザーがほぼ同時に同じ魚（同じ水槽の同じ案内板）を選ぶと、後勝ちで前のユーザーのクイズ状態が上書きされる。
- **複数インスタンスでは常に壊れる**: Cloud Runはデフォルトでスケールアウトしうるため、別インスタンスに当たった時点でメモリ上のMapは別物になる。

どちらもuserIdを状態のキーに含めないと直らない、根本的に同じ原因の問題。

### 1.2 userId取得・伝播方針

LINE Webhookの `message` / `postback` イベントは、1:1トーク上のユーザー起点イベントであれば `event.source.type === "user"` かつ `event.source.userId` を持つ（グループ/ルームの場合は `groupId`/`roomId` も付くが、本アプリはまず1:1チャット運用を前提とする）。

`handleEvent` の入り口で `event.source.userId` を取り出し、以降すべてのハンドラ（`handleImageMessage` / `handleSelectFish` / `handleAnswerQuiz` / `handlePostback`）にシグネチャの先頭引数として通す。userIdが取得できないイベント（グループ経由など、将来の「思い出振り返り動画」機能用の別フロー）は、このフローでは無視する。

### 1.3 Firestoreコレクション構造

```
users/{lineUserId}
  ageGroup: "preschool" | "elementary" | "highschool" | "adult" | null
  fishDoctorRank: string            # 初期値 "見習い"。ランク段階は未確定事項(1.5参照)
  createdAt, updatedAt: Timestamp

users/{lineUserId}/collection/{animalId}
  name: string                      # 一覧表示用に非正規化
  firstFoundAt: Timestamp
  rarity: string                    # 初回発見時に抽選された結果を保持
  knowledgeUnlocked: {              # requirements.md「知識ページの項目ロック解除」に対応
    habitat: boolean, food: boolean, waterTemp: boolean, ...
  }
  completed: boolean                # knowledgeUnlockedが全てtrueになったらtrue
  askedQuizCategories: string[]     # 2.3節で後述。同じカテゴリの再出題を避けるための履歴

users/{lineUserId}/pendingQuiz/{animalId}
  category: QuizCategory              # 実際に出題するカテゴリ
  selectionReason: string
  consideredCategories: [{            # 13カテゴリ分、それぞれ完成形の3択クイズ(3.6節・実装済み)
    category, groundedInOfficialData, question, choices: string[3], correctIndex, speakerPersona?
  }]
  askedAt: Timestamp
```

出題する実際の`question`/`choices`/`correctIndex`は`consideredCategories`の中から`category`が一致する要素を引いて得る（トップレベルには重複させない。3.6節の実装済みスキーマと同じ形）。

`pendingQuiz` を `collection` の外に分けているのは、「出題中でまだ正誤が確定していない」状態と「確定してコレクションに残る知識」を型的に混ぜたくないため。回答確定後は `pendingQuiz/{animalId}` を削除し、`collection/{animalId}.askedQuizCategories` に追記する。

> **[Fableレビュー]追記**: `handleAnswerQuiz`（`pendingQuiz`読み取り→正誤判定→`pendingQuiz`削除＋`askedQuizCategories`更新）は複数回のFirestore操作になる。LINE Webhookは再送されうるため、非トランザクションのままだと再送時に`askedQuizCategories`が重複追記される等の二重更新が起きる。実装時は`runTransaction`かバッチ書き込みにすること。また、LIFF側が`collection`を読む前提（リアルタイム同期要件）なのに、この設計にはFirestoreセキュリティルール（誰がどのドキュメントを読み書きできるか）への言及がない。#785（LINE Login+Firestore基盤）側で先に決めておくこと（#784着手前の依存として明示）。なお、LINE Webhook再送時のイベント冪等性（同一イベントの二重処理）自体は今回のdesign.mdのスコープ外とし、ハッカソン規模では許容する前提で明示的に見送る。

### 1.4 「進行中のクイズ状態」をFirestoreに置く判断

Firestoreへの書き込みは往復数十〜数百msのレイテンシが乗る。LINEのreply tokenは応答猶予が長く（実用上は数秒〜)、クイズ選択→1回のFirestore書き込みというホットループでない単発I/Oであれば許容範囲。一方でメモリ内Mapは前述の通り正しさそのものが壊れているため、レイテンシとのトレードオフで選ぶような話ではなく、**Firestore一択**と判断する。あわせて、Firestoreは元々 `collection`（コレクション帳）用に導入予定だったサービスなので、二度手間にならない。

### 1.5 未確定事項（このdesign.mdでは決めきらない）

- `fishDoctorRank` の段階・昇格ロジック（種類数・レアリティ・`completed`件数の重み付けなど）
- `rarity` の抽選テーブル・段階数（**#783〈ガチャ演出〉着手前には必須**。このdesign.mdでは決めないが、後回しにしてよいのはそれまでの間だけ）
- `ageGroup` の年齢境界値、入力フォームのUI配置（LIFF/チャット）

---

## 2. 魚識別マッチングの精度改善方針

### 2.1 現状の問題

`identifyFish.ts` は、Geminiが読み取った `japaneseName/scientificName/englishName` を正規化した上で、`===` 完全一致または `includes()` による部分一致で `KaiyukanAnimal[]` から**最初に見つかった1件**を採用している（`findMatchingAnimal` → `Array.find`）。243種の中には和名・学名が類似する種が普通に存在しうるため、以下のリスクがある。

- 部分一致（`includes`）が短い文字列同士で誤検出しやすい（例: 共通する属名・「〜エイ」のような一般名の一部が別種と衝突する）
- 曖昧な一致でも常に1件だけを機械的に選んでしまい、ユーザーに選択の余地を与えない
- confidenceの概念がないため、精度の低いマッチをそのまま候補として提示してしまう

### 2.2 改善方針

1. **Gemini側にconfidenceを出させる**: `RESPONSE_SCHEMA` の `species[]` 各要素に `confidence: "high" | "medium" | "low"` を追加し、案内板の文字がどれだけ明瞭に読み取れたかをGemini自身に申告させる。
2. **`findMatchingAnimal`（単数）→`findMatchingAnimals`（複数）へ変更**: 1つの抽出結果に対して複数のKaiyukanAnimalが一致した場合、最初の1件に絞らず全て候補として残す。`identifyFishFromImage` のループ側で、既存の「複数候補提示」Flex Message経路にそのまま合流させる（UIの変更は不要。1種の写真から複数候補が出ても、1枚のパネルに複数種写っていて複数候補が出ても、ユーザー視点では同じ「選んでね」体験になる）。
3. **一致の強さを区別する**: `matchType: "exact" | "partial"` を候補ごとに保持できるようにする。完全一致が1件もない状態で `includes()` の部分一致だけを採用するのは、正規化後の文字列長が短い（目安: 3文字未満）場合は誤検出リスクが高いため見送り、`confidence` が `"low"` かつ部分一致のみの候補は候補リストの末尾に回す（=優先順位を下げる。除外はしない）。
4. **将来の拡張**（本design.mdでは実装まで踏み込まない）: `family` が同じ種同士は名前が類似しやすいので、confidenceが低い場合に「同じ科の候補」をまとめて提示するUI改善の余地がある。
5. **候補数の上限**: `confidence`が低い部分一致まで全て候補に残す設計上、名前が類似する種が多い科（ハゼ類など）ではカルーセルが長くなりすぎうる。優先順位（完全一致→confidence高→confidence低）でソートした上で上位5件にキャップする。

---

## 3. クイズのエージェント化設計

Fableヒアリングで指摘された最大の弱点は「現状のMVPは識別→選択→クイズ→正誤判定という完全に決定論的な一本道で、LLMがフロー制御に関与する場面が一切ない」こと。この節はその解消が主目的であり、ユーザーからの以下の要求に対応する。

> クイズを出すときにエージェントを使ってほしい。それぞれの魚で、いくつかクイズ/豆知識を考えて、一つ選んだ上で、出題をしてほしい。

対象カテゴリ（13種、固定）: 生息地（場所）／水域／水温／深度／料理（日本の郷土料理）／類似した仲間／同じ水槽にいる魚／特徴／豆知識／進化の歴史／食物連鎖（食べられる側、食べる側）／ダジャレ（ジンベエ名誉教授が話す）／海外の小ネタ

### 3.1 ADK採用（2026-09-18 ユーザー指示により、以下の当初判断を撤回・実装済み）

~~当初は「フルADK構成は時間が厳しければ後回しでもよい」というFableのコメントを踏まえ、単一のGemini呼び出し＋構造化出力でADK非導入とする判断だった。~~ ユーザーからの明示的な要望により、**`@google/adk`（TypeScript版、v2.1.0）を採用し、ローカル検証スクリプト `scripts/try-quiz-agent.ts` で実装・動作確認済み**。

- `Agent`（`LlmAgent`のエイリアス）+ `InMemoryRunner`（ローカル開発・プロトタイピング用の公式ランナー）で構成
- `findRelatedSpecies` という `FunctionTool` を1つ定義し、「類似した仲間」「同じ水槽にいる魚」カテゴリの回答時にエージェントが**自律的にツールを呼び出して**kaiyukanDataから実在種を検索する（3.3節のグラウンディング方針をコード側の固定ロジックではなくエージェント自身の判断に委ねる形に変更）
- `outputSchema`（zod）で13カテゴリ分の候補クイズと選定結果を構造化出力させる（3.2・3.6節参照）
- `@google-cloud/storage`との依存衝突（ADKのpeerOptional要求が`^7.x`、本プロジェクトは`^8.2.0`）は`--legacy-peer-deps`で回避済み。ADKのGCS関連機能（`@google/adk/artifacts/gcs`）は使用しないため実害なし
- モデルは`gemini-2.5-flash`をデフォルトに使用（`QUIZ_AGENT_MODEL`環境変数で上書き可）

### 3.2 処理フロー（実装済み。1〜2回のモデル呼び出し）

`scripts/try-quiz-agent.ts`で実装済みのフロー:

1. `animal`（KaiyukanAnimal）の情報をプロンプトに渡し、13カテゴリそれぞれについて**完成形の3択クイズ（`question`, `choices[3]`, `correctIndex`）を1問ずつ**作らせる（3.3節のうち「類似した仲間」「同じ水槽にいる魚」の2カテゴリでは、エージェントが`findRelatedSpecies`ツールを自律的に呼び出してから作成する＝ここで1往復増える）
2. 情報が薄いカテゴリでも「無理のない範囲で必ず1問は作成する」よう指示（空洞化させない）
3. 13問すべてを作り終えたうえで、その中から最も面白い1問を選ばせ、選定理由（`selectionReason`）を出力させる
4. `consideredCategories`（13問全部）→`category`（選んだカテゴリ）→`selectionReason`の順でoutputSchemaを宣言する（Fableレビュー、3.6節末尾の追記を参照。**ただし実測では、この宣言順が実際のJSON出力順を保証しないことが判明している。4.1節参照**）

> **設計変更点（2026-09-18、ユーザー指示）**: 当初案（3.2旧版）は「13カテゴリの一言トリビア（`summary`）を検討→1つ選んで初めてクイズ化」という2段階だった。ユーザーの要望により、**`consideredCategories`の各要素が最初から完成形の3択クイズを持つ**形に変更済み（3.6節参照）。これにより「本当に13問分の吟味をしたか」がレスポンスから直接検証できるようになった一方、出力トークン量はさらに増えている（4節のレイテンシ懸念を参照）。

### 3.3 カテゴリ別のデータグラウンディング方針

| カテゴリ | 主なデータ源 |
|---|---|
| 生息地（場所）/ 水域 | `description`（分布の記述）、`mainExhibition`のエリア名から推測 |
| 水温 / 深度 | 案内板から抽出できていればその値（1章の「案内板情報」）、なければ一般知識で補う（requirements.md「対話学習」の既存方針と整合） |
| 料理（郷土料理）/ 進化の歴史 / 食物連鎖 / 海外の小ネタ | 基本的に一般知識。`description`に該当記述があれば優先的に使う |
| 類似した仲間 | `family` が同じ他種をkaiyukanDataから検索し、名前リストをプロンプトに渡す |
| 同じ水槽にいる魚 | `mainExhibition`（+`subExhibition`）が同じ他種をkaiyukanDataから検索し、名前リストをプロンプトに渡す |
| 特徴 / 豆知識 | `description` |
| ダジャレ | データ不要。「ジンベエ名誉教授」というキャラクター設定のみをプロンプトに与える |

「類似した仲間」「同じ水槽にいる魚」の2カテゴリは、Geminiの一般知識に委ねず**コード側で実際にkaiyukanDataから引いた実在候補を渡す**ことが精度上重要（海遊館に実在しない種を出題してしまう事故を防ぐ）。

### 3.4 ダジャレカテゴリの出し分け

他12カテゴリは事実ベースの3択クイズだが、ダジャレは性質が異なる（正誤を問う知識クイズではなく、キャラクターが話しかけてくる小ネタ寄りの体験）。型を分けずに済ませるため、次の2フィールドで表現する。

- `speakerPersona?: string` — ダジャレカテゴリの時のみ `"ジンベエ名誉教授"` を設定。他カテゴリでは未設定。
- `question` 文字列自体をキャラクターのセリフ調で生成する（プロンプト側で「ジンベエ名誉教授が話しかけてくる体で」と指示）。

Flex Message側（`flexMessages.ts`、本design.mdでは実装しないが影響範囲として明記）は `speakerPersona` の有無でキャラクター名ラベルの表示を出し分けられるよう、実装時にインターフェースを拡張する。

### 3.5 リピート回避（自律性の継続的な見せ方）

同じユーザーが同じ魚について複数回クイズを受ける状況（将来の「もう一問」機能や、対話学習フローからの再訪）に備え、`users/{userId}/collection/{animalId}.askedQuizCategories` (1.3節) に出題済みカテゴリを蓄積する。プロンプトに「これまで出題済みのカテゴリ: [...]」を渡し、Gemini自身に選定時の判断材料として使わせる（=同じカテゴリを機械的に除外するのではなく、モデルが自律的に「別の切り口を選ぶ」ことを促す設計。除外リストによる決定論的なフィルタにはしない）。

### 3.6 型の拡張（実装済み・design.md初版から変更あり）

```ts
export type QuizCategory =
  | "生息地" | "水域" | "水温" | "深度" | "郷土料理"
  | "類似した仲間" | "同じ水槽にいる魚" | "特徴" | "豆知識"
  | "進化の歴史" | "食物連鎖" | "ダジャレ" | "海外の小ネタ";

// 変更点: summary(一言トリビア)ではなく、各候補が完成形の3択クイズを持つ
export interface QuizCandidate {
  category: QuizCategory;
  groundedInOfficialData: boolean;
  question: string;
  choices: string[]; // 長さ3(旧design.mdは4択だったが3択に変更済み)
  correctIndex: number; // 0-2
  speakerPersona?: string; // ダジャレの時のみ"ジンベエ名誉教授"
}

// 変更点: 選ばれたクイズの実体(question/choices/correctIndex)をトップレベルに重複させない。
// consideredCategoriesの中からcategoryが一致する要素を引いて使う。
export interface QuizQuestion {
  animalId: string; // promptには含めているが、outputSchema自体には含めていない(実装ではserver側で付与する想定)
  consideredCategories: QuizCandidate[];
  category: QuizCategory;
  selectionReason: string;
}
```

`consideredCategories` を型に含めておくことで、選定過程がレスポンスそのものに残り、ログ出力や将来のLIFF側「なぜこの問題が出たか」表示にそのまま使える（Fableが指摘した「選定過程を後で追えるようにしておくと拡張性の説明にもなる」への対応）。

### 4. 実測で判明した論点（Fableへの再レビュー依頼ポイント）

#### 4.1 responseSchemaの宣言順は、実際の出力順を保証しない（重要な実測結果）

3.6節の型を`consideredCategories`が先頭に来るように宣言し、その通りに`outputSchema`を組んで実際にGemini 2.5 Flashを叩いたところ、**最終出力のJSONは`selectionReason`/`question`が`consideredCategories`より先に現れた**（宣言順と実際の生成順が一致しなかった）。

一方で、イベントログを調べたところ`functionCall`パートに`thoughtSignature`（内部思考の署名）が付いており、モデルは可視のJSON構造とは別に**内部の思考フェーズで実際に多段階の推論をしている**ことが確認できた。つまり「見せかけの自律性」ではなく本物の熟考は起きていそうだが、その思考過程は現状ログに可視化されていない（`thinkingConfig`で thought summary を出す設定を試していない）。

**Fableに再確認したい点**: (a) 宣言順が効かない以上、3.6節末尾で推奨した「フィールド宣言順で推論順を強制する」という対策は無効だったと考えてよいか。(b) `thoughtSignature`の存在だけで「見せかけの自律性ではない」と判断してよいか、それとも thought summary を可視化してログ・デモに残すべきか。(c) 代替策として「13カテゴリ全部に完成形クイズを作らせる」（3.2節の設計変更）は、見せかけの自律性への対策として十分か。

#### 4.2 Flex Message / Quick Reply UI設計（新規・未レビュー）

`flexMessages.ts`の`buildQuizFlexMessage`を実装済み。当初の「選択肢をFlexボタンで表示」から変更し、以下の構成にした。

- ヘッダー: 事実カテゴリは青地+category名、ダジャレ（`speakerPersona`あり）はオレンジ地+「ジンベエ名誉教授」
- 本文: 質問文＋各選択肢を「色付きバッジ(A=赤/B=ティール/C=黄)＋テキスト」の行として`separator`(hr)区切りで縦に並べる
- 回答: Flexボタンではなく`quickReply`（画面下部のチップ）でA/B/Cを受け取る。理由: Flexボタンのlabelは20文字制限があり、長いダジャレの選択肢が末尾で切れてしまうため、全文は本文側に表示し、クイックリプライのラベルは"A"/"B"/"C"の1文字のみにして制限に掛からないようにした

サンプルJSONは `backend/samples/flex-quiz-factual.json` / `flex-quiz-dajare.json` / `flex-candidates.json` に保存済み。

---

## まとめ: このdesign.mdが解消するFable指摘・未レビュー箇所

| Fableの指摘・論点 | 対応節 | レビュー状況 |
|---|---|---|
| userId未使用・インメモリ状態が壊れる | 1章 | レビュー済み（一部実装時の詰めあり、1.3節追記参照） |
| 識別マッチングの精度・confidence欠如 | 2章 | レビュー済み |
| 自律性がゼロの決定論的パイプライン | 3章 | レビュー済み（ただし前提がADK採用・13問完成形生成に変わったため再確認が必要） |
| responseSchema宣言順が効かなかった実測結果 | 4.1節 | **未レビュー（今回依頼）** |
| Flex Message / Quick Reply UI設計 | 4.2節 | **未レビュー（今回依頼）** |
