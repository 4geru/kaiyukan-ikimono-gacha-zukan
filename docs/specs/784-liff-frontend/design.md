Issue: https://github.com/4geru/tweet-bookmark/issues/784

# 設計: LIFF Webフロントエンド

承認済み [requirements.md](./requirements.md) を満たすための設計。対象は#784本文の4画面（ガチャ演出／コレクション帳／カード知識ページ／魚博士ランク表示）。

---

## 1. ビルド構成: プレーンHTML/JS（バンドラー導入なし）

**決定**: Viteなどのバンドラーは導入せず、`frontend/gacha-demo-*.html`と同じ「単一HTMLファイル + `<script type="module">` + CDN読み込み」の構成を本番の4画面にも適用する。

理由:
- 既存の`frontend/Makefile`（`gcloud storage cp`でGCS公開バケットに直接アップロード）がバンドル成果物を前提としていない。バンドラーを入れると「ビルド→dist生成→アップロード」の工程が増え、ハッカソンの残り時間に対して投資対効果が低い
- LIFF SDKは`https://static.line-scdn.net/liff/edge/2/sdk.js`をscriptタグで読み込むだけで使える（バンドル不要）
- Firebase JS SDK（v10以降）はESM CDN（`https://www.gstatic.com/firebasejs/<version>/firebase-app.js` 等）を`<script type="module">`から直接importできる。npm経由のバンドルは必須ではない（Fableレビュー: 公式にサポートされている「ビルドレス」の使い方であり妥当）
- 既存の3プロトタイプ（`gacha-demo-01/02/03.html`）は素のHTML/CSS/JSで作られており、本番実装もこの資産をそのまま拡張・流用できる

**Fableレビューでの補足**: Firebase/LIFF SDKのCDN URLに含まれるバージョン番号は、`shared/`配下の複数ファイルがそれぞれ別々にimportすると記述がずれるリスクがある。バージョン文字列は1箇所（`shared/cdn-versions.js`のような定数ファイル、または各ファイル冒頭に同一コメントで明記する運用）に集約する。

## 2. ファイル構成

```
frontend/
  gacha.html              # 本番: ガチャ演出画面（gacha-demo-03.htmlを改修）
  collection.html         # 本番: コレクション帳
  card.html                # 本番: カード知識ページ
  shared/
    liff-client.js         # liff.init() + ユーザー識別の共通処理
    firestore-client.js     # Firebase初期化 + Firestore読み取りヘルパー（collection取得・onSnapshot購読）
    rank-badge.js            # 魚博士ランクバッジ（3画面共通のヘッダー部品、Web Componentとして実装）
    animals-lookup.js        # animalId → {name, scientificName, file(画像URL)} 解決（3節参照）
  gacha-demo-01.html       # 比較用プロトタイプ（据え置き、本番からは参照しない）
  gacha-demo-02.html       # 同上
  gacha-demo-03.html       # 同上（gacha.htmlのベースだが、プロトタイプ自体は改修しない）
  animals-manifest.js      # 既存: ローカル確認用マニフェスト（相対パス版）
  build-manifest.mjs       # 既存
  Makefile                  # 既存（4節でデプロイ対象を追加）
```

`shared/`配下はプレーンJSのES Modules。3画面すべてが`<script type="module" src="shared/xxx.js"></script>`で読み込む共通処理を切り出す（コピペではなく共有）。

## 3. 画像URLの解決: 既存の`animals-manifest.js`をそのまま流用

**決定**: Firestoreの`collection`ドキュメントに画像URLを新規フィールドとして持たせる案（バックエンド側の変更が必要）は採用しない。代わりに、既にGCS上に公開済みの`gs://kaiyukan-gacha-hackathon-public-assets/gacha-demo/animals-manifest.js`を`shared/animals-lookup.js`から`<script src>`で読み込み、`animalId`から`{name, scientificName, file}`を解決する。

理由:
- 既に本番相当のデータとして動いている（243種中生成済み分を反映済み、`make manifest`で更新できる）
- #783/#780に新規フィールド追加を依頼せずに#784だけで完結する（依存を増やさない）
- `<script src>`によるJS読み込みは`fetch`と違いCORS制約を受けないため、GCSバケットの追加設定が不要

デメリット: 画像URLの真実の情報源（source of truth）が「海遊館の生きもの一覧」と「Firestoreのcollectionドキュメント」の2箇所に分散する。将来的にレアリティ別イラスト（[779design.md](../779-ikimono-gacha-zukan/design.md)が言及）を導入する際は、この設計を見直す必要がある（本design.mdのスコープ外として明記）。

**Fableレビューでの補足**: `animalId`に対応するエントリが`animals-manifest.js`に無い場合（#783側のイラスト生成が追いついていない、デプロイし忘れ等）のフォールバックが未定義だった。`shared/animals-lookup.js`は該当なしの場合にエラーで止めず、プレースホルダー画像＋生きもの名（Firestoreの`collection.name`は既に非正規化されているのでこちらは必ず取得できる）を表示する。

## 4. 認証・ユーザー識別フロー

```
LIFF起動 (liff.init({ liffId }))
  → liff.isLoggedIn() が false なら liff.login() へリダイレクト
  → liff.getProfile() で userId を取得
  → Firestore users/{userId} 以下を読み取り
```

`shared/liff-client.js`が上記をラップし、`await getCurrentUser()` で `{ userId, displayName }` を返す関数を提供する。

**#785未着手期間のモック**: requirements.md「前提・依存」の通り、LINE Login基盤が未実装の間は`liff.init()`が失敗する。`shared/liff-client.js`は開発用に `?debugUserId=xxx` クエリパラメータでの上書きに対応する。

**Fableレビューで修正**: 当初「`?animalId=`と同じ考え方で、本番ではURLに現れないため実害は小さい」としていたが誤り。`gacha.html`/`collection.html`/`card.html`はGCS公開バケット上の静的HTMLであり、`?animalId=`と違って`?debugUserId=`は**他人のuserIdを騙って任意のFirestoreデータ表示を試せてしまう**、質の異なるリスクである。特に#785のFirestoreセキュリティルールが未整備の期間は、ブラウザから直接Firestore SDKを叩けばどのuserIdのデータも読めてしまいうる状態であり、`?debugUserId=`はその操作の敷居を「devtoolsでSDKを直接叩く」から「URLにクエリを1つ足すだけ」まで下げてしまう。以下の運用ルールで対応する。

- **Firestoreセキュリティルール（#785）が整備されるまで、`make deploy-liff`（本番3画面のデプロイ）は実行しない**。プロトタイプ（`gacha-demo-01/02/03.html`、`deploy-01/02/03`）はFirestoreを読まないため引き続き公開してよい
- `?debugUserId=`は本番3画面のコードからは削除し、ローカルの`python3 -m http.server`等で手元だけ動かす開発時にのみ使う想定とする（デプロイされる成果物には含めない）

## 4.5 依存関係の明示

上記の通り、#784の本番3画面（`gacha.html`/`collection.html`/`card.html`）のデプロイは**#785（Firestoreセキュリティルール整備）が完了するまでブロックされる**。実装自体（HTML/JS作成）は#785を待たずに進められるが、`make deploy-liff`の実行だけは#785完了後に限定する。

## 5. Firestoreデータ読み取り

`shared/firestore-client.js`が提供する関数:

| 関数 | 用途 | 使用画面 |
|---|---|---|
| `getUserDoc(userId)` | `users/{userId}` 取得（`fishDoctorRank`） | 3画面共通（rank-badge.js経由） |
| `getCollectionEntry(userId, animalId)` | `users/{userId}/collection/{animalId}` 取得（`rarity`, `knowledgeUnlocked`, `completed`） | ガチャ演出画面、カード知識ページ |
| `watchCollection(userId, onChange)` | `users/{userId}/collection` 全体を`onSnapshot`で購読 | コレクション帳 |

Firestoreクライアント（Firebase JS SDK, modular）を直接ブラウザから初期化する。**Firestoreセキュリティルール（他人のcollectionを読めないようにする制御）は#785側の前提条件**（requirements.md未確定事項に明記済み）。本design.mdでは「ルールが正しく設定されている前提でクライアントSDKから直接読む」設計までとし、ルールそのものの記述は#785のdesignに委ねる。

## 6. 画面ごとの設計

### 6.1 ガチャ演出画面（`gacha.html`）

`gacha-demo-03.html`をベースに、以下を差分として適用する。

| 項目 | プロトタイプ(`gacha-demo-03.html`) | 本番(`gacha.html`) |
|---|---|---|
| 対象生きもの | `?animalId=`（未指定はランダム） | `?animalId=`必須。未指定/不正時はエラー画面（requirements.md「起動・入力」） |
| レアリティ | 画面下部のボタンで選択（デフォルトSSレア固定） | Firestoreの`rarity`を`getCollectionEntry()`で取得し使用。**UIボタンは削除**。ただし`?debug=1`が付いている時だけ従来のボタンを表示し、開発中の見た目確認に使えるようにする（requirements.md 5節） |
| `rarity`が`"unknown"`等の場合 | 該当なし | ノーマル相当にフォールバック（requirements.md「ガチャ演出画面」） |
| 画像 | `animals-manifest.js`（ローカル相対パス） | `shared/animals-lookup.js`経由で同マニフェストの絶対URL版を使用 |
| 2回目以降の訪問 | 常に演出を再生 | 6.1.1節参照 |
| フラッシュのタイミング | `flash-pop`: 12%地点でピーク（0.5s×12%≒60ms）、`flash-pop-super`: 10%地点（0.7s×10%≒70ms） | 150ms以上に変更。`flash-pop`は30%地点（0.5s×30%=150ms）、`flash-pop-super`は22%地点（0.7s×22%≒154ms）にキーフレームを調整 |
| ヘッダー文言 | 既に削除済み（前回対応） | 変更なし（タイトル文言は置かない）。魚博士ランクバッジ（`rank-badge.js`）のみ右上に小さく表示 |
| 演出終了後の導線 | なし | 「コレクション帳へ」ボタンを追加し`collection.html`へ遷移（requirements.md「演出が終わる」） |

#### 6.1.1 「既視聴」判定ロジック（Fableレビューで明確化）

backendの`handleAnswerQuiz`（`server.ts`）は`isFirstFind`が`true`の時**だけ**`buildGachaFlexMessage`を送るため、「ガチャで見る」ボタン経由でLIFFが開かれる時点では常に初回発見である。したがって再訪問が起こりうるのは、ユーザーがLINEのトーク履歴に残った同じFlex Messageボタンを後日もう一度タップするケースのみ（Firestoreドキュメント自体は既に存在し、`rarity`も確定済み）。

Fableレビュー指摘: 当初案は`firstFoundAt`と`sessionStorage`の両方を見るとしていたが、両者の組み合わせ方（AND/OR）が未定義だった。整理すると、Firestoreドキュメントは初回タップの時点で既に作成済みのため「ドキュメントの存在有無」だけでは初回/再訪問を区別できない。判定はクライアント側の記録だけで行う必要があり、以下に一本化する。

- **`sessionStorage`ではなく`localStorage`を使う**（タブ・ブラウザ再起動をまたいでも同一端末なら判定が保持されるため。requirements.mdが求める「2回目以降は演出なし」を`sessionStorage`より頑健に満たせる）
- キーは`seen:{userId}:{animalId}`。`gacha.html`表示時にこのキーが存在すれば演出を再生せずカード結果のみ表示し、存在しなければ演出を再生した直後にキーを書き込む
- Firestoreの`rarity`/`knowledgeUnlocked`等は演出の有無に関わらず常に`getCollectionEntry()`から取得して表示する（演出スキップ時もカード内容自体は正しく出す）
- この方式は端末の再インストール・別端末では引き続き効かない簡易実装であり、その限界は「未確定事項」に残す

### 6.2 コレクション帳（`collection.html`）

- `watchCollection(userId, onChange)`でリアルタイム購読し、カード一覧をCSS Gridで表示（サムネイルは`animals-lookup.js`経由）
- 各カードは`rarity`に応じた縁取り色（`gacha.html`のカード演出と同じ配色: ノーマル灰／レア青／SSレア金）
- カードタップで`card.html?animalId=xxx`へ遷移

### 6.3 カード知識ページ（`card.html`）

- `getCollectionEntry(userId, animalId)`の`knowledgeUnlocked`オブジェクトを元に項目リストを表示。`true`の項目は内容表示、`false`の項目はマスク表示（`░░░░`のようなプレースホルダー＋鍵アイコン）
- `completed: true`の場合、カード上部に「コンプリート」バッジを表示

### 6.4 魚博士ランク表示（`shared/rank-badge.js`）

- Web Component（`<rank-badge>`）として実装し、3画面のheader相当の位置に共通で埋め込む
- `getUserDoc(userId)`から`fishDoctorRank`を取得し表示。未設定時は「見習い」（requirements.md）
- ガチャ演出画面では「タイトル文言は置かない」方針と両立させるため、控えめな小さいピル型バッジとし、画面上部を占有する大きな見出しにはしない

## 7. デプロイ

`frontend/Makefile`に本番3画面用のターゲットを追加する。

```makefile
deploy-liff: manifest upload-images upload-manifest
	gcloud storage cp gacha.html $(GACHA_DEMO_PREFIX)/gacha.html --project $(PROJECT)
	gcloud storage cp collection.html $(GACHA_DEMO_PREFIX)/collection.html --project $(PROJECT)
	gcloud storage cp card.html $(GACHA_DEMO_PREFIX)/card.html --project $(PROJECT)
	gcloud storage cp -r shared $(GACHA_DEMO_PREFIX)/shared --project $(PROJECT)
```

既存の`deploy` / `deploy-01` / `deploy-02` / `deploy-03`（プロトタイプ比較用）はそのまま残す。

## 8. タスク分解の粒度（tasksフェーズへの引き継ぎメモ）

- `shared/liff-client.js`, `shared/firestore-client.js`, `shared/animals-lookup.js`, `shared/rank-badge.js` はそれぞれ独立して実装・単体確認できる
- `gacha.html`は`gacha-demo-03.html`のコピーからの差分改修（6.1節の表がそのままタスクの元になる）
- `collection.html` / `card.html` は新規作成
- Firestoreセキュリティルール自体は#785側のタスクであり、本Issueのtasks.mdには含めない（依存として待つ）

## 未確定事項（tasksフェーズ以降に持ち越し）

- `sessionStorage`による「既視聴」判定は再インストール・別タブでは効かない簡易実装。Firestore側に「演出再生済みフラグ」を持たせる恒久対応は#783/#785との調整が必要なため、本design.mdでは簡易実装を採用し将来課題として明記するに留める
- 魚博士ランクの段階・昇格ロジックは対象外（表示のみ。requirements.md未確定事項を踏襲）
