# デモユーザーの図鑑 — Requirements

Issue: #837（https://github.com/4geru/tweet-bookmark/issues/837）

LINE アカウントを持たない人（審査員など）が、図鑑ページを見るだけで試せるようにする。ユーザーの承認: 2026-10-10（「デモ専門ユーザーを作って、LP に URL をのせたい」）。

1. WHEN 図鑑ページを `?demo=1` で開く THEN system SHALL LINE ログインを通さず、デモユーザー（uid `demo-zukan`）の図鑑を表示する
2. デモユーザーは SHALL 実在の利用者の LINE userId・表示名を含まない（図鑑・クイズ履歴・レベルだけをコピーする）
3. デモ表示中は SHALL 画面にデモであることを示す
4. デモユーザーで SHALL 書き込みはできず、デモユーザー自身の記録しか読めない（既存の Firestore ルールのまま）
5. 図鑑からカード詳細へ移ってもデモ表示が続く
6. 紹介ページに SHALL 「LINE なしで図鑑を見る」リンクを置く
7. LINE からの通常の利用（LIFF）は SHALL 変わらない
