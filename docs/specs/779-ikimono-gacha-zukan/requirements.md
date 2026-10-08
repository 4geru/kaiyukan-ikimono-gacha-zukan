Issue: https://github.com/4geru/tweet-bookmark/issues/779

# 要件定義: 海遊館いきものガチャ図鑑

## 実装Issue（並列ワークストリーム）

| Issue | 担当領域 | 依存 |
|---|---|---|
| [#780](https://github.com/4geru/tweet-bookmark/issues/780) | Data: 海遊館データ統合・スペシャリティクイズ生成・カードイラスト事前生成 | なし |
| [#781](https://github.com/4geru/tweet-bookmark/issues/781) | Backend: LINE Bot基盤（Cloud Run/Webhook/ADK土台） | なし |
| [#782](https://github.com/4geru/tweet-bookmark/issues/782) | Agent: 識別・解説・クイズ・雑談サブエージェント | #780, #781 |
| [#783](https://github.com/4geru/tweet-bookmark/issues/783) | Feature: ガチャ演出・カード生成ロジック | #780, #781 |
| [#784](https://github.com/4geru/tweet-bookmark/issues/784) | Frontend: LIFF Webフロントエンド | #780, #783, #785 |
| [#785](https://github.com/4geru/tweet-bookmark/issues/785) | Infra: LINE Login + Firestore永続化基盤 | なし |

> **追記（2026-09-19）**: #784のrequirements.md（`docs/specs/784-liff-frontend/`）で「レアリティ抽選はクライアントでなくサーバー側で行う」と決定したため、#784→#783の依存を追加（Fableレビューで指摘）。

## コンセプト

海遊館の生きものを学びながら「魚博士」を目指す、LINE Bot × LIFF Web アプリ。保育園児〜大人まで、年齢に応じて説明の深さ・言い回しを変えて楽しめる。
現地で案内板の写真を送ると、生き物を識別してその場で対話しながら学び、初めて見つけた種はガチャ演出付きでカード化される。集めたカードは LIFF のコレクション帳で振り返れる。

## データソース

- 海遊館公式JSON（`https://www.kaiyukan.com/connect/encyclopedia/json/animal.json` 等、243種。名前/学名/英名/説明/画像/展示エリア）
- 現地の案内板写真から Gemini で読み取る情報（水温・体長・寿命など。パネルにより情報量が異なる）
- スペシャリティクイズJSON（243種すべて事前生成した静的データ。例: 「ジンベエザメが一日に食べる量は？」「なぜ赤い体をしている？」など、その生き物ならではの一問）
- 上記をマージして、生き物ごとの知識ベースとする

## Google Cloudサービスの利用方針

- **Vertex AI Gemini（マルチモーダル）**: 案内板写真の識別、対話、クイズ生成
- **ADK + Agent Runtime**: コーディネーター＋専門サブエージェント（識別・解説・クイズ・雑談）のマルチエージェント構成。カード生成・ロック解除・DB保存など確実性が必要な処理は決定論的ルーティング、対話の展開はLLMの自律判断に委ねるハイブリッド構成
- **Gemini 3 Pro Image（Nano Banana Pro）**: ガチャカードのイラスト生成。海遊館の実写を参考画像として渡し、レアリティごとに一貫した見た目のオリジナルイラストを生成する（実写そのまま使用時の権利面の曖昧さを回避）。243種×レアリティ分を事前バッチ生成しCloud Storageに保存し、デモ当日のライブ生成は行わない
- **Cloud Run**: LINE Bot webhookバックエンド、LIFFフロントエンドのホスティング
- **Firestore**: カードコレクション・知識ページのロック解除状態の保存。LINE側の対話進捗とLIFF側の表示をリアルタイムに同期する

## 受け入れ基準（EARS形式）

### 識別

- WHEN ユーザーが LINE Bot に案内板の写真を送信する THEN system SHALL 写真内の生き物を識別し、海遊館の生きものデータ（公式JSON）とマッチングする
- IF 写真に複数種類の生き物が写っている THEN system SHALL 候補をクイックリプライ等の選択肢としてユーザーに提示し、選ばせる
- IF 案内板の写真から公式JSONにない情報（水温・体長・寿命など）が読み取れる THEN system SHALL その情報を公式JSONの説明文と統合してその生き物の知識として保持する
- IF 写真から生き物を識別できない THEN system SHALL 再撮影を促すメッセージを返す

### 年齢層対応

- WHEN ユーザーが初めてアプリを利用する THEN system SHALL 年齢を入力するフォームを表示する
- WHEN 年齢が入力される THEN system SHALL 年齢層（保育園・小学生・高校生・大人など）を判定し、Firestoreにユーザーの年齢層として保存する
- IF 年齢が未入力のままメッセージが送られる THEN system SHALL 先に年齢入力フォームへ促す
- system SHALL スペシャリティクイズを含む知識の事実・正解は年齢層によらず共通の1つとし、年齢層ごとに複数生成しない
- WHEN エージェントが説明・クイズを提示する THEN system SHALL 保存された年齢層に応じて語彙・言い回し・説明の深さを自律的に調整する（事実内容は変えず、表現のみ年齢層に合わせる）

### 対話学習

- WHEN ユーザーが生き物についてテキストまたは画像でメッセージを送る THEN system SHALL その生き物の知識（公式JSON＋案内板情報）をもとに、ユーザーの年齢層に応じた言葉で回答する
- WHEN 対話が進む THEN system SHALL ユーザーの理解度・反応に応じてクイズの難易度を自律的に調整する
- WHEN 公式データにも案内板にもない項目（食べ物など）を聞かれる THEN system SHALL 一般知識で自律的に補って回答する
- system SHALL 全243種について、あらかじめ生成しJSON化された「スペシャリティクイズ」（その生き物ならではの一問）を1問以上保持する
- WHEN ユーザーがその生き物の基礎情報（食べ物・すみか・水温など）について一通り対話済みである THEN system SHALL スペシャリティクイズを出題可能にする
- IF 基礎情報を一通り話す前にスペシャリティクイズを出題しようとする THEN system SHALL 出題を保留し、先に基礎情報の対話を続ける
- WHEN ユーザーがスペシャリティクイズに回答する THEN system SHALL 正誤を伝え、知識ページのスペシャル項目のロックを解除する
- system SHALL 対話の展開（雑談を挟む・小ネタを振る・クイズを出すタイミング）を固定シナリオではなくエージェントの自律判断に委ねる（台本通りに進行しない「気まま」な振る舞いを許容する）

### カード生成・ガチャ演出

- WHEN 生き物が識別される THEN system SHALL その場で生きものカード（画像＋知識サマリ）を生成する
- system SHALL カードのイラストを Gemini 3 Pro Image（Nano Banana Pro）で事前生成する（243種×レアリティ分をバッチ生成し保存、ライブ生成はしない）
- IF その生き物をユーザーが初めて見つけた THEN system SHALL FlexMessageでガチャ演出用のLIFF URLを返す
- WHEN ユーザーがガチャ演出用URLをタップする THEN system SHALL LIFF上でレアリティに応じた登場アニメーションを再生する
- WHEN ガチャ演出が発生する THEN system SHALL その都度レアリティを抽選する（同じ生き物でも引くたびにレアリティが変わりうる）
- WHERE レアリティを表現する場面 THE system SHALL 全ての結果をポジティブな演出にする（「ハズレ」演出を作らない）
- WHEN 同じ生き物を2回目以降見つける THEN system SHALL ガチャ演出なしで通常のカード返却のみ行う
- IF 端末がVibration APIに対応している（主にAndroid） THEN system SHALL ガチャ演出に合わせて補助的にバイブレーションを鳴らす
- system SHALL バイブレーション非対応端末（iOS等）でも視覚エフェクトのみで演出が完結するようにする（`navigator.vibrate` 呼び出しは存在チェック付きで行い、非対応環境でエラーや停止を起こさない）

### コレクション帳・魚博士システム

- WHEN ユーザーが初回利用する THEN system SHALL LINE Loginでユーザーを識別し、Firestoreにコレクションを紐づけて保存する
- WHEN ユーザーがLIFFのコレクション帳を開く THEN system SHALL これまで集めたカード一覧を表示する
- WHEN 集めた種類数・レアリティ・対話学習の理解度が一定の基準に達する THEN system SHALL 「魚博士」への成長段階（称号・ランク）を更新する
- WHEN ユーザーがカードの知識ページを初めて開く THEN system SHALL 項目（食べ物・すみか・水温など）を全て非公開（ロック状態）で表示する
- WHEN ユーザーがLINEチャットでその生き物について対話し、ある項目について学ぶ THEN system SHALL 対応する項目のロックをWebページ側で解除する
- WHEN 知識ページの項目が全て解除される THEN system SHALL そのカードを「コンプリート」として扱う（魚博士ランクの判定要素にする）

### 制約

- WHERE 館内での利用シーン THE system SHALL 音・フラッシュなど他の来館者に迷惑をかける演出を行わない
- system SHALL リアルタイム物体トラッキング機能を持たない
- system SHALL 「持ち帰って後で見返す」体験ではなく、その場での即時報酬（ガチャ演出・カード獲得）を優先する

## 未確定事項（設計フェーズで詰める）

- レアリティの段階数・判定基準（公式データにレア度情報がないため独自設計が必要）
- 「魚博士」の称号・ランクの段階と判定ロジック
- 対話中に送られた画像の具体的な用途（再識別か、補足資料か）
- スペシャリティクイズJSONの生成方法（生成スクリプト・プロンプト設計）と、事実誤りがないかの確認プロセス
- 年齢層の区分の具体的な年齢範囲（保育園・小学生・高校生・大人の境界値）と、年齢入力フォームのUI（LIFF上か、チャット内か）
