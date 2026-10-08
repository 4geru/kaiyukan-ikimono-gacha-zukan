// Firestoreセキュリティルールと /auth/line を実環境で検証する（エミュレータ不要）。
// docs/specs/785-liff-firebase-auth/design.md 5節。使い方: node scripts/verify-auth-rules.mjs
//
// 1. gcloudのユーザー資格情報で firebase-adminsdk サービスアカウントとして署名し、テスト用uidのカスタムトークンを作る
// 2. Identity Toolkit REST でIDトークンに交換し、Firestore REST にそのIDトークンで問い合わせる
// テスト用ドキュメントは users/test-owner/ 以下にだけ作り、終了時に削除する（実ユーザーのデータは触らない）。
import { execSync } from "node:child_process";

const PROJECT = "kaiyukan-gacha-hackathon";
const SIGNER = `firebase-adminsdk-fbsvc@${PROJECT}.iam.gserviceaccount.com`;
const WEB_API_KEY = "AIzaSyBwfVLqr2bO0bn1XoaL7kbOSaBOOkchgZ8"; // 公開識別子（frontend/shared/config.js と同じ）
const AUTH_API = process.env.AUTH_API || "https://kaiyukan-gacha-bot-v7dfmi7bla-an.a.run.app/auth/line";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const adminToken = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const b64url = (input) => Buffer.from(input).toString("base64url");

async function mintCustomToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: SIGNER,
    sub: SIGNER,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SIGNER}:signBlob`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ payload: Buffer.from(unsigned).toString("base64") }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signBlob失敗: ${JSON.stringify(body.error)}`);
  return `${unsigned}.${Buffer.from(body.signedBlob, "base64").toString("base64url")}`;
}

async function idTokenFor(uid) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: await mintCustomToken(uid), returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signInWithCustomToken失敗: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

const call = (token, method, path, body) =>
  fetch(`${DOCS}/${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

// 管理者権限（ルールの対象外）でテストデータを作る／消す
const seed = async () => {
  for (const [path, fields] of [
    // docs/specs/829-quiz-difficulty-hint: quizProfile（正解を含まない学習状況）入りの users ドキュメント
    ["users/test-owner", { fishDoctorRank: { stringValue: "テスト" }, quizProfile: { mapValue: { fields: { level: { integerValue: "2" }, answeredCount: { integerValue: "0" } } } } }],
    ["users/test-owner/collection/1", { name: { stringValue: "テスト魚" } }],
    // 829: ヒント・解説（正解を含む）入り。本人も読めない
    ["users/test-owner/pendingQuiz/1", { correctIndex: { integerValue: "0" }, explanation: { stringValue: "テスト解説" }, hint: { stringValue: "テストヒント" } }],
    // docs/specs/791-quiz-history: 回答済みの出題履歴
    ["users/test-owner/animals/1/quizHistory/1", { category: { stringValue: "水温" }, question: { stringValue: "テスト問題" }, isCorrect: { booleanValue: true } }],
    // #832: 駅の水族館エージェントの判断の記録（本人だけが読める）
    ["users/test-owner/agentRuns/r1", { agent: { stringValue: "station" }, outcome: { stringValue: "ok" } }],
  ]) {
    const res = await call(adminToken, "PATCH", path, { fields });
    if (!res.ok) throw new Error(`seed失敗 ${path}: ${res.status}`);
  }
};
const cleanup = () =>
  Promise.all(
    ["users/test-owner/collection/1", "users/test-owner/pendingQuiz/1", "users/test-owner/animals/1/quizHistory/1", "users/test-owner/agentRuns/r1", "users/test-owner"].map((p) =>
      call(adminToken, "DELETE", p),
    ),
  );

let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label.padEnd(52)} → ${actual}（期待 ${expected}）`);
};

try {
  await seed();
  const [owner, other] = await Promise.all([idTokenFor("test-owner"), idTokenFor("test-other")]);

  check("認証なしで自分以外のcollectionをlist", (await call(null, "GET", "users/test-owner/collection")).status, 403);
  check("test-otherがtest-ownerのcollectionをlist", (await call(other, "GET", "users/test-owner/collection")).status, 403);
  check("test-otherがtest-ownerのcollection/1をget", (await call(other, "GET", "users/test-owner/collection/1")).status, 403);
  check("test-ownerが自分のusersドキュメントをget", (await call(owner, "GET", "users/test-owner")).status, 200);
  check("829: test-otherがtest-ownerのusers(quizProfile入り)をget", (await call(other, "GET", "users/test-owner")).status, 403);
  check("829: test-ownerが自分のpendingQuiz/1(explanation入り)をget", (await call(owner, "GET", "users/test-owner/pendingQuiz/1")).status, 403);
  check("test-ownerが自分のcollectionをlist", (await call(owner, "GET", "users/test-owner/collection")).status, 200);
  check("test-ownerが自分のcollection/1をget", (await call(owner, "GET", "users/test-owner/collection/1")).status, 200);
  check("test-ownerが自分のpendingQuiz/1をget", (await call(owner, "GET", "users/test-owner/pendingQuiz/1")).status, 403);
  check("test-ownerが自分のpendingQuizをlist", (await call(owner, "GET", "users/test-owner/pendingQuiz")).status, 403);
  check("test-ownerが自分のcollection/1に書き込み", (await call(owner, "PATCH", "users/test-owner/collection/1", { fields: { name: { stringValue: "x" } } })).status, 403);
  check("test-otherがtest-ownerのquizHistoryをlist", (await call(other, "GET", "users/test-owner/animals/1/quizHistory")).status, 403);
  check("test-otherがtest-ownerのquizHistory/1をget", (await call(other, "GET", "users/test-owner/animals/1/quizHistory/1")).status, 403);
  check("test-ownerが自分のquizHistoryをlist", (await call(owner, "GET", "users/test-owner/animals/1/quizHistory")).status, 200);
  check("test-ownerが自分のquizHistory/1をget", (await call(owner, "GET", "users/test-owner/animals/1/quizHistory/1")).status, 200);
  check("test-ownerが自分のquizHistory/1に書き込み", (await call(owner, "PATCH", "users/test-owner/animals/1/quizHistory/1", { fields: { isCorrect: { booleanValue: false } } })).status, 403);
  check("832: test-ownerが自分のagentRuns/r1をget", (await call(owner, "GET", "users/test-owner/agentRuns/r1")).status, 200);
  check("832: test-ownerが自分のagentRunsをlist", (await call(owner, "GET", "users/test-owner/agentRuns")).status, 200);
  check("832: test-otherがtest-ownerのagentRuns/r1をget", (await call(other, "GET", "users/test-owner/agentRuns/r1")).status, 403);
  check("832: test-ownerが自分のagentRuns/r1に書き込み", (await call(owner, "PATCH", "users/test-owner/agentRuns/r1", { fields: { outcome: { stringValue: "x" } } })).status, 403);
  check("832: test-ownerがconfig/runtime(停止スイッチ)をget", (await call(owner, "GET", "config/runtime")).status, 403);
  check("832: test-ownerがwebhookEvents/xをget", (await call(owner, "GET", "webhookEvents/x")).status, 403);
  check("test-ownerがusers全体をlist",(await call(owner, "GET", "users")).status, 403);
  check("test-ownerがanimalMasterをget", (await call(owner, "GET", "animalMaster/1")).status, 403);

  const authPost = (body) => fetch(AUTH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  check("/auth/line ボディなし", (await authPost({})).status, 400);
  const fakeJwt = `${b64url("{}")}.${b64url(JSON.stringify({ aud: "999" }))}.x`;
  check("/auth/line 許可外のaud", (await authPost({ idToken: fakeJwt })).status, 401);
} finally {
  await cleanup();
}

console.log(failed === 0 ? "\n全ケース期待どおり" : `\n${failed}件が期待と異なります`);
process.exit(failed === 0 ? 0 : 1);
