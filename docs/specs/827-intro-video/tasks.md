# Tasks — 最終提出用 紹介動画

- [x] T1 requirements.md
- [x] T2 design.md（構成表）
- [x] T3 video/ の雛形（package.json / tsconfig / remotion.config / Makefile）と npm install
- [x] T4 素材の切り抜き（scripts/prepare-assets.sh → public/）
- [x] T5 原稿 config/script.json と voices.json
- [x] T6 scripts/generate-voice.ts（TTS・無音除去・timeline.json）→ `make voice` 実行
- [x] T7 scripts/generate-bgm.ts（Lyria、失敗時フォールバック）→ 実行
- [x] T8 共通部品（theme / font / anim / PhoneMock / CharacterBadge / Subtitle / Bubbles / CountUp）
- [x] T9 シーン実装 S1〜S9 ＋ GachaBurst 移植（初版。演出の作り込みは T12 で）
- [x] T10 IntroVideo（シーン連結・音声・BGM ダッキング・字幕）と Root
- [x] T11 tsc 通過
- [x] T12 still 書き出しと目視確認・修正
- [x] T13 render（mp4）試行、失敗時は bundle で代替
- [x] T14 新規性パート novelty（nv-1〜4、Novelty.tsx）追加、「今後」パート削除、id-1 短縮、`make voice`（合計 179.0 秒）
- [x] T15 フォントをローカル化（public/fonts/NotoSansJP-VF.ttf、theme.ts）、still 目視、mp4 書き出し（179.1 秒）

## メモ

- `remotion still/render` は Remotion 同梱の chrome-headless-shell が spawn -88 で起動しない。システムの Google Chrome（`--browser-executable`）なら still は出る。Makefile の `CHROME` 変数で指定済み
- 実測尺: 185.9 秒（5576f）。原稿を変えたら `make voice` で再計算
