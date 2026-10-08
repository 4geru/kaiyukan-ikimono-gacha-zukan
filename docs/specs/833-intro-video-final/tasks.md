# 紹介動画の最終版 — Tasks

Issue: #833 ／ design.md 承認済み（2026-10-08）。実装はメインセッション。

## 1. 出典をそろえる（design 4章）
- [x] 駅: 21:07 の実機スクショ（306650.jpg）と同じ runId のログを `logs.json` に時刻つきで保存
- [x] インジェクション試験を再実行し、ログを `measurements/injection-<日時>.log` に保存 → `injection.json` を更新（Sonnet 可）
- [x] `measure-ekispert-response-size.ts` を再実行し、`measurements/ekispert-size-<日時>.json` に保存（770駅・84,527・310 を確認）
- [x] Cloud Logging の `quiz_delivered`（live 6件）から中央値を出し `stats.json` に `liveCombined` を追記（35.6秒を確認）
- [x] `quiz-pool/*.jsonl` の approved 件数を数える（790 を確認）
- [x] 値が変わったものは design.md の台本を合わせる（o-3: 35/39 → 修正・デプロイ → 39/39）

## 2. 台本と音声
- [x] `config/script-final.json`（S01〜S14、speak 付き）
- [x] 流用音声のコピー or 生成 → `public/voice-final/`・`src/timeline-final.json`
- [x] 尺が 178 秒以下（172.3秒）か確認（超えたら design 6章の順に削る）

## 3. 部品と場面（`src/final/`）
- [x] 実機スクショを `public/img/final/` にコピー（306615_0, 306650, 306658 ほか）
- [x] `PanelIcon` / `FamilyWalk`（Figure 流用）
- [x] `Flip` / `RecordCard`
- [x] S01〜S06（親子・タイトル・撮る・なぜ・図鑑〈gacha 0〜3.8秒のみ〉・探検）
- [x] S07〜S11（クイズ・作り置き・ヒント＋2択・難易度・駅 MCP）
- [x] S12〜S14（見張り・しくみ・エンディング）
- [x] `IntroVideoFinal.tsx` と `Root.tsx` への登録、Makefile に `voice-final` / `render-final`
- [x] typecheck

## 4. 書き出しと検証（design 5章）
- [x] 静止画（14場面×2）を確認
- [x] `--concurrency=1` で `out/intro-video-final.mp4` を書き出し、尺 < 180・1080p を確認
- [x] 禁止表記（レア・イメージ・これから）と gacha 区間のバッジをフレームで確認
- [ ] 音ズレ4点と流用音声の末尾雑音を確認
- [x] 数値を出典ファイルと1行ずつ突き合わせ
