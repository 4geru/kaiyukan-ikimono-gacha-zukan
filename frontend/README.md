# frontend

LINE の中で開く図鑑ページ（LIFF）、ガチャの演出ページ、紹介ページです。ビルドの仕組みは使わず、静的な HTML と `<script type="module">` で書いています。Firebase Hosting で配信します。

| ファイル | 役割 |
| --- | --- |
| `index.html` | 紹介ページ。LINE の中から開かれたときは、そのまま図鑑へ進む |
| `zukan.html` | 図鑑の一覧（243種のうち何種見つけたか、展示エリアでの絞り込み） |
| `card.html` | 生きもの1種のカード（解説、クイズの履歴） |
| `collection.html` | 集めたカードの一覧 |
| `gacha.html` | 図鑑に登録したときのガチャ演出 |
| `gacha-demo*.html` | ガチャ演出の試作 |
| `shared/liff-client.js` | LIFF の初期化とユーザーの識別。`?demo=1` でデモ表示 |
| `shared/firestore-client.js` | Firebase へのサインインと、本人の記録の読み取り |
| `shared/firestore-mock.js` | localhost で開いたときに使う見本データ |
| `shared/config.js` | LIFF ID・Firebase の設定（公開してよい値） |
| `lp-assets/` | 紹介ページの画像 |
| `build-manifest.mjs` / `animals-manifest.js` | 生きもののイラストの一覧 |
| `firebase.json` / `Makefile` | Hosting の設定と、デプロイ（`make deploy-liff-dev` / `make deploy-liff`） |

## 確かめ方

- localhost で開くと、本番の Firestore に触らず見本データで表示されます（`?debugUserId=` も localhost だけで有効）
- LINE のアカウントがなくても、本番の `zukan.html?demo=1` で見本ユーザーの図鑑を見られます（見るだけ）
