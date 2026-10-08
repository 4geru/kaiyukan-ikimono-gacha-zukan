Issue: https://github.com/4geru/tweet-bookmark/issues/791

# 設計: クイズの出題履歴（quizHistory）と「過去5問と被らない」出題

承認済みの [requirements.md](./requirements.md) を満たす設計。

## 1. 方針

- 出題の状態を **`quizHistory` 1本に集約**する。カテゴリの出題済み判定も、不正解の出し直し判定も、履歴の直近5件から導く
- カテゴリ選定は純粋関数 `planQuizCategory` に切り出す（Firestore に依存しない。ローカルスクリプトで検証できる）
- 既存の `collection/{animalId}` の `askedQuizCategories` / `lastQuizCategory` / `lastQuizCorrect` と `pendingQuiz.categoriesWereReset` は、読まず・書かない（廃止）。既存ドキュメントに残った値は放置する（削除しない）

## 2. データモデル

```
users/{userId}/
├── collection/{animalId}                 図鑑登録（既存・構造は変更しない）
│     askedQuizCategories / lastQuizCategory / lastQuizCorrect は廃止（新規に書かない）
├── pendingQuiz/{animalId}                出題中の問題（既存。categoriesWereReset だけ廃止）
└── animals/{animalId}/quizHistory/{id}   ★新規: 回答済みの出題履歴（自動ID）
      category:  string      QuizCategory
      question:  string
      choices:   string[]    選択肢（3つ、出題時の並び順）
      correctIndex: number   正解の選択肢の番号（0始まり）
      askedAt:   Timestamp   回答した時刻（並び替えのキー）
      isCorrect: boolean
```

- `choices` / `correctIndex` を保存するのは、LIFF図鑑で回答済みの問題を見返せるようにするため。履歴は回答後にだけ書くので、正解を含んでいても出題中の問題の答えは漏れない（出題中の問題は `pendingQuiz` にあり、クライアントから読めないまま）
- ユーザーが選んだ選択肢の番号は保存しない（`isCorrect` のみ）
- `animals/{animalId}` の親ドキュメントは作らない。Firestore はサブコレクションだけで成立する
- 直近5件の取得は `orderBy("askedAt", "desc").limit(5)`。単一フィールドのインデックスは自動で作られるため、`firestore.indexes.json` の追加は不要

## 3. カテゴリ選定ロジック

`backend/src/quiz.ts` に純粋関数を追加する。

```ts
export const QUIZ_HISTORY_WINDOW = 5;

export interface QuizHistoryEntry {
  category: QuizCategory;
  isCorrect: boolean;
}

export type QuizCategoryPlan =
  | { kind: "retry"; category: QuizCategory }        // 不正解の出し直し
  | { kind: "fresh"; candidates: QuizCategory[] };   // 新しいカテゴリ（8件以上）

// recent は askedAt の新しい順（最大 QUIZ_HISTORY_WINDOW 件）
export function planQuizCategory(recent: QuizHistoryEntry[]): QuizCategoryPlan {
  const latest = recent[0];
  if (latest && !latest.isCorrect) return { kind: "retry", category: latest.category };
  const excluded = new Set(recent.map((r) => r.category));
  return { kind: "fresh", candidates: QUIZ_CATEGORIES.filter((c) => !excluded.has(c)) };
}
```

- 13カテゴリ − 除外最大5 = 候補は常に8件以上。「候補が0件 → リセット」の分岐が存在しなくなる
- 履歴が0件、または取得失敗（`[]` を渡す）なら、全13カテゴリが候補
- `retry` のとき候補の絞り込みはしない（「過去5問と被らない」ルールの例外）
- 既存の `pickRandomCategory` はスクリプトが使っているため残す

## 4. データフロー

### 4.1 出題（`handleStartQuiz`）

```
クイズ postback
  ├─ findAnimalById(animalId)                       ┐ 並列（従来どおり）
  └─ getRecentQuizHistory(userId, animalId)         ┘ quizHistory 直近5件。失敗時は [] を返す
        │
   planQuizCategory(recent)
        ├─ retry  → 従来の出し直し経路: グラウンディング → generateQuizForAnimal(animal, category, ...)
        └─ fresh  → generateQuizWithAgent(animal, candidates)  ※ADKが候補から自律選択
        │
   savePendingQuiz（categoriesWereReset を書かない）→ replyMessage
```

- `getQuizSelectionState`（`collection/{animalId}` の get）は廃止し、`getRecentQuizHistory` に置き換える。Firestore の読み取り回数は従来と同じ1回
- `getRecentQuizHistory` は例外を握って `console.warn` し `[]` を返す（要件: 取得失敗でも出題を止めない）

### 4.2 回答（`handleAnswerQuiz`）

```
回答 postback
  └─ runTransaction
       ① tx.get(pendingRef)                         存在しなければ何もせず undefined（Webhook再送）
       ② tx.delete(pendingRef)
       ③ tx.set(historyRef, { category, question, choices, correctIndex, askedAt: now, isCorrect })   ★追加
       ④ tx.set(colRef, { updatedAt: now }, { merge: true })
```

- `historyRef = quizHistoryCollection(userId, animalId).doc()` はトランザクションの**外**で作る。トランザクションが再試行されても同じ ID になり、二重登録しない
- ① が存在しなければ ③ に到達しないため、Webhook 再送で履歴は増えない（要件の二重登録防止は既存の `pendingQuiz` 削除で満たされる）
- ④ は `updatedAt` の更新だけ残す（従来は回答時にも `updatedAt` が更新されていたため、LIFF で並び替えに使う場合の挙動を変えない）。`lastQuiz*` / `askedQuizCategories` は書かない

### 4.3 図鑑登録（`handleSelectFish`）

初回登録時の `collection/{animalId}` に書いていた `askedQuizCategories: []` を削除する。

## 5. ADK エージェント（`quizAgent.ts`）

```ts
export async function generateQuizWithAgent(
  animal: KaiyukanAnimal,
  candidateCategories: readonly QuizCategory[] = QUIZ_CATEGORIES,
): Promise<AgentQuizResult>
```

- 既出カテゴリの除外・リセット（`asked` / `filtered` / `categoriesWereReset`）を削除し、渡された候補をそのまま `shuffle` してスキーマ・プロンプトに渡す
- `AgentQuizResult` から `categoriesWereReset` を削除する
- 「`responseSchema` の enum を候補に絞る」設計と、提示順バイアス対策のシャッフルは維持する。候補が8〜13件になるだけで、自律選択の仕組みは変わらない
- **エージェントの返り値を関数で強制する（追補）**: このプロジェクトのバックエンドは `GEMINI_API`（Vertex AI ではない）なので、ADK は `outputSchema` を `set_model_response` ツールの引数として渡す。関数呼び出しの enum はモデルへのヒントで、強制も検証もされない（`canUseOutputSchemaWithTools` が false）。そのため、スキーマとプロンプトで候補を絞るだけでは候補外のカテゴリが選ばれうる
  - `quiz.ts` に純粋関数 `pickAllowedCandidate(considered, selectedCategory, allowed)` を追加する。選ばれたカテゴリが候補内ならそのまま、候補外なら検討済みの候補内カテゴリからランダムに選び直し、候補内が1件もなければ `undefined`
  - `generateQuizWithAgent` はこの関数の結果だけを出題に使う。差し替えた場合は `console.warn` を出し、`selectionReason` に差し替えた旨を追記する。`undefined` の場合は例外を投げる（呼び出し側の既存の失敗時の返信になる）

## 6. Firestore セキュリティルール（`backend/firestore.rules`）

`match /users/{userId}` の中に追加する。

```
match /animals/{animalId}/quizHistory/{historyId} {
  allow get, list: if isOwner(userId);
}
```

- 書き込みは許可しない（既存の `/{document=**}` の全拒否が効く。Bot は Admin SDK なのでルールの対象外）
- `pendingQuiz` は引き続き許可しない。ワイルドカードは使わず、パスを明示する（#785 の方針）
- ファイル冒頭のコメント（許可するパスの説明）に `animals/{animalId}/quizHistory` を追記する
- 反映は `make deploy-rules`

## 7. ファイル構成と変更内容

| ファイル | 変更 |
| --- | --- |
| `backend/src/quiz.ts` | `QUIZ_HISTORY_WINDOW` / `QuizHistoryEntry` / `QuizCategoryPlan` / `planQuizCategory` を追加 |
| `backend/src/quizAgent.ts` | `generateQuizWithAgent` の引数を候補カテゴリに変更、リセット処理と `categoriesWereReset` を削除、冒頭コメントを更新 |
| `backend/src/server.ts` | `getRecentQuizHistory` / `quizHistoryCollection` を追加。`handleStartQuiz` を `planQuizCategory` 経由に変更。`savePendingQuiz` から `categoriesWereReset` を削除。`handleAnswerQuiz` のトランザクションに履歴の追加を入れ、`lastQuiz*` / `askedQuizCategories` の書き込みを外す。`handleSelectFish` の `askedQuizCategories: []` を削除。`QuizSelectionState` / `getQuizSelectionState` を削除 |
| `backend/firestore.rules` | §6 のとおり |
| `backend/scripts/try-quiz-agent.ts` | `generateQuizWithAgent` の新しい引数に合わせる |
| `backend/scripts/try-firestore.ts` | サンプルデータから `askedQuizCategories` を削除 |
| `backend/scripts/try-quiz-plan.ts`（新規） | `planQuizCategory` の検証（§8） |
| `CLAUDE.md`（完了後） | クイズのカテゴリ選定ルールと Firestore の記述を新しい仕様に更新 |

## 8. 検証方針

このプロジェクトには自動テストがなく、ローカルスクリプトと実機で確認している。同じ方針にする。

- `scripts/try-quiz-plan.ts`: `planQuizCategory` に次のケースを渡して `assert` する
  - 履歴0件 → `fresh`、候補13件
  - 直近が不正解 → `retry` で直近のカテゴリ
  - 直近が正解で5件 → `fresh`、候補8件、直近5件のカテゴリを含まない
  - 履歴が3件 → 候補10件
  - 6問連続で出題をシミュレートしても、常に直近5問と被らない
- Firestore 実機（実機 LINE）:
  - 回答後に `quizHistory` が1件増える（`choices` 3件と `correctIndex` が入っている）
  - 不正解 → 同カテゴリで出し直し → 同カテゴリの履歴が2件
  - 同じ回答 postback の再送で履歴が増えない
- ルール: #785 の検証と同じ形式で、自分の履歴は読める・他人の履歴と `pendingQuiz` は読めない・書き込みは拒否を確認する

## 9. リリースと互換性

- コードのデプロイ（`make deploy`）とルールのデプロイ（`make deploy-rules`）は独立していて、順序は問わない。LIFF が履歴を読むのは #784 側の実装が入ってから
- 既存ユーザーの `collection/{animalId}` に残る `askedQuizCategories` などの旧フィールドは削除しない。読まれないだけで害はなく、ロールバック時に旧コードがそのまま使える
- デプロイ直後は履歴が空なので、全カテゴリが候補になり、出し直し中だったユーザーは一度だけ新しいカテゴリになりうる（要件に記載済み）

## 10. 設計上の判断メモ

- `askedAt` は「回答した時刻」。`pendingQuiz.askedAt`（出題した時刻）とは別物なので、履歴では要件どおり回答時刻を入れる
- 履歴を回答時に書くため、出題されたが回答されなかった問題は履歴に残らず、その間は次の出題でも除外されない（要件どおり）
- 同カテゴリ内の問題文の重複回避は本設計に含めない（要件の対象外）
