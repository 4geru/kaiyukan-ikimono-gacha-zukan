# Tasks — 解説記事: Message.sender でキャラが掛け合う LINE Bot

Issue: [#826](https://github.com/4geru/tweet-bookmark/issues/826) / [design.md](./design.md)

対象ファイル: `articles/line-bot-sender-character-dialogue.md`（`published: false`）

## 準備

- [x] 1. design.md に「決定事項（2026-10-07）」を追記
- [x] 2. tasks.md を作成
- [x] 3. `try-character-chat.ts` を 4 回実行し `samples.md` に保存
  - [x] 既定（引数なし）「ジンベエ教授は何歳ですか？」
  - [x] 生き物の質問
  - [x] 知らないことを聞く質問
  - [x] 雑談

## 執筆

- [x] 4. frontmatter・冒頭 :::message・TL;DR・対象読者・はじめに
- [x] 5. 全体像（旅の図）
- [x] 6. `sender` の基本（公式で確認できた範囲のみ）
- [x] 7. キャラを関数にする
- [x] 8. 掛け合いを Gemini に作らせる（比較表）
- [x] 9. キャラ設定をプロンプトに落とす（対応表）
- [x] 10. 動かしてみる（samples.md の実出力）
- [x] 11. 失敗した時は固定セリフ
- [x] 12. ハマりどころ・限界
- [x] 13. まとめ・シリーズの他の記事（#822・#823・#824）
- [x] 14. `screenshot-guide.md` を作成（4 枚）

## 検証

- [x] 15. コード抜粋・数値を実装と再照合（秘密情報・バケット URL が無いこと）
- [ ] 16. ユーザーがスクショを撮り、TODO コメントを画像に差し替え
- [ ] 17. Zenn プレビューで mermaid 描画確認
- [ ] 18. `/article-review` でレビュー

## 完了後

- 確定事項を `CLAUDE.md` か `docs/` に転記し、`docs/specs/826-character-dialogue-article/` を削除
