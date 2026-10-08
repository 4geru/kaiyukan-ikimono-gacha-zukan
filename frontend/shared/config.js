// 環境依存の設定値を1箇所に集約する（design.md 1節 Fableレビュー対応: CDNバージョンの分散を防ぐ）。
// FIREBASE_CONFIG は 2026-09-19、gcloud alpha firebase apps create --platform=web で
// kaiyukan-gacha-hackathonプロジェクトにFirebase Web Appを登録し、実値を取得済み
// (Firebase WebのAPIキーはクライアント埋め込み前提の公開識別子であり、秘匿情報ではない。
// アクセス制御はFirestoreセキュリティルール側で行う。そのルール自体は引き続き#785の前提条件)。
// ローカル動作確認は shared/liff-client.js の ?debugUserId= を使う（liff.init を通らない）。

export const CDN_VERSIONS = {
  firebase: "10.14.1",
  liffSdk: "2", // https://static.line-scdn.net/liff/edge/{liffSdk}/sdk.js
};

// LINE MINI App の LIFF ID（URL: https://miniapp.line.me/{LIFF_ID}）。内部チャネルごとに別のIDなので、
// 配信ホスト（Firebase Hostingのサイト）で切り替える。どちらでもないホスト（localhost等）はPublished扱い。
// Review用は審査を出さない限り不要。
const LIFF_IDS = {
  "kaiyukan-gacha-dev.web.app": "2011666396-dgz7LpbK", // Developing
  "kaiyukan-gacha-hackathon.web.app": "2011666398-2s9KLmu9", // Published
};
export const LIFF_ID = LIFF_IDS[location.hostname] || LIFF_IDS["kaiyukan-gacha-hackathon.web.app"];

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBwfVLqr2bO0bn1XoaL7kbOSaBOOkchgZ8",
  authDomain: "kaiyukan-gacha-hackathon.firebaseapp.com",
  projectId: "kaiyukan-gacha-hackathon",
  storageBucket: "kaiyukan-gacha-hackathon.firebasestorage.app",
  messagingSenderId: "904272649235",
  appId: "1:904272649235:web:0aebc631d8f49399bb33e6",
};

// LIFFのIDトークンを渡してFirebaseカスタムトークンを受け取るバックエンド（Cloud Run。docs/specs/785-liff-firebase-auth）
export const AUTH_API_URL = "https://kaiyukan-gacha-bot-v7dfmi7bla-an.a.run.app/auth/line";

export const ANIMALS_MANIFEST_URL =
  "https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/gacha-demo/animals-manifest.js";
