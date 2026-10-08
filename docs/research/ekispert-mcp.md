# 駅すぱあと API MCP サーバーの使い方

現在地（LINE の location メッセージ）から「最寄りの水族館」を出すために調べたメモ。

- 公式ドキュメント: <https://github.com/ValLaboratory/ekispert-api-mcp-server-docs>（`docs/features.md` 機能一覧 / `docs/examples.md` 使用例 / `docs/troubleshooting.md`）
- 調査日: 2026-09-19。公式 docs を読んだ内容のまとめで、**MCP の実呼び出しは未検証**（このセッションでは ekispert MCP を接続していない）。パラメータの細部は初回接続時に要確認

## 1. 接続方法

| 項目 | 値 |
| --- | --- |
| エンドポイント | `https://api-mcp.ekispert.jp/mcp`（Streamable HTTP） |
| 認証 | HTTP ヘッダー `ekispert-api-access-key: <駅すぱあとAPIのアクセスキー>` |
| キー取得 | 駅すぱあと API 契約者は既存キーで利用可。未契約なら 90 日無料評価版トライアルで発行 |

Claude Code への登録（キーは環境変数で渡し、リポジトリにコミットしない）:

```bash
export EKISPERT_API_ACCESS_KEY=xxxxxxxx
claude mcp add --transport http ekispert https://api-mcp.ekispert.jp/mcp \
  --header "ekispert-api-access-key: ${EKISPERT_API_ACCESS_KEY}"
```

`.mcp.json` / `.claude.json` に直接書く場合（公式は環境変数参照形式を案内）:

```json
{
  "mcpServers": {
    "ekispert": {
      "type": "http",
      "url": "https://api-mcp.ekispert.jp/mcp",
      "headers": { "ekispert-api-access-key": "${EKISPERT_API_ACCESS_KEY}" }
    }
  }
}
```

- Claude Desktop は `npx mcp-remote@latest` 経由で接続する
- 環境変数を後から設定した場合はクライアントを**完全に再起動**しないと反映されないことがある（公式 troubleshooting）
- 契約プランによっては使えない機能がある

## 2. 提供ツール（全 6 個）

| ツール | 用途 | 主な入力 |
| --- | --- | --- |
| `ekispert_api_get_stations` | 駅の詳細取得 | `name` か `code`（同時指定不可）、`type`、`simplify`（`"false"` で座標を含む詳細）、`gcs` |
| `ekispert_api_get_stations_from_address` | **住所**から周辺駅 | `address`（必須。都道府県〜町・字）、`radius`（1〜10000m）、`types`、`stationCount`（既定10）、`gcs` |
| `ekispert_api_get_stations_from_geo` | **緯度経度**から周辺駅 | `latitude`・`longitude`（必須・文字列）、`radius`、`types`、`stationCount`、`gcs`、`addGateGroup` |
| `ekispert_api_search_routes` | 経路探索（所要時間・料金・乗換） | `viaList`（必須。駅コード/駅名/座標/住所をコロン区切り）、`date`（YYYYMMDD）、`time`（HHMM）、`searchType`、`sort`、`answerCount` |
| `ekispert_api_generate_condition` | 経路探索の詳細条件文字列を生成 | 交通手段設定など（全て省略可）。出力は `T...:F...:A...:` 形式 |
| `ekispert_api_search_ranges` | 起点駅から一定時間で行ける駅の範囲探索 | `baseList`（1〜5件）、`upperMinutes`（10〜200分）、`upperTransferCounts`、`limit` |

### `get_stations_from_geo` の使い方

- 座標は十進法度（DD）と度分秒（DMS）のどちらでも指定でき、混在も可（公式の例22）
- `types` を省略するとバス停も返る。**鉄道駅だけ欲しいときは `types: ["train"]`**
- `stationCount: 0` + `radius` で半径内の全駅が返る（住所版の例21）
- `addGateGroup: "true"` で出口ごとの距離が返り、「最も近い出口」まで分かる
- `gcs` は `"wgs84"`（世界測地系）か `"tokyo"`（日本測地系）。**GPS / 国土地理院 / Google マップの座標は WGS84 なので `gcs: "wgs84"` を明示する**

```jsonc
// 海遊館の最寄り鉄道駅（出口つき）
{
  "latitude": "34.655342",
  "longitude": "135.43074",
  "radius": 1500,
  "types": ["train"],
  "stationCount": 3,
  "gcs": "wgs84",
  "addGateGroup": "true"
}
```

## 3. 「現在地から最寄りの水族館」への当て込み

駅すぱあと MCP は **駅・経路の API で、水族館（施設）を検索する機能はない**。そのため役割分担は次のとおり。

```text
LINE location (lat,lng)
  └─① 水族館マスタ（緯度経度+最寄り駅）に対し Haversine 距離で並べ替え  ← 自前計算（駅すぱあと不要）
       └─② 最寄り水族館の最寄り駅  … マスタの値 or get_stations_from_geo で照合
            └─③ 現在地 → 水族館の最寄り駅 の経路  … search_routes（所要時間・乗換・料金）
```

- 水族館マスタは `kansai-aquariums.md` に緯度経度と最寄り駅をまとめた
- 直線距離で近くても、山・海・川をはさんで実際の到達時間が長いことがある。「直線距離で上位3件を出し、`search_routes` で所要時間の短い順に並べ替える」とすれば精度が上がる
- `search_routes` の `viaList` は座標・住所も受け付けるとされるが、**座標の書式は docs で未確認**。実装前に実呼び出しで確かめる
- `get_stations_from_geo` の返り値の駅は「水族館の座標から直線距離で近い駅」であり、バス連絡が必要な館（琵琶湖博物館・串本海中公園など）の実際の玄関口駅とは一致しないことがある

## 4. 実装時の注意

- アクセスキーは Secret Manager など既存のシークレット運用に載せ、コード・docs に直書きしない
- 無料評価版は 90 日限定。本番利用は契約プランで利用可能なツールを確認する
- エラー時は「駅名表記（漢字/かな/ローマ字）」「日付は `YYYYMMDD`」「探索条件が複雑すぎないか」を疑う（公式 troubleshooting）
