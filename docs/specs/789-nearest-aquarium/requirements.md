Issue: https://github.com/4geru/tweet-bookmark/issues/789

# 要件定義: LINE位置情報から最寄りの水族館を返す

## 背景・スコープ

LINE Bot が `location` メッセージ（位置情報）を受け取ったとき、現在地から最寄りの水族館を返す。あわせて駅すぱあと API MCP で「現在地の最寄り駅」を検索し、その駅から水族館の最寄り駅までの経路を案内する（MCP の仕様は [ekispert-mcp.md](../../research/ekispert-mcp.md)）。

現行の `server.ts` は `text` / `image` / `postback` のみを扱っており、`location` は未対応。

対象:
- `location` メッセージの受信と、最寄り水族館の判定（直線距離）
- 駅すぱあと MCP による、現在地の最寄り駅の検索と、「現在地の最寄り駅 → 水族館の最寄り駅」の経路検索
- 関西の水族館マスタ（名称・住所・緯度経度・最寄り駅・アクセス・公式URL）の保持

対象外（本specでは扱わない）:
- 魚（生きもの）情報の返却。施設情報のみ返す（生きものマスタ `animalMaster` は海遊館のみのため。必要になったら別Issue）
- 関西以外の水族館
- 水族館の営業時間・料金・混雑状況の提供
- 現在地から最寄り駅までの徒歩・バス案内（駅すぱあとが返す駅までの距離の表示のみ）

## 受け入れ基準（EARS形式）

### 位置情報の受信

- WHEN ユーザーが LINE で `location` メッセージを送る THEN system SHALL メッセージの緯度経度を取得し、最寄り水族館の検索を実行する
- WHEN `text` / `image` / `postback` を受信する THEN system SHALL 既存の挙動を変えない
- system SHALL ユーザーの緯度経度を Firestore・ログ等に永続化しない（検索中のメモリ内でのみ扱う）

### 最寄り水族館の判定

- WHEN 位置情報を受信する THEN system SHALL 水族館マスタの緯度経度との直線距離（Haversine）を計算し、最も近い1館を最寄りの水族館とする
- system SHALL 返信に、水族館名・住所・現在地からの直線距離（km）・最寄り駅・公式URLを含める
- IF 最寄りの水族館までの直線距離が 100km を超える THEN system SHALL 「対応エリア（関西）から離れている」旨を伝えたうえで、最寄りの1館を案内する

### 経路案内（駅すぱあと MCP）

- WHEN 最寄り水族館が決まる THEN system SHALL 駅すぱあと MCP の `get_stations_from_geo`（`types: ["train"]`、`gcs: "wgs84"`）で現在地の最寄り駅を取得する
- WHEN 現在地の最寄り駅を取得できた THEN system SHALL `search_routes` で「現在地の最寄り駅 → 水族館の最寄り駅（マスタの値）」を検索し、所要時間・乗換回数・料金を返信に含める。出発日時は受信時刻（JST）とする
- IF 現在地の最寄り駅と水族館の最寄り駅が同じ THEN system SHALL 経路検索を行わず、同じ駅である旨を伝える
- WHERE 水族館の最寄り駅からバス・徒歩の移動が必要な館（琵琶湖博物館・串本海中公園など） THE system SHALL マスタの「駅からのアクセス」（例: 草津駅西口から近江バス約25分）を併記する

### 失敗時の挙動（フォールバック）

- IF 駅すぱあと MCP の呼び出しがエラー・タイムアウトになる、またはアクセスキーが未設定である THEN system SHALL 経路なしで水族館の情報（名称・直線距離・最寄り駅・アクセス）を返信し、経路を取得できなかった旨を伝える
- IF 現在地の周辺に駅が見つからない THEN system SHALL 同様に経路なしで水族館の情報のみ返信する
- system SHALL いかなる失敗でもユーザーへ何らかの返信を返す（無応答にしない）

### 水族館マスタ

- system SHALL 関西の水族館マスタとして、各館の名称・住所・緯度経度（WGS84）・最寄り駅・駅からのアクセス・公式URLを保持する
- system SHALL マスタの最寄り駅には「直線距離が近い駅」ではなく、公式が案内する玄関口駅を入れる（バス連絡の館では両者が異なるため）
- system SHALL マスタの内容を [kansai-aquariums.md](../../research/kansai-aquariums.md)（調査済み15館）から作る

### 運用・セキュリティ

- system SHALL 駅すぱあとのアクセスキーを Secret Manager で管理し、リポジトリにコミットしない
- system SHALL 位置情報を受け取った返信の生成でも、既存の LINE 署名検証を通過したリクエストのみ処理する

## 未確定事項（設計フェーズで詰める）

- マスタの置き場所（既存の `backend/data/*.json` か Firestore か。#780 の方針との整合）
- 駅すぱあと MCP をバックエンドからどう呼ぶか（MCP クライアント実装か、同一キーの REST API 直呼びか）とタイムアウト値
- 返信の見た目（Flex Message か、キャラクター `sender` での掛け合いを使うか）
- 最寄り以外の次点候補（2〜3館）を出すか
