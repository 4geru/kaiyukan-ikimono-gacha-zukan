# Requirements — 解説記事: 駅すぱあと MCP を使う ADK エージェント

Issue: [#823](https://github.com/4geru/tweet-bookmark/issues/823)（親: [#821](https://github.com/4geru/tweet-bookmark/issues/821)）

## 目的

「〇〇駅から1時間で行ける水族館」に答える ADK エージェント（`backend/src/stationAquariumAgent.ts`）を題材に、**MCP のツールを ADK にそのまま渡さず FunctionTool で包み、LLM に任せる所とコードで固定する所を分ける**設計を Zenn 記事として公開できる状態にする。

## 前提

- 下書き `articles/station-aquarium-adk-ekispert-mcp.md` が既にあり、構成（はじめに → 全体像 → 役割分担 → ADK → MCP → FunctionTool で包む → S2 の中身 → LLM に残す所 → 待ち時間 → ハマりどころ → まとめ）はほぼできている
- 本記事は下書きの**仕上げ**であり、ゼロから書き直さない
- 投稿先は Zenn（`articles/` 配下、`published: false` のまま作業し、公開はユーザーが判断する）
- シリーズ記事（#822 提出記事、#824 クイズエージェント）から相互リンクされる

## 想定読者

- ADK または MCP を触り始めた、TypeScript が読めるエンジニア
- 「MCP をエージェントに繋いだが、引数がぶれる・遅い」で困っている人

## 受け入れ基準（EARS）

### 内容の正しさ

1. WHEN 記事にコード・数値・ツール名・引数を載せる THEN system SHALL `backend/src/stationAquariumAgent.ts` 等の現行コードと一致させる（タイムアウト 25 秒、関西 15 館、最大 3 件、`gcs: "wgs84"` / `type: "train"` の固定など）
2. WHEN 計測値（MCPToolset 版の約 8.9 秒、引数のぶれ）を載せる THEN system SHALL 出典となる検証記録（`docs/research/ekispert-mcp.md` または `scripts/try-ekispert-agent.ts` の実行結果）と一致させ、一致しない場合は記述を修正または削除する
3. IF 記事中のコード抜粋が実装を簡略化している THEN system SHALL 簡略化していることが読者に分かる書き方（`// ...` 省略表記など）にする
4. WHEN ADK・MCP・駅すぱあと MCP の仕様（`MCPToolset`、`runEphemeral`、MCP ツール数、`upperMinutes` の範囲など）に触れる THEN system SHALL 公式ドキュメントで確認できる内容のみ書く

### 構成・読みやすさ

5. WHEN 読者が冒頭を読む THEN system SHALL 「MCP を FunctionTool で包む」という結論と、その理由（引数のぶれ・巨大なレスポンス）が冒頭で分かる
6. WHEN 読者が記事を読み終える THEN system SHALL 「LLM に任せる所／コードで固定する所」の判断基準を自分のエージェントに持ち帰れる
7. IF MCPToolset 版との比較を載せる THEN system SHALL 比較の前後（MCPToolset 版 → FunctionTool 版）が表か図で一目で分かる

### 図

8. WHEN 全体の流れを図示する THEN system SHALL 関数単位のシーケンス図ではなく、段階単位の「リクエストの旅」の図にし、クラス名・メソッド名を図に書かない

### シリーズとの関係

9. WHEN 記事を仕上げる THEN system SHALL 冒頭か末尾にシリーズ（提出記事 #822、クイズエージェント記事 #824）への導線を置く（未公開の記事はリンク先を後で差し替えられる形にする）
10. IF 内容がハッカソン提出記事（#822）と重複する THEN system SHALL 本記事は実装の詳細、提出記事は概要という分担を守る

### 公開前

11. WHEN 執筆が完了する THEN system SHALL `/article-review` で複数の観点からレビューし、客観的な指摘を反映する
12. IF 記事にアクセスキー・トークンなどの秘密情報や、公開していない内部 URL が含まれる THEN system SHALL 削除する

## スコープ外

- `stationAquariumAgent.ts` 自体のリファクタ・機能追加
- 駅すぱあと MCP の再計測（MCP のアクセスキーが現在無効でつながらないため。必要になったら Design で判断する）
- Zenn への公開操作
