Issue: https://github.com/4geru/tweet-bookmark/issues/784

# タスク: LIFF Webフロントエンド

承認済み [design.md](./design.md) の実装タスク。上から順に実装し、完了ごとにチェックを付ける。

## 共通モジュール（`frontend/shared/`）

- [x] `shared/config.js`: CDNバージョン・`LIFF_ID`・`FIREBASE_CONFIG`を1箇所に集約（design.md 1節。`LIFF_ID`/`FIREBASE_CONFIG`は#785完了までプレースホルダー、`TODO(#785)`コメント付き）
- [x] `shared/liff-client.js`: `liff.init()` → `liff.isLoggedIn()`/`liff.login()` → `liff.getProfile()`をラップし`getCurrentUser()`を提供。`?debugUserId=`によるローカル開発用の上書きに対応（**本番3画面のデプロイ物には含めない**。design.md 4節のFableレビュー対応）
- [x] `shared/firestore-client.js`: Firebase初期化＋`getUserDoc(userId)` / `getCollectionEntry(userId, animalId)` / `watchCollection(userId, onChange)`を実装（design.md 5節）
- [x] `shared/animals-lookup.js`: `gacha-demo/animals-manifest.js`を動的`<script>`読み込みし、`animalId → {name, scientificName, file}`を解決。未登録の場合はプレースホルダー画像＋フォールバック名を返す（design.md 3節）
- [x] `shared/rank-badge.js`: `<rank-badge>` Web Component。`getUserDoc()`の`fishDoctorRank`を表示（未設定時は「見習い」）。控えめな小型ピル表示とし、画面上部を占有しない（design.md 6.4節）

## ガチャ演出画面（`gacha.html`）

- [x] `gacha-demo-03.html`を`gacha.html`としてコピーし、`shared/`の各モジュールを読み込むよう配線する
- [x] `?animalId=`必須化: 未指定・該当なしの場合はエラー画面を表示（requirements.md「起動・入力」）
- [x] レアリティ表示をFirestore駆動に変更: `getCollectionEntry()`の`rarity`を使用し、画面下部のレア度選択ボタンは削除（`?debug=1`時のみ表示に変更）。`rarity`が3段階のいずれでもない場合はノーマル相当にフォールバック
- [x] 画像表示を`shared/animals-lookup.js`経由に差し替え
- [x] 「既視聴」判定を`localStorage`ベースで実装（キー`seen:{userId}:{animalId}`）。design.md 6.1.1節のロジック通り、演出の有無に関わらずFirestoreのカード内容は必ず表示する
- [x] `flash-pop`/`flash-pop-super`のキーフレームを調整し、最大輝度到達を150ms以上にする（`flash-pop`: 12%→30%、`flash-pop-super`: 10%→22%。design.md 6.1節）
- [x] `<rank-badge>`を右上に埋め込む
- [x] 演出終了後に「コレクション帳へ」ボタンを追加し`collection.html`へ遷移

## コレクション帳（`collection.html`）

- [x] 新規作成。`watchCollection(userId, onChange)`でリアルタイム購読し、カード一覧をCSS Gridで表示
- [x] 各カードに`rarity`に応じた縁取り色を適用（ノーマル灰／レア青／SSレア金、`gacha.html`と同配色）
- [x] カードタップで`card.html?animalId=xxx`へ遷移
- [x] `<rank-badge>`を埋め込む

## カード知識ページ（`card.html`）

- [x] 新規作成。`getCollectionEntry()`の`knowledgeUnlocked`を元に項目リストを表示（ロック済みはマスク表示＋鍵アイコン）。`knowledgeUnlocked`が空の場合（バックエンドの対話学習フロー未実装期間）は案内文を表示
- [x] `completed: true`の場合に「コンプリート」バッジを表示
- [x] `<rank-badge>`を埋め込む

## 演出の全画面化・SE・自動再生（requirements.md 6節、2026-09-19追加）

- [x] `.stage`を`position: fixed; inset: 0;`にして画面全体を演出領域にする。水面・光線・バースト・パーティクルの範囲を画面サイズ基準（vw/vh/vmax）に拡大
- [x] 結果表示・ボタン類を画面下部固定の`.foreground`パネルにまとめ、演出の邪魔にならないようにする
- [x] Web Audio APIでSE（水しぶきノイズ・チャイム音）を実装。ミュートボタン（🔇/🔊）を追加し、状態を`localStorage`に保存。**デフォルトはSE ON**（2026-09-19ユーザー指示で確定。requirements.md決定事項6を参照）
- [x] ガチャ演出画面を開いたら（`?debug=1`以外は）ユーザー操作を待たずに自動再生する。`?debug=1`時はレア度選択のため引き続き手動開始ボタンを使う

## デプロイ

- [x] `frontend/Makefile`に`deploy-liff`ターゲットを追加（`.PHONY`宣言への追加も含む。design.md 7節）
- [x] `deploy-liff`は`CONFIRM_785_DONE=yes`を明示しない限り`$(error ...)`で停止するガードを実装し、「#785完了まで実行しない」運用ルールをMakefileコメントとして明記（design.md 4.5節。動作確認済み: 未指定時はエラー停止、指定時は正しいコマンドが生成されることを`make -n`で確認）

## Firebase Web App登録（2026-09-19、ローカル検証のブロッカー解消）

- [x] `gcloud alpha firebase apps create --platform=web`で`kaiyukan-gacha-hackathon`プロジェクトにFirebase Web Appを登録し、実際の`FIREBASE_CONFIG`（apiKey等）を`shared/config.js`に反映。Firebase Web APIキーはクライアント埋め込み前提の公開識別子であり秘匿情報ではないため、リポジトリに含めてよい
- [x] Firestoreセキュリティルールは#785完了まで未整備（＝本番は全拒否）のため、**本番Firestoreへの接続は行わず**、`shared/firestore-mock.js`によるローカル専用モックデータ層を追加。`localhost`/`127.0.0.1`で開いた場合のみモックを使う（ユーザー確認済み: 「検証はローカルのみで完結させたい」）。当初検討したFirestoreエミュレータ案はこの環境にJavaが無く断念し、モック方式に切り替えた

## 動作確認

- [x] ローカルで`python3 -m http.server`を立て、3画面＋`shared/`配下すべてが200で配信されることを確認
- [x] `shared/firestore-mock.js`のモックデータ（`?debugUserId=test-user`、`animalId=134/48/250`）を使い、3画面（ガチャ演出・コレクション帳・カード知識ページ）が実データで表示されることをローカルで確認
- [ ] `gacha.html`をスマホ実機（またはブラウザのモバイルエミュレーション）で開き、全画面演出のはみ出し・スクロールがないこと、SEが（ユーザー操作後に）鳴ることを確認する
- [ ] 本番Firestore・LIFFへの実接続は#785完了後に別途確認する（`shared/config.js`の`LIFF_ID`は引き続きプレースホルダー）
