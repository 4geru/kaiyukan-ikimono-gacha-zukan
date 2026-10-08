// pendingQuiz書き込み→読み取り→トランザクションでの削除、という一連の流れを
// ダミーのuserId/animalIdで実際にFirestoreへ疎通確認する。
// 実行: npx tsx scripts/try-firestore.ts
import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../src/firestore.js";

async function main(): Promise<void> {
  const userId = "test-user-try-firestore";
  const animalId = "48";

  const pendingRef = db.doc(`users/${userId}/pendingQuiz/${animalId}`);
  const collectionRef = db.doc(`users/${userId}/collection/${animalId}`);

  console.log("1. pendingQuizを書き込み...");
  await pendingRef.set({
    animalId,
    question: "テスト問題？",
    choices: ["A", "B", "C"],
    correctIndex: 1,
    askedAt: Timestamp.now(),
  });

  console.log("2. 読み取り確認...");
  const snap = await pendingRef.get();
  console.log("   exists:", snap.exists, "data:", JSON.stringify(snap.data()));

  console.log("3. トランザクションで削除＋collection作成...");
  const result = await db.runTransaction(async (tx) => {
    const pendingSnap = await tx.get(pendingRef);
    if (!pendingSnap.exists) return undefined;
    const quiz = pendingSnap.data() as { correctIndex: number; choices: string[] };
    tx.delete(pendingRef);
    tx.set(collectionRef, {
      name: "テスト生物",
      firstFoundAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      rarity: "unknown",
      knowledgeUnlocked: {},
      completed: false,
    });
    return { correctChoice: quiz.choices[quiz.correctIndex] };
  });
  console.log("   transaction result:", JSON.stringify(result));

  console.log("4. pendingQuizが消え、collectionができたことを確認...");
  const afterPending = await pendingRef.get();
  const afterCollection = await collectionRef.get();
  console.log("   pendingQuiz.exists:", afterPending.exists, "(false が正しい)");
  console.log("   collection.exists:", afterCollection.exists, "(true が正しい)");

  console.log("5. 後片付け（テストデータ削除）...");
  await collectionRef.delete();

  console.log("完了: すべて期待通りなら成功です。");
}

main().catch((error) => {
  console.error("ERROR", error);
  process.exitCode = 1;
});
