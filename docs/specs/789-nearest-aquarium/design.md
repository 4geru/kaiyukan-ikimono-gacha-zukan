Issue: https://github.com/4geru/tweet-bookmark/issues/789

# 設計: LINE位置情報から最寄りの水族館を返す

> **本ドキュメントは提案であり、ユーザー承認待ち。** 承認後に tasks.md を作成し、実装に入る。
> 前提の要件は [requirements.md](requirements.md)、調査は [ekispert-mcp.md](../../research/ekispert-mcp.md) / [kansai-aquariums.md](../../research/kansai-aquariums.md)。

## 0. このdesignで決めること

requirements.md 末尾の「未確定事項」4点に結論を出す。

| # | 論点 | 結論 |
| --- | --- | --- |
| 1 | 駅すぱあとをバックエンドからどう呼ぶか | **MCPを経由せず、駅すぱあと API の REST を直接叩く**（`https://api.ekispert.jp/v1/json/...`）。MCPは開発時の探索用に留める |
| 2 | 水族館マスタの置き場所 | **ローカルJSON** `backend/data/kansai-aquariums.json`（既存 `kaiyukan-exhibitions.json` と同じ扱い）。Firestoreには置かない |
| 3 | 返信の見た目 | **`characterLine` 2通 + Flex カルーセル1通**。既存の `buildMatesFlexMessage` のカード構造を踏襲 |
| 4 | 次点候補を出すか | **出す（最大3館）**。ただし経路検索は1位のみ。直線距離と実所要時間が逆転しうるため、候補提示は実利がある |

---

## 1. 駅すぱあと連携方式（最大の論点）

### 1.1 選択肢の比較

呼び出し主体は Cloud Run 上の Express プロセス（LINE webhook ハンドラ）であり、**LLMセッションではない**。この前提で3案を比較した。

| | (a) MCPクライアントを組み込む | (b) REST API 直呼び | (c) その他（Cloud FunctionsでMCPを中継 等） |
| --- | --- | --- | --- |
| 実現可否 | 可能。`@modelcontextprotocol/sdk` の `Client` + `StreamableHTTPClientTransport`（`requestInit.headers` に `ekispert-api-access-key`）で `callTool()` を直接呼べる | 可能。`fetch` のみ。追加依存ゼロ | 可能だが (a) の課題を別プロセスに移すだけ |
| 認証 | 同じアクセスキー | **同じアクセスキー** | 同左 |
| レスポンス | ツール結果は `content[].text` に入った文字列。**LLMが読む前提の整形であり、スキーマが公式にドキュメント化されていない**。パースは自前のJSON.parse＋型ガード頼み | `ResultSet` 以下の要素が[公式リファレンス](https://docs.ekispert.com/v1/api/)で定義済み。バージョン（`apiVersion`/`engineVersion`）も返る | (a)と同じ |
| 往復回数 | `initialize` → `notifications/initialized` → `tools/call` のハンドシェイクがセッションごとに必要（セッション再利用にはコネクション寿命管理が要る。Cloud Runはインスタンスが落ちうる） | 1リクエスト1往復 | さらに1ホップ増える |
| タイムアウト制御 | SDK層を挟むため `AbortSignal` の効き方・SSEストリームの切断処理を自前で検証する必要あり | `fetch(url, { signal: AbortSignal.timeout(ms) })` で素直に効く | 同左＋コールドスタート |
| 依存・脆弱性 | 依存が1つ増える（既に `@google/adk` 経由の間接依存で `npm audit` 指摘を抱えている。CLAUDE.md「低」TODO） | 増えない | インフラが増える |
| 障害切り分け | LINE → Cloud Run → MCPゲートウェイ → 駅すぱあとAPI の3段 | LINE → Cloud Run → 駅すぱあとAPI の2段 | 4段 |

### 1.2 結論: (b) REST API 直呼びを採用する

決め手は、**MCPサーバーの公式docsが「駅すぱあと API（`https://docs.ekispert.com/v1/`）へのゲートウェイ」であると明示している**こと（2026-09-19に公式リポジトリで確認）。つまり MCP を経由しても最終的に叩かれるのは同じ REST API であり、**同じアクセスキーで、より安定した契約（ドキュメント化されたレスポンススキーマ）に、より短い経路で到達できる**。

MCPは「LLMがツールを発見して自然言語の判断で呼ぶ」ためのプロトコルであり、本機能のように**呼ぶツールも引数もコード側で確定している処理**では、得られる利点（動的なツール発見、LLM向けの説明文）がひとつも効かない一方、ハンドシェイク・セッション管理・非ドキュメント化されたレスポンス整形というコストだけが乗る。

MCPツール名と REST エンドポイントの対応は次のとおりで、必要な2機能はどちらも REST 側に存在する。

| requirements.md が要求する処理 | MCPツール | 採用するRESTエンドポイント |
| --- | --- | --- |
| 現在地の最寄り駅 | `ekispert_api_get_stations_from_geo` | `GET /v1/json/geo/station` |
| 最寄り駅 → 水族館の最寄り駅の経路 | `ekispert_api_search_routes` | `GET /v1/json/search/course/extreme` |
| （マスタ整備時のみ）駅コード引き | `ekispert_api_get_stations` | `GET /v1/json/station` |

**MCPを捨てるわけではない。** 開発時に Claude Code へ `ekispert` MCP を接続し、パラメータの効き方・レスポンスの実形を対話的に確かめる用途には使う（`.mcp.json` 登録手順は ekispert-mcp.md 1節）。**確かめた結果を REST 呼び出しとして実装する**、という役割分担にする。

### 1.3 呼び出し仕様

```
GET https://api.ekispert.jp/v1/json/geo/station
  ?key={EKISPERT_API_ACCESS_KEY}
  &geoPoint={lat},{lng},wgs84,{radius_m}   # 測地系はWGS84を明示（LINEの位置情報はGPS=WGS84）
  &type=train                              # 省略するとバス停も返る
  &stationCount=1
```

```
GET https://api.ekispert.jp/v1/json/search/course/extreme
  ?key={EKISPERT_API_ACCESS_KEY}
  &viaList={出発駅コード}:{到着駅コード}   # コロン区切り
  &date={YYYYMMDD}&time={HHMM}             # 受信時刻(JST)
  &searchType=departure
  &answerCount=1
```

- **`viaList` は駅名ではなく駅コードで渡す。** 同名別事業者の駅（手柄山平和公園・湊川など、kansai-aquariums.md で確認済み）の誤解決を防ぐため。出発側は `geo/station` のレスポンス `Point[].Station.code` がそのまま使え、到着側はマスタに焼き込んだ `stationCode` を使う（2.2節）
- レスポンスから取るもの: `geo/station` は `Point[].Distance`（直線距離m）・`Point[].Station.{code,Name}`、`search/course/extreme` は `Route.transferCount`（乗換回数）・所要時間（`Route.timeOnBoard + Route.timeWalk + Route.timeOther` の3要素合算、実測で確認済み。1.5節）・`Price` の片道運賃（`kind: "FareSummary"` の `Oneway`）
- **駅すぱあとのJSONは、結果が1件のとき配列ではなく単一オブジェクトになる**という既知の癖がある。配列化ヘルパー（`toArray(x) = Array.isArray(x) ? x : x == null ? [] : [x]`）を通してから扱う。実測で確認済み（1.5節）
- タイムアウトは **1呼び出し3.5秒**（`AbortSignal.timeout(3500)`）、**リトライなし**。LINEの replyToken には実質的な寿命があり、`geo/station` → `search/course/extreme` の直列2回で最大7秒＋Flex組み立て、を上限予算とする。超えたらフォールバック（7節）

### 1.4 キーの管理

- Secret Manager に `EKISPERT_API_ACCESS_KEY` を新規作成し、`backend/Makefile` の `--set-secrets` に追記する
  ```
  --set-secrets="...,EKISPERT_API_ACCESS_KEY=EKISPERT_API_ACCESS_KEY:latest"
  ```
- `backend/env.sample` にキー名だけ追記（値は空）。`.env` は既に gitignore 対象
- **キー未設定でもプロセスは起動する**。`LINE_CHANNEL_SECRET` のような起動時 `throw` にはしない（requirements.md「アクセスキーが未設定である THEN 経路なしで返信」を満たすため、未設定は実行時のフォールバック扱い）
- **キーはクエリパラメータに載るため、リクエストURLをそのままログ出力しない**。ログにはエンドポイント名とステータスコードのみ出す

### 1.5 実呼び出しでの検証結果（2026-09-19、評価版キーで確認済み）

キー取得後に `geo/station`（海遊館付近, `geoPoint=34.655342,135.43074,wgs84,1500`）と `search/course/extreme`（大阪港→桜島）を実呼び出しし、以下が確認できた。**当初の5点の未検証事項はすべて解消**。

1. **契約プランで両エンドポイントとも200が返る。** `geo/station` は大阪港駅(369m)・桜島駅(742m)を正しく返し、`search/course/extreme` も乗換2回・運賃420円・時刻付きの経路を返した。評価版キーで本機能に必要な2エンドポイントは利用可能と確認できた
2. `type=train` はそのままで有効（駅の `Station.Type` にも `"train"` が入って返る）
3. **1件のときはオブジェクト、複数のときは配列、を実データで確認。** `stationCount=1` にすると `ResultSet.Point` が配列でなく単一オブジェクトになった。1.3節の `toArray()` ヘルパーは必須
4. **所要時間の合算式を修正: `timeOnBoard + timeWalk + timeOther` の3要素。** design当初は`timeOnBoard`+`timeWalk`のみを想定していたが、実レスポンスに`timeOther`（乗換待ち時間等）が存在し、`14分(timeOnBoard) + 0分(timeWalk) + 10分(timeOther) = 24分`が実際の発着時刻差(05:29→05:53)と一致した。**2要素ではなく3要素の合算に設計を修正する**
5. **姫路市立水族館の最寄り「手柄山平和公園駅」（2026-03開業）はデータに存在する**（駅コード `30050`）。駅名検索 (`GET /v1/json/station?name=手柄山平和公園`) で取得済み。同名のバス停(`258810`)も別レコードで返るため、マスタ焼き込み時は `Type: "train"` のレコードを選ぶこと

これにより tasks.md の最初のタスク（評価版キー発行＋疎通確認）は完了済みとして扱える。次のタスクからそのまま着手できる。

---

## 2. 水族館マスタ

### 2.1 置き場所: ローカルJSON

`backend/data/kansai-aquariums.json` に置き、`backend/src/aquariumData.ts` が読む。Firestore には置かない。

判断根拠:

- 既存プロジェクトの分岐基準が `kaiyukanData.ts` に明記されている — **243種の生きものマスタ（大量・更新される）はFirestore、19件の展示エリア（静的な参照データ）はローカルJSON**（`getExhibitionName` のコメント）。水族館15館は後者に完全に該当する
- #780（`docs/specs/780-kaiyukan-data-firestore/`）がFirestore化の対象としたのは「海遊館公式JSONから再取得で更新されるマスタ」。水族館マスタは手作業で作る静的データで、更新頻度は年単位。**Firestoreに置くとseedスクリプト・投入手順・読み取りレイテンシが増えるだけで、得るものがない**
- `backend/Dockerfile` には既に `COPY --chown=10001:10001 data ./data` があり（#780 tasks で削除を見送り済み）、**追加のDockerfile変更なしにCloud Runへ載る**。CLAUDE.md が警告する `ENOENT` 障害の再発リスクもこの経路では低い
- LINEの位置情報は永続化しない方針（requirements.md）なので、Firestore を使う必然性がそもそもない

キャッシュは `loadExhibitions()` と同じ **モジュール変数に `Promise<T[]>` を保持する形**にする（初回アクセス時に1回だけ読む）。

### 2.2 スキーマ

```ts
// backend/src/aquariumData.ts
export interface Aquarium {
  id: string;            // "kaiyukan" 等のスラッグ
  name: string;          // "海遊館"
  prefecture: string;    // "大阪"
  address: string;       // "大阪市港区海岸通1-1-10"
  lat: number;           // WGS84 十進法度
  lng: number;
  station: string;       // 玄関口駅名（直線最寄り駅ではない）: "大阪港"
  stationCode: number | null; // 駅すぱあとの駅コード。未取得の間はnull
  access: string;        // "大阪港駅 徒歩約9分" / "草津駅西口から近江鉄道バス約25分"
  url: string;           // 公式サイト
}
```

- 内容は kansai-aquariums.md の15館表から作る。ただし同メモが「**マスタ化するときは全館の住所を公式サイトで再確認すること**」（初期調査で2件の住所誤りがあった）と明記しているので、**タスク化して再確認する**
- `stationCode` は **マスタに焼き込む**（ランタイムで駅名から引き直さない）。取得は `GET /v1/json/station?name={駅名}&gcs=wgs84` を使う一度きりのスクリプト（`backend/scripts/fetch-aquarium-station-codes.ts`）で行い、同名別事業者駅は目視で選ぶ。ランタイムのAPI呼び出しを1回減らし、駅の取り違えも防げる
- `stationCode` が `null` の館は経路検索をスキップし、アクセス情報のみ返す（7節のフォールバックに合流）

---

## 3. 処理フロー

```
LINE location message (lat, lng)
  │
  ├─ 1. 直線距離（Haversine）で全15館をソート → 上位3館
  │      ※ 外部API不要。ここまでで最低限の返信は必ず作れる
  │
  ├─ 2. [駅すぱあと] geo/station(現在地, type=train, wgs84) → 現在地の最寄り駅コード
  │      失敗/駅なし → 経路なしで 4 へ
  │
  ├─ 3. 1位の館の stationCode と比較
  │      同じ駅 → 「もう最寄り駅にいる」旨。経路検索はしない
  │      違う   → [駅すぱあと] search/course/extreme(出発駅:到着駅, 受信時刻JST, departure)
  │              → 所要時間・乗換回数・運賃
  │      失敗 → 経路なしで 4 へ
  │
  └─ 4. 返信の組み立て（5節）→ client.replyMessage
```

- 2と3は**直列**（3が2の結果に依存するため）。1は外部依存なしなので、2の前に必ず完了している
- 距離計算は地球半径 6371km の Haversine。誤差は本用途（km表示・順位付け）には十分
- 1位が100kmを超える場合は、requirements.md どおり「対応エリアから離れている」旨を添えたうえで案内する。**経路検索は100km超でも実行する**（関東から関西へ行く経路として意味があるため）
- 受信時刻は `Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo' })` で JST の `YYYYMMDD` / `HHMM` に変換する（Cloud Run のプロセスTZはUTC）

---

## 4. ファイル構成

```
backend/
  data/
    kansai-aquariums.json        # 新規: 水族館マスタ15館
  scripts/
    fetch-aquarium-station-codes.ts  # 新規: 駅名→駅コードを引いてマスタに焼き込む（一度きり）
  src/
    aquariumData.ts              # 新規: Aquarium型・JSON読み込み+キャッシュ・Haversine・findNearestAquariums()
    ekispert.ts                  # 新規: REST薄いラッパ。findNearestStation() / searchRoute()。型・タイムアウト・失敗時undefined
    nearestAquarium.ts           # 新規: 3節のフローを組み立てるユースケース層。返り値は表示用のプレーンな結果オブジェクト
    flexMessages.ts              # 変更: buildAquariumFlexMessage() を追加
    server.ts                    # 変更: handleEvent に message.type === "location" 分岐を追加
  Makefile                       # 変更: --set-secrets に EKISPERT_API_ACCESS_KEY を追加
  env.sample                     # 変更: EKISPERT_API_ACCESS_KEY= を追記
```

**`ekispert.ts` は例外を投げない**（`geo/station` 失敗時は `undefined`、経路失敗時は `undefined` を返す）。失敗を戻り値で表すことで、7節のフォールバックを `if` だけで書ける。`server.ts` 側に try/catch の入れ子を作らない。

`nearestAquarium.ts` を分けるのは、`server.ts`（現在453行）をこれ以上太らせないため。既存の `identifyFish.ts` / `quiz.ts` と同じ粒度。

---

## 5. 返信の見た目

### 5.1 構成: characterLine 2通 + Flex カルーセル1通（計3通）

既存の写真識別フロー（`handleImageMessage`）が「カワウソの一言 + Flexカード」という形なので、それに揃える。

```
[1] characterLine("kawauso", "happy",
      "位置情報キャッチっす！ここから一番近い水族館は……")
[2] Flex carousel
      bubble 1: 最寄りの館（経路情報つき・大きめ）
      bubble 2-3: 次点候補（館名・府県・直線距離・玄関口駅のみ）
[3] characterLine("dr-jinbei", "normal", <状況に応じた一言>)
```

3通目のジンベエのセリフを**状況の説明に使う**ことで、Flex側にエラー文言を詰め込まずに済む。

| 状況 | ジンベエのセリフ（案） |
| --- | --- |
| 正常 | 「電車でひとっ走りじゃな。気をつけて行っておいで。」 |
| 100km超 | 「ふむ、ここからはだいぶ遠いのう。わしの知っとるのは関西の海だけなんじゃ。」 |
| 経路取得失敗 | 「すまんな、電車の時刻は今わからんかった。駅までの道は上に書いておいたぞ。」 |
| 最寄り駅が同じ | 「おや、もう最寄り駅におるではないか。すぐそこじゃぞ。」 |
| バス連絡が必要な館 | （Flex側の `access` 併記に任せ、セリフは正常時と同じ） |

`characterChat.ts`（Gemini生成）は**使わない**。定型の状況説明であり、生成のレイテンシ（識別フローで実測24秒の事例あり）とハルシネーションのリスクを負う理由がない。セリフは `nearestAquarium.ts` に定数として持つ。

### 5.2 Flex バブルの構造

`buildMateBubble`（`flexMessages.ts` 280行〜）の header / body / footer 構造をそのまま踏襲する。

```
header  : 背景色 #1E6FBA(海の青)、白文字で「いちばん近い水族館」/「ほかの候補」
hero    : なし ← 各館の写真は権利処理が必要。既存の公開アセットにも無い
body    : 館名（bold/lg）
          「大阪 ・ 直線 2.3km」（xs / #8A94A6）
          住所（xs, wrap）
          separator
          「🚉 大阪港駅 徒歩約9分」（sm, wrap ← マスタの access をそのまま）
          「🚃 梅田から 24分 / 乗換1回 / 280円」（sm ← 経路が取れたときのみ）
footer  : button(primary) "公式サイト" → action: { type: "uri", uri: aquarium.url }
```

- **`layout: 'baseline'` を使わない。** CLAUDE.md が記録している既知の障害（baseline直下にbox禁止、違反すると LINE API が400を返し `replyMessage` ごと落ちて返信が一切届かなくなる）を踏まない。アイコン風の表現は絵文字をテキストに含める形で済ませる
- 経路の行は取得できたときだけ `contents` に push する（取れないときは行ごと消す。「取得できませんでした」とは書かない ← その説明はジンベエのセリフが担当）
- `altText` は `いちばん近い水族館: 海遊館（直線2.3km）`
- **quickReply は付けない。** 既存の `buildExploreQuickReply(animalId)` は生きもの探索フロー専用で `animalId` を要求するため流用できない。位置情報フローは1往復で完結させる

---

## 6. 次点候補を出すか → 出す（最大3館）

出す価値があると判断する理由:

- ekispert-mcp.md が指摘するとおり、**直線距離の1位が実際の到達時間の1位とは限らない**（山・海・川を挟む、バス連絡が必要）。例えば和歌山の白浜エリアは3館が近接しており、直線1位の館より2位の館のほうが行きやすいケースが現実に起こる
- Flex カルーセルは既に `buildMatesFlexMessage` で使っている表現で、**実装コストがほぼゼロ**
- 追加のAPI呼び出しは発生しない（距離計算はローカル、経路検索は1位のみ）

ただし**経路検索は1位だけ**にする。3館ぶん `search/course/extreme` を叩くと呼び出し回数が3倍になり、直列なら replyToken の時間予算を超え、並列でもAPI課金と失敗確率が増える。「所要時間順に並べ替える」（ekispert-mcp.md の精度向上案）は**今回は採用せず**、直線距離順のまま提示して、選択はユーザーに委ねる。将来 requirements を拡張するときの候補として残す。

---

## 7. エラー処理・フォールバック

requirements.md「system SHALL いかなる失敗でもユーザーへ何らかの返信を返す」を満たすための一覧。

| 失敗 | 挙動 |
| --- | --- |
| `EKISPERT_API_ACCESS_KEY` 未設定 | API呼び出しをスキップ。経路なしで返信（起動時エラーにはしない） |
| `geo/station` がエラー/タイムアウト | 経路なしで返信 |
| 現在地の周辺に駅がない | 経路なしで返信 |
| 館の `stationCode` が null | 経路検索をスキップ、経路なしで返信 |
| 現在地の最寄り駅 = 館の最寄り駅 | 経路検索をせず、その旨をジンベエのセリフで返す |
| `search/course/extreme` がエラー/タイムアウト/0件 | 経路なしで返信 |
| マスタの読み込み失敗（ENOENT等） | 最後の砦として `characterLine` 1通でお詫びを返す。**ここだけは `handleEvent` 側の try/catch で拾う** |

「経路なしで返信」＝ **館名・府県・直線距離・住所・玄関口駅・アクセス・公式サイトURL は必ず出る**。駅すぱあとが全滅しても、requirements.md の「最寄り水族館の判定」節の受け入れ基準は全て満たされる。

---

## 8. プライバシー

- 緯度経度は `handleEvent` → `nearestAquarium.ts` → `ekispert.ts` の**引数として渡すだけ**で、Firestore には一切書かない（requirements.md の明示要件）
- **座標をログに出さない。** 現在 `server.ts` の webhook ハンドラは `console.error("Webhookイベント処理中にエラーが発生しました:", error)` と error だけを出しているので既存経路は安全だが、新規コードで `console.log(event)` / `console.error(url)` の類を書かないこと（1.4節のキー漏洩対策と同じ理由）
- 署名検証は既存の `middleware({ channelSecret })` をそのまま通る（location も同じ `/webhook` に来る）ので追加対応は不要

---

## 9. 影響範囲と非互換

- `server.ts` への変更は `handleEvent` に `if (message.type === "location")` 分岐を1つ足すだけ。`text` / `image` / `postback` の既存経路には触れない（requirements.md「既存の挙動を変えない」）
- 現状 location は末尾の `"画像かテキストを送ってね"` に落ちているので、**この分岐は既存の到達可能な挙動を1つ置き換える**（これは意図した変更）
- 新規依存パッケージなし（`fetch` は Node 標準）

---

## 10. 承認後の進め方（tasks.md の骨子。本designの承認前には作らない）

1. 駅すぱあと 90日無料評価版キーを発行し、`geo/station` と `search/course/extreme` の疎通・レスポンス実形を確認（**1.5節の未検証事項5点をここで潰す。結果次第で本designを修正する**）
2. Secret Manager 登録 / Makefile / env.sample
3. 15館の住所を公式サイトで再確認 → `kansai-aquariums.json` 作成 → 駅コード焼き込み
4. `aquariumData.ts`（Haversine・キャッシュ）
5. `ekispert.ts`（2関数・タイムアウト・失敗時undefined）
6. `nearestAquarium.ts`（フロー＋セリフ）
7. `flexMessages.ts` にバブル追加
8. `server.ts` に location 分岐
9. 実機で位置情報を送って確認（大阪市内 / 白浜 / 東京＝100km超 / キー未設定時のフォールバック）
