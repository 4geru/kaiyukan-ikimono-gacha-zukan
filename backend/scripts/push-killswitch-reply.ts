// 停止スイッチ（config/runtime の disabledAgents に station）が効いているときに駅の質問へ返す返事を、
// 見た目確認のため Firestore の users が1人のときだけその人に1回 push する（本番の設定は書き換えない）。
// 文面と送り主は server.ts の駅の停止分岐（maintenance(...)）と同じ。
// 使い方: LINE_CHANNEL_ACCESS_TOKEN=... GOOGLE_CLOUD_PROJECT=... npx tsx scripts/push-killswitch-reply.ts
import { messagingApi } from "@line/bot-sdk";
import { characterLine } from "../src/characters.js";
import { db } from "../src/firestore.js";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が必要です");

const users = await db.collection("users").select().get();
if (users.size !== 1 || !users.docs[0].id.endsWith("6b85")) {
  console.error(`users が1人（末尾6b85）ではないため中止します（${users.size}件）`);
  process.exit(1);
}
const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
await client.pushMessage({
  to: users.docs[0].id,
  messages: [characterLine("dr-jinbei", "think", "今は調査隊がお休み中じゃ。しばらくしてからまた聞いておくれ。")],
});
console.log("push 完了（1回）");
