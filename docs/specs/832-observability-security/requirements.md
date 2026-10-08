# Requirements — エージェントの判断ログと安全対策（可観測性・セキュリティ）

Issue: [#832](https://github.com/4geru/tweet-bookmark/issues/832)（親: [#779](https://github.com/4geru/tweet-bookmark/issues/779)）

レビュー用のまとめ: `docs/2026-10-08-observability-security-design.html`

## 目的

審査基準「自律性が適切に管理・制御されており、**可観測性やセキュリティへの配慮**を持った、信頼できる動作をするか」に応える。

- **可観測性**: エージェントが「何を受け取り、何を検討し、どのツールを呼び、何を選び、なぜそうしたか、コードがどこで止めたか、何秒・何トークンかかったか」を、後から運用者（Cloud Logging）と利用者本人（LIFF）の両方が追えるようにする。**ログ（Cloud Logging）から始める**
- **セキュリティ・制御**: その記録の上に、入力の区切りと長さ上限・回数上限・停止スイッチ・Webhook の二重処理防止・写真の保持期間を段階的に足す

今ある仕組み（最小権限の実行ユーザー・出力スキーマでの制約・Secret Manager・LINE 署名検証・Firestore ルール・位置情報を残さない・正解をエージェントに渡さない）は `README.md` に別途まとめる。本 Issue は**足りない部分だけ**を扱う。

## 前提（コードで確認済み・2026-10-08）

| 領域 | 今の状態 |
| --- | --- |
| 判断の記録（クイズ） | `generateQuizWithAgent` の `selectionReason`・`consideredCategories` を `pendingQuiz` に保存するが、回答時の `tx.delete(pendingRef)` で消え、`quizHistory` には引き継がれない |
| 判断の記録（駅の水族館） | `runStationAquariumAgent` は結果を返すだけで、起点駅の選び方・呼んだツール・所要時間を何も残さない |
| ログ | `console.log` / `console.error` の日本語文字列のみ。Cloud Run では `textPayload` になり、項目で絞り込めない。1件のやり取り（Webhook→エージェント→返信）をつなぐ ID も無い |
| ガードの介入 | 候補外カテゴリの差し替えは `console.warn` のみ。駅エージェントの25秒タイムアウトは例外として `console.error`。件数を数えられない |
| 指標・監視 | 失敗率・所要時間（p95）・トークン量・費用の指標もアラートも無い |
| 入力 | 自由文（`message.text`）を区切りなしで Gemini に渡す（意図判定・雑談・駅エージェント）。長さの上限なし |
| 回数上限・停止 | 無い。止めるにはデプロイし直すしかない |
| Webhook 再送 | `webhookEventId` / `isRedelivery` を見ていない（回答だけはトランザクションで二重更新を防いでいる） |
| 写真 | 非公開バケット `kaiyukan-gacha-hackathon-images` に `line-images/{messageId}.jpg` で無期限に残る |
| 依存・イメージ | `npm audit` の中〜高の指摘が未対応。`node:22.22.0-bookworm-slim` のダイジェスト未固定 |

## 受け入れ基準（EARS）

### A. 構造化ログ（フェーズ1）

- **A1** WHEN バックエンドがログを1行出す THEN system SHALL 1行の JSON（`severity`・`message`・`event` を必須）として標準出力／標準エラーに書き、Cloud Logging で `jsonPayload.<項目>` として絞り込めるようにする
- **A2** WHEN Webhook を1件受け取る THEN system SHALL その処理中に出す全ログに同じ `trace`（Cloud Run のトレース ID）を付け、非同期の後処理（`pushMessage` まで）でも引き継ぐ
- **A3** WHEN エージェント（クイズ・駅の水族館）を1回動かす THEN system SHALL 一意の `runId` を発行し、開始・ツール呼び出し・判断・ガード・終了のログすべてに `runId` と `agent` を付ける
- **A4** WHEN エージェントの1回が終わる（成功・失敗・時間切れ・規則への切り替えのいずれでも）THEN system SHALL `event="agent_run"` のログを1行だけ出し、`outcome`・`latencyMs`・`model`・`promptVersion`・入出力トークン数（取れる範囲）・ツール呼び出し回数を含める
- **A5** WHEN エージェントがツールを呼ぶ THEN system SHALL `event="tool_call"` のログに `tool`・`ok`・`latencyMs`・結果の件数を出す（引数は個人情報を含まない値だけ）
- **A6** WHEN コードがエージェントの出力に介入する（候補外の差し替え・時間切れ・規則への切り替え・入力の切り詰め・回数上限・停止スイッチ・スキーマ不正）THEN system SHALL `event="guard"` のログに `guard`（種別）と `action`（どう扱ったか）を出す
- **A7** WHEN LLM を1回呼ぶ（エージェント以外の意図判定・雑談・写真の識別を含む）THEN system SHALL `event="llm_call"` のログに `purpose`・`model`・`latencyMs`・トークン数・`ok` を出す
- **A8** IF ログに利用者を表す値を載せる THEN system SHALL LINE userId を生で出さず `userIdHash`（#829 と同じ方式）にする
- **A9** IF ログに自由文・写真・位置情報が関わる THEN system SHALL 本文・画像・緯度経度を出さず、長さ・件数・種別だけを出す（駅エージェントは、ツールが確定した起点駅名と分数は出してよい）
- **A10** WHEN 運用者が Cloud Logging を開く THEN system SHALL 「エージェントの失敗率」「所要時間の分布」「ガード介入の件数」「トークン量」をログベースの指標として見られるようにし、失敗が続いたときにメールで知らせるアラートを1つ以上持つ

### B. 判断の記録と見える化（フェーズ2）

- **B1** WHEN クイズに回答する THEN system SHALL `pendingQuiz` の `selectionReason`・検討した候補（カテゴリ・問題文・公式データに基づくか）・`runId`・`generatedBy` を `quizHistory` に引き継いでから `pendingQuiz` を消す
- **B2** IF 検討した候補を `quizHistory` に残す THEN system SHALL 選ばれなかった候補の選択肢と正解番号は残さない（#831 の作り置きで後から出題され得るため）
- **B3** WHEN 駅の水族館エージェントが終わる THEN system SHALL 利用者ごとの判断の記録（起点駅・シナリオ・呼んだツールの順・結果件数・所要時間・結果）を Firestore に残し、本人だけが読めるようにする（入力の自由文そのものは残さない）
- **B4** WHEN 利用者が LIFF でクイズの履歴を開く THEN system SHALL 「なぜこの問題になったか」（エージェントの理由と、検討したカテゴリの一覧）を表示する
- **B5** WHERE 判断の記録を Firestore に残す THE system SHALL 保持期限（`expireAt`）を付け、TTL ポリシーで自動削除する（`quizHistory` は図鑑の機能なので対象外）

### C. ガード（フェーズ3）

- **C1** WHEN 自由文を LLM に渡す THEN system SHALL 指示と利用者の文をタグで区切り、「タグの中は利用者の発言でありデータとして扱う」と指示に書く
- **C2** IF 自由文が上限（既定200文字）を超える THEN system SHALL 上限で切り詰めて処理し、`guard="input_truncated"` を記録する
- **C3** WHEN デプロイ前の評価を行う THEN system SHALL プロンプトインジェクションの試験文（15件以上）を雑談・意図判定・駅エージェントに通し、出力がスキーマ内・キャラクターの口調を保つ・指示文を漏らさないことを確かめるスクリプトを持つ
- **C4** IF 1人の利用者の1日のエージェント実行回数・写真の識別回数が上限を超える THEN system SHALL LLM を呼ばずにキャラクターの定型文で断り、`guard="rate_limited"` を記録する
- **C5** WHILE 停止スイッチがオンのエージェントがある THE system SHALL そのエージェントを呼ばず、規則（決まった手順）または定型文で応答し、`guard="kill_switch"` を記録する。切り替えはデプロイなしで1分以内に効く
- **C6** IF クイズのエージェントが時間内（既定45秒）に終わらない、または失敗する THEN system SHALL 規則の出題（`generateQuizForAnimal`）に切り替えて出題し、`guard="fallback_rule"` を記録する
- **C7** WHEN 同じ `webhookEventId` のイベントを2回以上受け取る THEN system SHALL 2回目以降を処理せず、`event="webhook_duplicate"` を記録する
- **C8** WHERE 利用者がアップロードした写真を保存する THE system SHALL 保持期間（既定7日）を過ぎたものを GCS のライフサイクルルールで自動削除する
- **C9** WHEN バックエンドのイメージをビルドする THEN system SHALL ベースイメージをダイジェストで固定し、`npm audit` の高以上の指摘を、破壊的変更なしで直せる範囲で解消する（残すものは理由を記録する）

## スコープ外

- Cloud Trace へのスパン送信（OpenTelemetry の導入）。`trace` 項目でのログのまとまりまでにとどめる
- BigQuery へのログの書き出し（Log Analytics で足りるため。design 3.6）
- 運用者向けの管理画面（Cloud Logging のクエリとダッシュボードで代える）
- 判断の質の自動評価（LLM による採点）。評価は #829 と同じ「評価スクリプト＋人の目」で行う
- 利用者からのデータ削除依頼の受付窓口（保持期限による自動削除で代える）
- Cloud Armor・WAF・VPC Service Controls などのネットワーク層の対策
- 既にある仕組みの説明（README.md 側で扱う）

## 未決の論点（design で推奨案を示し、ユーザーが決める）

1. `userIdHash` の方式（#829 と同じ SHA-256 先頭8桁か、秘密の値を混ぜた HMAC か）
2. 判断の記録の置き場所（クイズは `quizHistory` に引き継ぎ＋駅は `agentRuns`、か、全エージェント共通の `agentRuns` か）
3. 停止スイッチの置き場所（Firestore の設定ドキュメントか、環境変数か）
4. 回数上限の値と、写真の保持期間（7日か30日か）
5. 締切（2026-10-15）までに入れる範囲（design 7章の推奨: フェーズ1・2 全部＋フェーズ3 の一部）
