Issue: https://github.com/4geru/tweet-bookmark/issues/780

# 設計: 海遊館マスタデータのFirestore保存

requirements.md の受け入れ基準を満たすための設計。

## スコープの絞り込み（requirements.mdからの変更）

requirements.mdの対象データには `classification.json` / `exhibition.json` も含めていたが、現時点で以下の理由によりこの design では **animal.json（`animalMaster`）のみ** を対象とする。

- `classification.json` / `exhibition.json` はローカルにまだ存在せず（`fetch-kaiyukan-data.ts` は `animal.json` しか取得していない）、取得スクリプトの拡張が別途必要
- 現行バックエンドコード（`kaiyukanData.ts` 等）はこの2つを一切参照していない（未使用データを今取り込む理由がない）
- 必要になった時点で `animalMaster` と同じ投入スクリプトのパターンをそのまま横展開できる

このため、requirements.md の「対象外」節に「classification.json / exhibition.json のFirestore投入（別issueで対応）」を追記する（design承認時にrequirements.mdを更新する）。

## Firestore基盤

- GCPプロジェクト: `kaiyukan-gacha-hackathon`
- データベース: `(default)`、Native mode、リージョン `asia-northeast2`（作成済み）
- 使用パッケージ: `firebase-admin`（Admin SDK）を新規依存として追加。Cloud Run / Node.js バックエンドからの利用に標準的で、`@google/adk` が依存する `@google-cloud/storage` と同じ思想のGoogle公式SDK

### 認証方針

- **Cloud Run実行時**: サービスアカウントキーは発行・配布しない。Cloud Runにアタッチされたランタイムサービスアカウントの Application Default Credentials (ADC) をそのまま使う。`initializeApp()` を引数なしで呼べばADCが自動的に使われる
- **ローカル開発・投入スクリプト実行時**: `gcloud auth application-default login`（既にこのマシンでは `westhouse51@gmail.com` として認証済み）で発行されるADCを使う。サービスアカウントキーのJSONファイルは作らない・リポジトリに置かない
- プロジェクトIDは `GOOGLE_CLOUD_PROJECT` 環境変数で明示指定する（Cloud Runは自動設定、ローカルは `.env` に追記して`dotenv`経由で読む。`.env` は既にgitignore対象）

## データモデル

`animalMaster` コレクション、1種 = 1ドキュメント（ドキュメントID = 海遊館公式JSONの `id`）。

```
animalMaster/{id}
  name: string
  englishName: string
  scientificName: string
  description: string
  img: string
  family: string
  classification: string
  mainExhibition: string
  subExhibition: string
  exhibitionStatus: string
  tag: string
```

`id` はドキュメントIDとして使い、フィールドとしては重複して持たせない（Firestoreの `doc.id` から復元する）。既存の `KaiyukanAnimal` 型定義（`id`フィールドを含む）はそのまま維持し、Firestoreからの読み込み時に `{ id: doc.id, ...doc.data() }` で組み立てる。

## ファイル構成・処理フロー

```
backend/
  scripts/
    fetch-kaiyukan-data.ts      # 既存: 海遊館サイト → data/kaiyukan-animals.json（変更なし）
    seed-animal-master.ts       # 新規: data/kaiyukan-animals.json → Firestore animalMaster
  src/
    firestore.ts                # 新規: firebase-admin初期化・Firestoreインスタンスのエクスポート
    kaiyukanData.ts              # 変更: ローカルファイル読み込み → Firestore読み込みに差し替え
  data/
    kaiyukan-animals.json        # 既存のまま残す（seedスクリプトの入力。ランタイムはもう読まない）
```

### `src/firestore.ts`（新規）

```ts
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
}

export const db = getFirestore();
```

### `scripts/seed-animal-master.ts`（新規）

- `data/kaiyukan-animals.json` を読み込み、各レコードの `id` の重複・欠落をチェック（重複/欠落があればエラーで中断、requirements.md「データ投入」節）
- Firestore `WriteBatch` で `animalMaster/{id}` に `set()`（=upsert。既存ドキュメントは上書き、新規は作成）
- 243件は Firestore バッチ上限（500件）に収まるため単一バッチで実行
- 実行コマンド: `npm run seed:animal-master`（`package.json` に追加）

### `src/kaiyukanData.ts`（変更）

- `loadKaiyukanAnimals()`: ローカルファイル読み込みを `db.collection("animalMaster").get()` に差し替え、`snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))` でキャッシュに載せる
- キャッシュ方式（`Promise<KaiyukanAnimal[]>` をモジュール変数に保持）は現状のまま維持。プロセス起動中は初回アクセス時の1回だけFirestoreを読みにいく
- `findAnimalById(id)`: 実装は変更しない（`loadKaiyukanAnimals()` → `.find()`）。キャッシュがある限り追加のFirestore読み込みは発生しない
- `KaiyukanAnimal` 型・エクスポートする関数シグネチャは変更なし（呼び出し元の `identifyFish.ts` 等は無修正で動く）

## Dockerfile・依存関係の変更

- `package.json` の `dependencies` に `firebase-admin` を追加
- `package.json` の `scripts` に `"seed:animal-master": "tsx scripts/seed-animal-master.ts"` を追加
- `Dockerfile` の `COPY --chown=10001:10001 data ./data` は、ランタイムが `data/kaiyukan-animals.json` を読まなくなるため削除する（イメージサイズ削減。seedはローカル/CI手動実行のみでCloud Runイメージには含めない）

## エラーハンドリング

- Firestore接続・読み込みに失敗した場合、`loadKaiyukanAnimals()` の呼び出し元（識別フロー等）にエラーをそのまま伝播させる（新規のフォールバック処理・リトライは追加しない。既存コードが元々ローカルファイル読み込み失敗時に例外を投げていたのと同じ扱い）

## 未確定事項（この design では決めきらない）

- Firestoreセキュリティルール: `animalMaster` はバックエンド（Admin SDK）からのみ読み書きする想定で、クライアント（LIFF）から直接読ませる設計にはなっていない。LIFF側が将来 `animalMaster` を直接参照する要件が出た場合は別途ルール設計が必要（#779 design.mdのセキュリティルール未確定事項と合わせて#785側で検討）
- `classification.json` / `exhibition.json` の取り込み（本designではスコープ外。上記「スコープの絞り込み」参照）
