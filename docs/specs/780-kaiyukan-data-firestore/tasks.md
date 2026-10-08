Issue: https://github.com/4geru/tweet-bookmark/issues/780

# タスク: 海遊館マスタデータのFirestore保存

- [x] 1. 依存関係の追加: `backend/package.json` の `dependencies` に `firebase-admin` を追加し、`npm install`
- [x] 2. `backend/src/firestore.ts` を新規作成: `firebase-admin/app` の `initializeApp`（ADC、`projectId: process.env.GOOGLE_CLOUD_PROJECT`）と `firebase-admin/firestore` の `getFirestore()` をエクスポート
- [x] 3. ローカル `.env` に `GOOGLE_CLOUD_PROJECT=kaiyukan-gacha-hackathon` を追記（コミットしない。`.env.example` があれば併せてキーだけ追記）
- [x] 4. `backend/scripts/seed-animal-master.ts` を新規作成: `data/kaiyukan-animals.json` を読み込み、`id` の欠落・重複をチェックしてエラー時は中断、Firestore `WriteBatch` で `animalMaster/{id}` に `set()`（upsert）
- [x] 5. `backend/package.json` の `scripts` に `"seed:animal-master": "tsx scripts/seed-animal-master.ts"` を追加
- [x] 6. `npm run seed:animal-master` を実行し、Firestore `animalMaster` コレクションに243件投入されることを確認（Firebase Consoleまたは`gcloud firestore`で件数確認）
- [x] 7. `backend/src/kaiyukanData.ts` の `loadKaiyukanAnimals()` を、ローカルファイル読み込みから `db.collection("animalMaster").get()` に差し替え（`{ id: doc.id, ...doc.data() }` で組み立て、キャッシュ方式は維持）。`KaiyukanAnimal` 型・`findAnimalById` のシグネチャは変更しない
- [x] 8. ~~`backend/Dockerfile` から `COPY --chown=10001:10001 data ./data` を削除~~ → 見送り。ランタイムはFirestoreのみを読むため本specの観点では不要だが、他の理由でこのCOPYが必要とのことなので変更しない
- [x] 9. 動作確認: `findAnimalById` がFirestore経由で正しく動くことを確認済み（`npm run dev` でのサーバー起動確認は未実施。LINE Webhook関連の環境変数が必要なため対象外とし、データ層の動作確認をもって完了とする）
- [x] 10. `npm run typecheck` を実行し型エラーがないことを確認
