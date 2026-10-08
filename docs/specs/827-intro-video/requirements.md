# Requirements — 最終提出用 紹介動画（約3分）

Issue: [#827](https://github.com/4geru/tweet-bookmark/issues/827)（親: [#821](https://github.com/4geru/tweet-bookmark/issues/821)）

## 目的

Google Cloud Japan AI Hackathon Vol.5 の最終提出用に、作品「海遊館いきものガチャ図鑑」（LINE Bot 名「博士と助教授のひみつ研究室」、チーム「水族館。」）を約3分で紹介する動画を作る。
審査基準「新規性・有効性」「自律性・エージェントらしさ」「実装品質・拡張性」のそれぞれに応えるパートを含める。

## 前提・未確認事項

- **提出要件（尺の上限、形式、提出先、YouTube 限定公開か等）は未確認。** 本 spec は「約3分・16:9 Full HD」を仮置きしている。要件が判明したらこのファイルを直す
- 動画中の機能説明は `project-google-cloud-japan-ai-hackathon-vol5/CLAUDE.md` とコードで確認できたものだけにする。未実装（レアリティ抽選、知識ページ解除、ランク、年齢層対応、思い出動画、来館ログ）は「できている」ように見せない
- 使ってよい数値: 海遊館 243 種、クイズ 13 カテゴリ、駅すぱあと MCP の生レスポンス 84,527 トークン → FunctionTool で 310 トークン（大阪駅 60 分、770 駅 → 3 館）、クイズ候補は過去5問と被らないカテゴリ。その他の数値はコード/データで確認したものに限る

## 受け入れ基準（EARS）

### 尺・形式

- R1. The system SHALL 出力する動画の長さを 3 分（180 秒）以内にする（2026-10-08 ユーザー指示。目安 170〜180 秒）
- R2. The system SHALL 1920x1080 / 30fps / H.264 の mp4 として書き出せる Remotion コンポジションを提供する
- R3. WHEN ナレーション原稿（`video/config/script.json`）が変わった THEN system SHALL 音声を再生成し、各セリフの実測 duration からタイムラインを再計算する（手で秒数を合わせ直さない）

### 音声

- R4. The system SHALL ナレーションとキャラのセリフを Gemini TTS で生成し、セリフ単位の wav にする
- R5. The system SHALL 話者ごとに声を変える（ナレーター／カワウソ助教授／ジンベエ名誉教授）。カワウソは「〜っす」の元気な口調、ジンベエは「〜じゃ」「〜のう」の長老口調にする
- R6. The system SHALL TTS が冒頭・末尾に付ける無音を削ってからタイムラインに使う
- R7. The system SHALL BGM を全編に流し、ナレーション中は声が聞き取れる音量まで下げる（ダッキング）
- R8. IF API キーが必要 THEN system SHALL `backend/.env` の `GEMINI_API_KEY` を dotenv で読み、キーを出力・ファイルに書かない

### 映像

- R9. The system SHALL 全セリフに字幕（話者名つき）を表示する
- R10. The system SHALL 実機スクショ・画面収録を端末モックに収めて見せ、端末のステータスバーと開発用ドメインが写る URL バーは映さない
- R11. The system SHALL 「困りごと → 体験デモ → エージェントの自律性 → アーキテクチャ → 今後」の流れで構成する
- R12. The system SHALL 審査基準3つに対応するパートを持つ（新規性・有効性＝困りごとと体験デモ／自律性＝クイズと駅すぱあとのエージェント／実装品質・拡張性＝トークン削減とアーキテクチャ）
- R13. The system SHALL アーキテクチャ図を「リクエストの旅」の段階単位で描き、クラス名・メソッド名を書かない
- R14. The system SHALL 今後やりたいこと（思い出動画の自動生成、年パス来館ログ）を「今後」と明示したパートに分け、実装済み機能と混同させない
- R15. The system SHALL スライドの誤記「Ekispart MCP」を映さず、表記は「駅すぱあと（Ekispert）MCP」とする
- R16. The system SHALL Gemini 生成画像に日本語を描かせない（日本語は Remotion がベクタで描く）

### 検証

- R17. The system SHALL `tsc --noEmit` を通す
- R18. The system SHALL 各シーンの静止画を `remotion still` で書き出せる
- R19. IF この環境で `remotion render` が Chrome spawn エラーで失敗する THEN system SHALL `remotion bundle` の成功と still の目視確認で代替し、その旨を報告する

### 運用

- R20. The system SHALL `make voice` / `make studio` / `make render` を Makefile に用意する
- R21. The system SHALL aruaru-zukan 側のファイルを変更しない（必要な部品はコピーして改変する）
