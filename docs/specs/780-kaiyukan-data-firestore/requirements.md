Issue: https://github.com/4geru/tweet-bookmark/issues/780

# 要件定義: 海遊館マスタデータのFirestore保存

## 背景・スコープ

現状、海遊館の生きものマスタデータ（243種、`animal.json` 等）は `backend/scripts/fetch-kaiyukan-data.ts` で取得し、`backend/data/kaiyukan-animals.json` というローカル静的ファイルに保存、`backend/src/kaiyukanData.ts` がそれをそのまま読み込んで使っている（調査メモ: [aquarium-open-data.md](../../research/aquarium-open-data.md)）。

本specは、このマスタデータを **Firestore に保存する** ことをスコープとする。#779 design.md 1章で設計済みの `users/{lineUserId}` 配下（ユーザーごとの状態）とは別の、**アプリ全体で共有するマスタデータ**の置き場所を定義する。

対象データ:
- `animal.json`（243件: 名前/学名/英名/説明/画像/展示エリア等）

対象外（本specでは扱わない）:
- `classification.json` / `exhibition.json` のFirestore投入（design.md「スコープの絞り込み」参照。ローカルに未取得・現行コードから未参照のため別issueで対応）
- 案内板写真から抽出した情報とのマージ（#780の別タスク、#779 requirements.md「対話学習」節）
- スペシャリティクイズJSON・カードイラストの生成（#780の別タスク）
- ユーザーごとのコレクション・クイズ状態（#779 design.md 1章で設計済み）

## 受け入れ基準（EARS形式）

### データ投入

- WHEN 開発者が投入スクリプトを実行する THEN system SHALL `backend/data/kaiyukan-animals.json` の各レコードを `animalMaster` コレクション配下に `animalMaster/{id}` として1件1ドキュメントで書き込む
- WHEN 投入スクリプトが同じデータで複数回実行される THEN system SHALL 重複ドキュメントを作らず、既存ドキュメントを上書き（upsert）する
- IF 投入対象のJSONに `id` を持たない、または `id` が重複するレコードが含まれる THEN system SHALL エラーとして処理を中断し、どのレコードが原因かを出力する

### 読み込み経路

- WHEN バックエンドが生きものマスタデータを参照する（`findAnimalById` 等の既存呼び出し元） THEN system SHALL Firestoreから取得したデータを返す
- system SHALL 既存の `KaiyukanAnimal` 型・`findAnimalById` 等の関数シグネチャを変更しない（呼び出し元コードの修正を不要にする）

### 運用・整合性

- WHEN 海遊館公式JSONの再取得（`fetch-kaiyukan-data.ts`）で内容が更新される THEN system SHALL 再投入によりFirestore側にも反映できる
- system SHALL Firestoreへの書き込み・読み込み処理で認証情報（サービスアカウント等）をリポジトリにコミットしない

## 決定事項（design.mdで確定）

- Firestoreのコレクション/ドキュメント構造: `animalMaster` コレクション、1種=1ドキュメント（`animalMaster/{id}`）
- キャッシュ方針: 既存の `loadKaiyukanAnimals` と同じくプロセス内インメモリキャッシュを維持（初回アクセス時のみFirestore読み込み）
- ローカルJSONファイル（`backend/data/kaiyukan-animals.json`）は投入スクリプトの入力として残す。ランタイムはFirestoreのみを読み、Dockerイメージには含めない
- 認証方法: サービスアカウントキーは発行せず、Cloud Run実行時のADC / ローカル開発時の `gcloud auth application-default login` によるADCを使用

## 未確定事項（設計フェーズで詰める）

（design.mdで解消済み。design.md末尾「未確定事項」参照: セキュリティルール設計は#785側で別途検討）
