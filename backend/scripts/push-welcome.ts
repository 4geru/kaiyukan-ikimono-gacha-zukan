// ウェルカムメッセージのプレビューを、Firestore の users が1人のときだけその人に1回 push する。
// 使い方: LINE_CHANNEL_ACCESS_TOKEN=... GOOGLE_CLOUD_PROJECT=... npx tsx scripts/push-welcome.ts
import { messagingApi } from "@line/bot-sdk";
import { db } from "../src/firestore.js";
import { buildWelcomeMessages } from "../src/welcomeMessage.js";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が必要です");

const users = await db.collection("users").select().get();
if (users.size !== 1 || !users.docs[0].id.endsWith("6b85")) {
  console.error(`users が1人（末尾6b85）ではないため中止します（${users.size}件）`);
  process.exit(1);
}
const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
await client.pushMessage({ to: users.docs[0].id, messages: buildWelcomeMessages() });
console.log("push 完了（1回）");
