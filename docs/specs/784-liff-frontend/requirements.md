Issue: https://github.com/4geru/tweet-bookmark/issues/784

# 要件定義: LIFF Webフロントエンド（ガチャアニメーション・コレクション帳・知識ロック解除UI）

Part of #779。対象範囲は Issue #784 本文の4画面（ガチャ演出／コレクション帳／カード知識ページ／魚博士ランク表示）。
[779requirements.md](../779-ikimono-gacha-zukan/requirements.md) の「カード生成・ガチャ演出」「コレクション帳・魚博士システム」節が満たすべき受け入れ基準の上位互換であり、本ドキュメントはそれをLIFF側の実装として具体化する。

## 前提・依存

- 表示デバイス: スマートフォン上での利用のみを想定する（LINEアプリ内LIFFブラウザ、館内でユーザーが自分のスマホで開く前提）。PC/タブレット幅のレイアウト最適化は対象外とする
- 認証: LINE Login（依存Issue: Infra — 未着手time点では `liff.getProfile()` 等から得られる `userId` が `users/{lineUserId}` と一致する前提でモックする）
- データ: Firestore `users/{lineUserId}/collection/{animalId}`（[779design.md](../779-ikimono-gacha-zukan/design.md) 1.3節のスキーマ）
- カードイラスト: `images/animals/` に生成済み（[techbookfest等ではなく] `backend/scripts/generate-animal-images.ts` で生成、`gs://kaiyukan-gacha-hackathon-public-assets/animals/` に公開済み）
- ガチャ演出のプロトタイプ: `frontend/gacha-demo-01/02/03.html`（3方向性の演出デモ、レア度選択デモ機能つき）を作成済み。**本要件定義でどれを採用するか決定する**

## 決定事項（このrequirements.mdで確定させる論点）

### 1. 採用する演出方向性

`frontend/gacha-demo-03.html`（水面ジャンプ演出）をベースに採用する。ユーザーが3案を見比べた上での選択。

### 2. レアリティ段階・抽選テーブル

[779design.md](../779-ikimono-gacha-zukan/design.md) 1.5節で「#783着手前には必須」として未確定だった論点。プロトタイプで実装・確認済みの3段階テーブルを正式仕様として採用する。

| レアリティ | 出現率 | 演出の強さ |
|---|---|---|
| ノーマル | 60% | 控えめ（画面シェイク・フラッシュなし） |
| レア | 30% | 中（画面シェイクあり、白フラッシュ） |
| SSレア | 10% | 最大（強い画面シェイク、虹色フラッシュ、光線バースト） |

### 3. レアリティを抽選する場所: バックエンド（サーバー側）

[779requirements.md](../779-ikimono-gacha-zukan/requirements.md) は「WHEN ガチャ演出が発生する THEN system SHALL その都度レアリティを抽選する」の主体を明記していなかった。以下の理由でバックエンド（LINE Bot / `handleAnswerQuiz`）が抽選し、Firestore `collection/{animalId}.rarity` に確定値として保存する方式に決定する。

- クライアント側で抽選すると改ざん・リロードでの再抽選が可能になり、コレクション帳に残る記録の信頼性が保てない
- `users/{userId}/collection/{animalId}.rarity` は既にフィールドとして存在する設計（現状の実装は `"unknown"` 固定値でスタブ状態）
- LIFF側は「サーバーが既に決めたレアリティを読み取って、それに応じた演出を再生する」役割に限定する（演出の抽選ロジック自体はLIFFに持たせない）

これにより、`backend/src/server.ts` の `handleAnswerQuiz` 内でレアリティ抽選ロジックを実装することが本Issueの前提条件として追加される。実装は「Feature: ガチャ演出・カード生成ロジック」（#783）の範囲とし、#784は#783完了後に着手する依存関係として扱う（Fableレビューで指摘: [779requirements.md](../779-ikimono-gacha-zukan/requirements.md) の実装Issue表は元々 #784 の依存を `#780, #785` としか書いておらず、この決定を反映していなかったため、本docsとあわせて779requirements.md側の依存表も修正する）。

`#783`実装が先行するまでの間、`rarity`フィールドは`"unknown"`のままのドキュメントが存在しうる。LIFF側はこれを未定義の3段階レアリティ値として扱わず、明示的にフォールバックする（6節の受け入れ基準に追記）。

### 4. 館内演出の音・フラッシュ制約とプロトタイプの「ドッカーン」演出の整合

[779requirements.md](../779-ikimono-gacha-zukan/requirements.md) の制約「WHERE 館内での利用シーン THE system SHALL 音・フラッシュなど他の来館者に迷惑をかける演出を行わない」と、ハッカソンデモ向けに強化した `gacha-demo-03.html` の画面フラッシュ（`.flash-overlay`、特にSSレアの虹色フラッシュ）が緊張関係にある。以下の方針で整合させる。

- 音は一切使用しない（プロトタイプも元々未使用）
- 画面内フラッシュ（`.flash-overlay`）は「他の来館者に見える物理的なカメラフラッシュ」ではなく「スマホ画面内のCSSアニメーション」であり、館内の照明・撮影禁止エリアに影響しないため許容する
- ただし過度な白飛び・高速点滅はてんかん等への配慮の観点からも避けるべき。**Fableレビューで指摘・修正**: 当初「プロトタイプのタイミングを踏襲すれば150ms以上」としていたが誤りだった。実測では `gacha-demo-03.html` の `flash-pop`（レア）は0.5s×12%≒60ms、`flash-pop-super`（SSレア）は0.7s×10%≒70msで最大輝度に達しており、いずれも150ms未満。本番LIFF実装では最大輝度到達を150ms以上に**新たに伸ばす**（プロトタイプ本体のCSSタイミング値を変更する実装作業が必要になる。8節タスクに反映）
- 画面シェイク・バイブレーションは端末内で完結するため制約の対象外

### 5. プロトタイプ更新（`gacha-demo-03.html`、2026-09-19）

実際に動かしながら以下を確定させた。

- **`animalId`クエリパラメータを実装・動作確認済み**: `?animalId=134`のように指定すると、該当生きものに固定してガチャ演出を再生する（該当なし/未指定時は`images/animals`にある生成済みイラストからランダム）。1節「起動・入力」で言葉としては決めていた仕様を、プロトタイプで先に検証した形
- **画面のヘッダー文言（バリアント名・件数・タイトル・サブタイトル）を削除**し、演出本体（ステージ・結果表示・ボタン）だけのミニマルな画面にした。本番LIFFのガチャ演出画面もこれに準拠し、常設のタイトル文言は置かない
- **レア度選択UI（画面下部の「ランダム/ノーマル/レア/SSレア」ボタン、デフォルトSSレア固定）は動作確認・デモ用の一時的な機能であり、本番の受け入れ基準には含まれない**。3節の通り、本番はFirestoreの`rarity`を読むだけでLIFF側は再抽選しない。実装を#783→#784の順で進める際、このデバッグ用UIは本番ビルドから除外する（またはデバッグフラグの裏に隠す）ことをタスク化する
- **モバイル表示のはみ出し不具合を修正**: `html, body`の`overflow: hidden`を`overflow-y: auto`に変更し、`.stage`のサイズを横幅（`vw`）だけでなく高さ（`vh`）でも制限する（`min(78vw, 38vh, 320px)`）ことで、画面の低いスマホでも要素が切れずに収まるようにした。下記「制約」節の「スマートフォン幅」要件に、高さ方向の考慮も追加する

### 6. 演出の全画面化とSE追加（2026-09-19、requirements変更）

ユーザーから「画面全体を使う演出にしたい」「海系のSEを入れたい」という要望があり、以下の2点を決定する。

- **演出を画面全体で行う**: これまで`.stage`は画面中央の固定サイズボックス（`min(78vw, 38vh, 320px)`）に限定されていたが、水面・光線・バースト・パーティクルを画面いっぱいに広げる。結果表示・ボタン類は画面下部に固定配置し、中央〜全体を演出領域として使う
- **SE（効果音）を追加し、4節の「音を一切再生しない」制約を変更する**: 4節で「館内での利用シーンでは音を一切再生しない」としていた制約を、**「ミュート切り替えボタンを常設し、ユーザーがいつでもON/OFFできる」**に緩和する。理由:
  - ユーザーが自分の意思でON/OFFを切り替えられる以上、通常のスマホアプリの音設定と同等の操作性である
  - ミュート状態はデバイスに記憶し、次回訪問時も引き継ぐ
  - SEは音声ファイルを用意せず、Web Audio APIでその場で合成する（水しぶき風のノイズ、レアリティに応じたチャイム音）
  - **デフォルトはSE ON（2026-09-19、ユーザー指示で確定。当初案の「デフォルトミュート」から変更）**。この結果、4節が挙げていた「館内で他の来館者に配慮するため意図せず音を鳴らさない」という当初の趣旨はデフォルトでは働かなくなる（ミュートボタンで自分でOFFにする運用に委ねる）点は、トレードオフとして明記しておく。なお、ブラウザの自動再生ポリシーにより、ページ読み込み直後（ユーザー操作前）はSE ON設定でも実際には音が鳴らないことがある（ユーザーが画面のどこかをタップした時点で再生可能になる、Web Audio APIの一般的な制約）。これはバグではなく仕様上避けられない挙動として明記する

## 受け入れ基準（EARS形式）

### 起動・入力

- WHEN ユーザーがLINEの「ガチャで見る」Flex Messageボタンをタップする THEN system SHALL LIFFを起動し、URLクエリパラメータ `animalId` から対象の生きものを受け取る（`gacha-demo-03.html`でパラメータ名・挙動を実装・検証済み。5節参照）
- WHEN LIFFが起動する THEN system SHALL `liff.init()` 後に `liff.getProfile()` 等でLINEユーザーを識別する
- IF `animalId` に対応するFirestoreドキュメント（`users/{userId}/collection/{animalId}`）が存在しない THEN system SHALL エラー画面（「見つかりませんでした」）を表示する

### ガチャ演出画面

- WHEN ガチャ演出画面が表示される THEN system SHALL Firestoreから該当 `animalId` の `rarity` を読み取り、そのレアリティに応じた演出（`gacha-demo-03.html`の3段階: ノーマル/レア/SSレア）を再生する
- system SHALL レアリティをLIFF側で再抽選しない（3節の通りサーバー確定値を使う）
- IF `rarity`の値が`"normal"`/`"rare"`/`"super"`のいずれでもない（`"unknown"`を含む。#783未実装期間に発生しうる） THEN system SHALL エラーとして扱わず、ノーマル相当の演出にフォールバックする
- WHEN 演出が再生される THEN system SHALL 該当生きもののイラスト（`images/animals/`）を演出内のカードに表示する
- system SHALL 全レアリティの結果をポジティブな演出にする（「ハズレ」表現を作らない）
- system SHALL 演出を画面全体を使って再生する（6節。水面・光線・バースト・パーティクルを画面全域に広げ、結果表示・ボタンは画面下部に固定配置する）
- WHEN ガチャ演出画面が表示され、かつ未視聴（初回訪問）である THEN system SHALL ユーザーの操作を待たずに演出を自動再生する（6節、要望により追加。`?debug=1`時のみ、レア度選択のため自動再生せず手動開始ボタンを表示する）
- IF 端末がVibration APIに対応している THEN system SHALL 演出に合わせて補助的にバイブレーションを鳴らす。`navigator.vibrate`は存在チェック付きで呼び出し、非対応環境でエラーや停止を起こさない
- system SHALL 演出に合わせて海系のSE（水しぶき・チャイム音）をWeb Audio APIで再生する。デフォルトはSE ON。画面上のミュートボタンでいつでもON/OFFを切り替えられる（6節）。ミュート状態は端末に保存し、次回以降も引き継ぐ
- WHEN 演出が終わる THEN system SHALL カード情報（名前・学名・レアリティ）を表示し、コレクション帳への導線ボタンを表示する
- WHEN ユーザーが同じ `animalId` に対して演出画面を再訪する（例: URLを再度開く） THEN system SHALL ガチャ演出を再生せず、カードの結果表示のみ行う（[779requirements.md](../779-ikimono-gacha-zukan/requirements.md)「同じ生き物を2回目以降見つける」に対応）

### コレクション帳

- WHEN ユーザーがコレクション帳画面を開く THEN system SHALL `users/{userId}/collection` 配下の全ドキュメントを取得し、カード一覧（サムネイル・名前・レアリティ）をグリッド表示する
- WHEN コレクション帳が更新される（LINEチャット側での新規発見・知識解除） THEN system SHALL Firestoreのリアルタイムリスナー（`onSnapshot`）で表示を自動更新する
- WHEN ユーザーが一覧のカードをタップする THEN system SHALL カード知識ページへ遷移する

### カード知識ページ

- WHEN カード知識ページが表示される THEN system SHALL `knowledgeUnlocked`（食べ物・すみか・水温など）の各項目を、ロック済み/解除済みの状態で表示する
- WHEN ロック済みの項目が表示される THEN system SHALL 内容を伏せ字またはマスク表示にする
- WHEN `knowledgeUnlocked`の全項目がtrueになる（`completed: true`） THEN system SHALL そのカードを「コンプリート」バッジ付きで表示する

### 魚博士ランク表示

- WHEN ユーザーがLIFFのいずれかの画面を開く THEN system SHALL `users/{lineUserId}.fishDoctorRank` を取得し、ヘッダー等に現在の称号を表示する
- IF `fishDoctorRank`が未設定（初回） THEN system SHALL デフォルト値「見習い」を表示する

### 制約

- WHERE 館内での利用シーン THE system SHALL 音を一切再生しない
- system SHALL 画面フラッシュ演出について、決定事項4節の輝度到達時間の下限を守る
- system SHALL LIFFのTypeScript実装を `frontend/` 配下に置く（既存の `frontend/gacha-demo-*.html` プロトタイプ、`frontend/build-manifest.mjs`、`frontend/Makefile` と同じディレクトリ）
- system SHALL スマートフォン幅（〜428px程度）でのレイアウトを主対象とする。PC幅での崩れ確認・最適化は行わない
- system SHALL 画面の高さが低い端末でも要素が見切れないよう、縦スクロール可能なレイアウトにする（5節の修正を踏襲。`overflow: hidden`による強制クリップは行わない）

## 未確定事項（設計フェーズで詰める）

- LIFFのビルド構成（プレーンHTML/JS運用を続けるか、Vite等を導入するか）
- Firestoreへのクライアント直接アクセスの認可方法（Firestoreセキュリティルール。[779design.md](../779-ikimono-gacha-zukan/design.md) Fableレビューで指摘済み・#785側の前提条件）
- コレクション帳・知識ページのルーティング方式（LIFF内で複数URLを使うか、1ページ内でのタブ切り替えにするか）
- 魚博士ランクの段階・昇格ロジック（[779design.md](../779-ikimono-gacha-zukan/design.md) 1.5節で既に未確定と明記されており、本Issueでは「表示する」ことのみを扱い、ランク算出ロジック自体は対象外とする）
