Issue: https://github.com/4geru/tweet-bookmark/issues/791

# 要件定義: クイズの出題履歴（quizHistory）を保存し、過去5問とカテゴリが被らないように出題する

## 背景・スコープ

現状、出題したクイズの `question` は回答後にどこにも残らず、出題済みの管理は状態が3つに散らばっている。

- `users/{uid}/pendingQuiz/{animalId}`: 出題中の問題（回答すると削除される）
- `users/{uid}/collection/{animalId}.askedQuizCategories`: 出題済みカテゴリ名の配列。13カテゴリを一巡するとリセットする
- `users/{uid}/collection/{animalId}.lastQuizCategory` / `lastQuizCorrect`: 直前の回答の記録（不正解の出し直しの判定に使う）

このため、LIFF図鑑で「過去に出たクイズ」を見せられず、カテゴリ選定のロジック（未出題の絞り込み、リセット、`categoriesWereReset`）も複雑になっている。

出題した問題を `quizHistory` として Firestore に残し、これを唯一の状態にする。カテゴリ選定は「**その生きものの過去5問とカテゴリが被らない**」というシンプルなルールに置き換える。

対象:
- 回答時の履歴の保存（サブコレクションへの追記）
- カテゴリ選定ロジックを `quizHistory` ベースの「過去5問と被らない」に置き換える（既存の状態フィールドの廃止）
- LIFF から自分の履歴を読むための Firestore セキュリティルール

対象外（本specでは扱わない）:
- LIFF図鑑の履歴表示 UI（#784）
- `users/{uid}/collection/{animalId}`（生きものの図鑑登録・レアリティなど）の構造変更・改名
- 同じカテゴリ内での問題文の重複回避（履歴に `question` は残すので、必要になれば後から追加できる）
- Webhook 再送時の冪等性一般（ただし履歴の二重登録は下記のとおり防ぐ）
- 過去に出題済みの問題・カテゴリのバックフィル
- 履歴の削除・保持期間・件数上限（残し続ける）

## 保存するデータ

| 項目 | 内容 |
| --- | --- |
| パス | `users/{userId}/animals/{animalId}/quizHistory/{id}`（`id` は自動ID） |
| `category` | 出題カテゴリ名（`QuizCategory`） |
| `question` | 出題した問題文 |
| `choices` | 選択肢（3つ、出題時の並び順） |
| `correctIndex` | 正解の選択肢の番号（0始まり） |
| `askedAt` | 回答した時刻（Firestore `Timestamp`） |
| `isCorrect` | 正解したか（boolean） |

`choices` / `correctIndex` を保存するのは、LIFF図鑑で回答済みの問題を見返せるようにするため。履歴は**回答後にだけ**書かれるので、正解を含んでいても、出題中の問題の答えは漏れない（出題中の問題は `pendingQuiz` にあり、引き続きクライアントから読めない。#785 の方針）。ユーザーが選んだ選択肢の番号は保存しない（`isCorrect` のみ）。

`animals/{animalId}` はサブコレクションの置き場であり、本specでは親ドキュメント自体は作らない（Firestore はサブコレクションだけでも成立する）。

## 受け入れ基準（EARS形式）

### 履歴の保存

- WHEN ユーザーがクイズに回答する THEN system SHALL 既存の回答処理のトランザクション（`pendingQuiz` の読み取り → 正誤判定 → `pendingQuiz` 削除）に含めて、履歴ドキュメントを1件追加する
- system SHALL 履歴ドキュメントに `category` / `question` / `choices` / `correctIndex` / `askedAt` / `isCorrect` を保存する
- WHEN 不正解で同じカテゴリの問題が出し直される THEN system SHALL 出題ごとに別のドキュメントとして残す（上書きしない）
- system SHALL 履歴ドキュメントを削除しない
- WHEN 同じ回答の Webhook が再送され `pendingQuiz` が既に存在しない THEN system SHALL 履歴を追加しない（二重登録しない）
- IF 回答が最新の出題と一致しない（クイズ本文の Flex に残った古い問題への回答）THEN system SHALL 履歴に追加せず、最新の出題を消費しない。回答の postback に出題の識別子（`pendingQuiz.askedAt` のミリ秒）を載せて照合する
- IF 出題されたが回答されないまま放置される THEN system SHALL 履歴に残さない（履歴は回答時に書く）

### 出題ロジック（カテゴリ選定）

- WHEN ユーザーが「クイズ」を選ぶ THEN system SHALL 対象の生きものの `quizHistory` を `askedAt` の新しい順に最大5件取得し、出題カテゴリを決める
- WHEN 取得した最新1件の `isCorrect` が `false` である THEN system SHALL その `category` で出題し直す（「過去5問と被らない」ルールの例外。正解するまで同じカテゴリ）
- WHEN 最新1件が正解、または履歴が0件である THEN system SHALL 全13カテゴリから、取得した最大5件の `category` を除いた残りを候補とし、その中から1つを選んで出題する
- WHEN 履歴が5件に満たない THEN system SHALL 履歴にある分のカテゴリだけを除く
- system SHALL 候補を常に8カテゴリ以上にする（13カテゴリ − 除外は最大5）。候補が尽きる「リセット」の場面を作らない
- IF ADK エージェントが候補外のカテゴリを選ぶ THEN system SHALL 検討済みの候補内カテゴリから選び直し、候補外のカテゴリを出題しない（候補の絞り込みをプロンプトやスキーマだけに頼らず、エージェントの返り値を関数で強制する）
- IF エージェントの検討結果に候補内のカテゴリが1件もない THEN system SHALL 出題失敗として扱い、既存の失敗時の返信をする
- IF 履歴の取得に失敗する THEN system SHALL 全13カテゴリを候補にして出題を続行する（出し直しの判定はできないため、新しいカテゴリとして扱う）
- system SHALL カテゴリ確定後の生成処理（「類似した仲間」「同じ水槽にいる魚」の実在種名によるグラウンディングなど）を変更しない
- system SHALL カテゴリ選定に `collection/{animalId}` の `askedQuizCategories` / `lastQuizCategory` / `lastQuizCorrect` と `pendingQuiz.categoriesWereReset` を使わず、これらを更新しない（廃止する）

### 既存挙動の維持

- system SHALL 履歴の保存・参照によって、回答後の返信内容（正誤・キャラクターの掛け合い・クイックリプライ）とクイズ本体の表示を変更しない
- system SHALL ADK エージェントが候補カテゴリから1つを自律的に選ぶ仕組みを維持する（変わるのは渡す候補の集合だけ）

### LIFF からの参照（セキュリティルール）

- WHEN LIFF が自分の uid で認証済みで `users/{userId}/animals/{animalId}/quizHistory` を読む THEN system SHALL 読み取りを許可する
- IF 他ユーザーの履歴を読もうとする THEN system SHALL 拒否する
- IF クライアントが履歴に書き込もうとする THEN system SHALL 拒否する（書き込みはサーバー側のみ）
- system SHALL `pendingQuiz` を引き続きクライアントから読めないままにする
- system SHALL ルールで許可するパスを明示し、`users/{userId}/{document=**}` のようなワイルドカードを使わない（#785 の方針）

### 既存データ

- system SHALL 本機能のデプロイ前の出題について、バックフィルも既存フィールドの引き継ぎもしない。デプロイ直後は履歴が空のため、全カテゴリが候補になり、不正解の出し直し状態も引き継がれない（出し直し中だったユーザーは一度だけ新しいカテゴリになりうる）

## 確認方法（検証観点）

- 回答後に `.../animals/{animalId}/quizHistory/{id}` が1件増え、`choices`（3件）と `correctIndex` が入っている
- 不正解 → 同カテゴリで出し直し → 回答、で同カテゴリの履歴が2件になる
- 正解した次の出題は、直近5問のカテゴリのいずれとも異なる
- 6問以上続けて出題しても、常に直近5問のカテゴリと被らない（リセットが起きない）
- エージェントが候補外のカテゴリを選んでも、候補外は出題されない（差し替えた場合は Cloud Run のログに warn が出る）
- 同じ回答の postback を2回送っても履歴が1件のまま
- 履歴の取得を失敗させても出題できる
- LIFF の認証トークンで自分の履歴は読めて、他人の履歴・`pendingQuiz` は読めない（403）
