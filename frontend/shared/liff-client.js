// LIFF初期化とユーザー識別をラップする共通モジュール。
// ?debugUserId= はローカル動作確認専用で、localhost / 127.0.0.1 でだけ有効にする
// （公開ホストでは無視して通常のLIFF経由にする。docs/specs/785-liff-firebase-auth/design.md 3.1節）。
import { LIFF_ID } from "./config.js";

let currentUserPromise;

// #837: LINE アカウントなしで図鑑を見せるデモ。?demo=1 で開くと、以降のページ（カード詳細など）もデモのまま。
export const DEMO_USER_ID = "demo-zukan";
const DEMO_KEY = "zukanDemo";

export function isDemo() {
  try {
    if (new URLSearchParams(location.search).get("demo") === "1") {
      sessionStorage.setItem(DEMO_KEY, "1");
      return true;
    }
    return sessionStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return new URLSearchParams(location.search).get("demo") === "1";
  }
}

function showDemoBanner() {
  if (typeof document === "undefined" || document.getElementById("demo-banner")) return;
  const bar = document.createElement("div");
  bar.id = "demo-banner";
  bar.textContent = "デモ表示中（LINE なしで見られる見本の図鑑です）";
  bar.style.cssText =
    "position:sticky;top:0;z-index:1000;padding:8px 12px;background:#FF7A59;color:#fff;font-weight:700;font-size:14px;text-align:center;";
  document.body.prepend(bar);
}

function isLocalHost() {
  return ["localhost", "127.0.0.1"].includes(location.hostname);
}

function getDebugUserId() {
  if (!isLocalHost()) return null;
  const params = new URLSearchParams(location.search);
  return params.get("debugUserId");
}

async function resolveViaLiff() {
  if (typeof liff === "undefined") {
    throw new Error(
      "LIFF SDKが読み込まれていません。<script src=\"https://static.line-scdn.net/liff/edge/2/sdk.js\">を先に読み込んでください。"
    );
  }

  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
    // login()はリダイレクトを発生させるため、ここから先の処理は実質実行されない
    return null;
  }

  const profile = await liff.getProfile();
  return { userId: profile.userId, displayName: profile.displayName };
}

// LIFF起動 → ユーザー識別までをまとめて行い、{ userId, displayName } を返す。
// 未ログイン等でリダイレクトが発生する場合は null を返す（呼び出し側はnullなら以降の描画処理を行わない）。
export function getCurrentUser() {
  if (!currentUserPromise) {
    const debugUserId = getDebugUserId();
    if (isDemo()) {
      showDemoBanner();
      currentUserPromise = Promise.resolve({ userId: DEMO_USER_ID, displayName: "デモ" });
    } else {
      currentUserPromise = debugUserId
        ? Promise.resolve({ userId: debugUserId, displayName: "(debug)" })
        : resolveViaLiff();
    }
  }
  return currentUserPromise;
}

// LIFFのIDトークンを返す（Firebaseカスタムトークンの発行に使う）。debugUserId利用時はLIFFを通らないため null。
export async function getIdToken() {
  const user = await getCurrentUser();
  if (!user || getDebugUserId() || isDemo()) return null;
  return liff.getIDToken();
}

// IDトークンが期限切れのとき、LIFFの再ログインでトークンを取り直す（design.md 3.3節）。
// 無限ループ防止のため、セッション中1回だけ。再ログインを開始した場合は true（ページは遷移する）。
const RELOGIN_KEY = "liffReloginTried";

export function reloginForFreshToken() {
  try {
    if (sessionStorage.getItem(RELOGIN_KEY)) return false;
    sessionStorage.setItem(RELOGIN_KEY, "1");
  } catch {
    return false; // sessionStorageが使えないと1回制限を守れないので再ログインしない
  }
  liff.logout();
  liff.login({ redirectUri: location.href });
  return true;
}

export function clearReloginFlag() {
  try {
    sessionStorage.removeItem(RELOGIN_KEY);
  } catch {
    // 使えない環境では何もしない
  }
}
