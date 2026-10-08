import { Timestamp } from "firebase-admin/firestore";
import { messagingApi } from "@line/bot-sdk";
import { db } from "../src/firestore.js";
import { findAnimalById } from "../src/kaiyukanData.js";
import { QUIZ_PROMPT_VERSION, planQuizCategory, type QuizCategory, type QuizHistoryEntry } from "../src/quiz.js";
import { QUIZ_POOL_VERSION, findPoolCandidates, getQuizPool, hasPool, toAgentCandidates } from "../src/quizPool.js";
import { filterCategoriesForLevel, normalizeProfile, ruleLevel, shouldKeepLevel, type LevelDecision } from "../src/quizLevel.js";
import { buildQuizFlexMessage } from "../src/flexMessages.js";
import { characterLine } from "../src/characters.js";

// 本番Botに作り置きのクイズを1問pushする（server.ts handleStartQuiz の pool 経路を再現。LLMは使わない）。
// 使い方: LINE_CHANNEL_ACCESS_TOKEN=... GOOGLE_CLOUD_PROJECT=... npx tsx scripts/push-pool-quiz.ts [animalId=48]
const animalId = process.argv[2] ?? "48";
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が必要です");

const users = await db.collection("users").select().get();
if (users.size !== 1) {
  console.error(`users が ${users.size} 件のため中止します`);
  process.exit(1);
}
const userId = users.docs[0].id;
console.log(`宛先: ...${userId.slice(-4)}`);

const animal = await findAnimalById(animalId);
const pool = await getQuizPool();
if (!animal || !hasPool(pool, animalId)) throw new Error(`animalId ${animalId} の作り置きがありません`);

// server.ts getRecentQuizHistory / loadPoolContext / getQuizProfile と同じ読み取り
const userRef = db.doc(`users/${userId}`);
const histCol = db.collection(`users/${userId}/animals/${animalId}/quizHistory`);
const [recentSnap, askedSnap, userSnap] = await Promise.all([
  histCol.orderBy("askedAt", "desc").limit(5).get(),
  histCol.where("generatedBy", "==", "pool").select("poolId").get(),
  userRef.get(),
]);
const recent: QuizHistoryEntry[] = recentSnap.docs.map((d) => ({ category: d.data().category as QuizCategory, isCorrect: d.data().isCorrect === true }));
const askedPoolIds = new Set<string>(askedSnap.docs.map((d) => d.data().poolId).filter((x): x is string => typeof x === "string"));
const rawProfile = userSnap.data()?.quizProfile as { recent?: unknown[] } | undefined;
const profile = normalizeProfile(
  rawProfile && Array.isArray(rawProfile.recent)
    ? { ...rawProfile, recent: rawProfile.recent.map((e) => { const x = e as { at?: unknown }; return x?.at instanceof Timestamp ? { ...x, at: x.at.toDate() } : e; }) }
    : rawProfile,
);

// レベル決定は規則のみ（decideQuizLevel のエージェントは呼ばない。据え置き or ruleLevel）
const from = profile.level;
const rule = shouldKeepLevel(profile) ? { to: from, reason: "新しい回答がないので据え置き" } : ruleLevel(profile);
const decision: LevelDecision = {
  from, to: rule.to, direction: rule.to > from ? "up" : rule.to < from ? "down" : "keep", reason: rule.reason,
  decidedBy: "rule", fallbackCause: shouldKeepLevel(profile) ? "no_new_answers" : null, proposed: null, clamped: false, guard: null,
  basis: [], ruleTo: rule.to, answeredCountAtDecision: profile.answeredCount, latencyMs: 0, model: null, promptVersion: "push-pool-quiz-script",
};
const level = decision.to;

const plan = planQuizCategory(recent);
const candidates = plan.kind === "retry" ? [plan.category] : plan.candidates;
const found = findPoolCandidates({
  pool, animalId, plan, level,
  allowed: plan.kind === "retry" ? [plan.category] : filterCategoriesForLevel(candidates, level),
  askedPoolIds,
});
if (found.candidates.length === 0) throw new Error(`候補なし: ${found.missReason}`);
const chosen = found.candidates[Math.floor(Math.random() * found.candidates.length)];

// server.ts savePendingQuiz と同じ形
const askedAt = Timestamp.now();
const answerToken = askedAt.toMillis();
const batch = db.batch();
batch.set(db.doc(`users/${userId}/pendingQuiz/${animalId}`), {
  animalId, category: chosen.category, question: chosen.question, choices: [...chosen.choices], correctIndex: chosen.correctIndex,
  speakerPersona: chosen.category === "ダジャレ" ? "ジンベエ名誉教授" : null,
  selectionReason: "push-pool-quiz スクリプトによる手動出題", consideredCategories: toAgentCandidates(found.candidates),
  runId: null, guard: null, poolId: chosen.id, consideredPoolIds: found.candidates.map((q) => q.id), selectedBy: "rule",
  poolExplanation: chosen.explanation, askedAt, level, generatedBy: "pool", promptVersion: QUIZ_POOL_VERSION || QUIZ_PROMPT_VERSION,
  levelDecision: decision, attempt: 1, answerToken, prevAnswerToken: null, retryStartedAt: null, eliminatedIndex: null,
  hint: null, hintSource: null, hintRejectReason: null, explanation: null,
});
batch.set(userRef, {
  quizProfile: {
    level, lastLevelDecision: { ...decision, at: askedAt },
    ...(decision.to !== decision.from ? { lastChangeDirection: decision.direction === "down" ? "down" : "up", levelChangedAtCount: profile.answeredCount } : {}),
    updatedAt: askedAt,
  },
}, { merge: true });
await batch.commit();

const line = new messagingApi.MessagingApiClient({ channelAccessToken: token });
await line.pushMessage({
  to: userId,
  messages: [
    characterLine("kawauso", "happy", "お待たせっす！クイズができたっすよ！"),
    buildQuizFlexMessage({
      animalId, category: chosen.category, question: chosen.question, choices: [...chosen.choices], correctIndex: chosen.correctIndex,
      speakerPersona: chosen.category === "ダジャレ" ? "ジンベエ名誉教授" : undefined, referencesWikipedia: Boolean(animal.wikipedia), level,
    }, answerToken),
  ],
});
console.log(JSON.stringify({ animalId, animal: animal.name, category: chosen.category, level, poolId: chosen.id, question: chosen.question }));
