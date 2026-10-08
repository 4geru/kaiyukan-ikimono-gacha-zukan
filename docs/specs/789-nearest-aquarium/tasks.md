Issue: https://github.com/4geru/tweet-bookmark/issues/789

# タスク: LINE位置情報から最寄りの水族館を返す

[requirements.md](requirements.md) / [design.md](design.md) 承認済み。design.md 10節の骨子を実装可能な粒度に分解した。

## 1. 駅すぱあとAPIの疎通確認

- [x] 90日無料評価版キーを発行し `backend/.env` の `EKISPERT_API_ACCESS_KEY` に設定
- [x] `GET /v1/json/geo/station` の疎通・レスポンス実形を確認（design.md 1.5節）
- [x] `GET /v1/json/search/course/extreme` の疎通・所要時間の合算式を確認（design.md 1.5節: 3要素合算）

## 2. キーの受け渡し経路

- [x] `backend/env.sample` に `EKISPERT_API_ACCESS_KEY=` を追記（値は空）
- [x] `backend/Makefile` の `deploy` の `--set-secrets` に `EKISPERT_API_ACCESS_KEY=EKISPERT_API_ACCESS_KEY:latest` を追記
- [ ] Secret Manager への登録（ユーザー作業。`gcloud secrets create` はこのタスクでは実行しない）

## 3. 水族館マスタ

- [x] 15館の住所を公式サイトで再確認する（kansai-aquariums.md「マスタ化するときは全館の住所を公式サイトで再確認すること」）
- [x] `backend/data/kansai-aquariums.json` を作成（design.md 2.2節のスキーマ。`stationCode` は一旦 `null`）
- [x] `backend/scripts/fetch-aquarium-station-codes.ts` を作成（`GET /v1/json/station?name={駅名}&gcs=wgs84`、`Type: "train"` を選ぶ）
- [x] スクリプトを実行して `kansai-aquariums.json` の `stationCode` を埋める

## 4. アプリケーション実装

- [x] `backend/src/aquariumData.ts`: `Aquarium` 型・JSON読み込み+キャッシュ・Haversine・`findNearestAquariums(lat, lng, limit)`
- [x] `backend/src/ekispert.ts`: `findNearestStation()` / `searchRoute()`。例外を投げない（失敗時 `undefined`）・`AbortSignal.timeout(3500)`・リトライなし・`toArray()` 正規化・キーをログに出さない
- [x] `backend/src/nearestAquarium.ts`: design.md 3節のフロー＋5.1節の状況別セリフ
- [x] `backend/src/flexMessages.ts`: `buildAquariumFlexMessage()` を追加（design.md 5.2節。`layout: 'baseline'` を使わない）
- [x] `backend/src/server.ts`: `handleEvent` に `message.type === "location"` 分岐を追加（既存の text/image/postback 経路は変更しない）

## 5. 検証

- [x] `npm run typecheck` が通る
- [ ] 実機で位置情報を送って確認（大阪市内 / 白浜 / 東京＝100km超 / キー未設定時のフォールバック）※ユーザー作業
