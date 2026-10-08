// LIFF（LINEミニアプリ）のIDトークンを検証し、LINE userIdをuidとするFirebaseカスタムトークンを発行する。
// docs/specs/785-liff-firebase-auth/design.md 2節。idToken・customToken・userIdはログに出さない。
import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import "./firestore.js"; // firebase-adminの初期化（副作用）
import { logEvent } from "./log.js";

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

type AuthErrorCode =
  | "missing_id_token"
  | "invalid_audience"
  | "id_token_expired"
  | "invalid_id_token"
  | "line_api_unavailable"
  | "token_issue_failed";

class LineAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode
  ) {
    super(code);
  }
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// 未設定でも起動は止めない（/webhook を巻き込まない）。許可リストが空なら常に401になる。
const allowedChannelIds = () => parseList(process.env.LINE_LOGIN_CHANNEL_IDS);
const allowedOrigins = () => parseList(process.env.AUTH_ALLOWED_ORIGINS);

// どのチャネルIDで検証するかを選ぶためだけに、JWTペイロードのaudを署名検証なしで読む（認可には使わない）。
function readAudience(idToken: string): string | undefined {
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return typeof payload?.aud === "string" ? payload.aud : undefined;
  } catch {
    return undefined;
  }
}

// 署名・有効期限・audの一致はLINE側に検証させ、応答のsub（=LINE userId）を返す。
async function verifyIdToken(idToken: string, clientId: string): Promise<string> {
  let response: globalThis.Response;
  try {
    response = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    logEvent("auth_line_unreachable", { errorName: (error as Error).name, message: "LINE verify APIへ到達できません" }, "ERROR");
    throw new LineAuthError(502, "line_api_unavailable");
  }

  if (response.status >= 500) {
    logEvent("auth_line_5xx", { status: response.status, message: "LINE verify APIが5xxを返しました" }, "ERROR");
    throw new LineAuthError(502, "line_api_unavailable");
  }

  const body = (await response.json().catch(() => ({}))) as {
    sub?: unknown;
    aud?: unknown;
    error_description?: unknown;
  };

  if (!response.ok) {
    const description = typeof body.error_description === "string" ? body.error_description : "";
    logEvent("auth_line_verify_failed", { status: response.status, description, aud: clientId, message: "IDトークン検証に失敗" }, "WARNING");
    throw new LineAuthError(401, /expired/i.test(description) ? "id_token_expired" : "invalid_id_token");
  }

  if (body.aud !== undefined && body.aud !== clientId) throw new LineAuthError(401, "invalid_audience");
  if (typeof body.sub !== "string" || !body.sub) throw new LineAuthError(401, "invalid_id_token");
  return body.sub;
}

export async function handleLineAuth(req: Request, res: Response): Promise<void> {
  try {
    const idToken = req.body?.idToken;
    if (typeof idToken !== "string" || !idToken) throw new LineAuthError(400, "missing_id_token");

    const audience = readAudience(idToken);
    if (!audience || !allowedChannelIds().includes(audience)) throw new LineAuthError(401, "invalid_audience");

    const lineUserId = await verifyIdToken(idToken, audience);

    let customToken: string;
    try {
      customToken = await getAuth().createCustomToken(lineUserId);
    } catch (error) {
      const code = (error as { code?: string }).code ?? (error as Error).name;
      logEvent("auth_line_token_failed", { code, message: "createCustomTokenに失敗" }, "ERROR");
      throw new LineAuthError(500, "token_issue_failed");
    }
    res.json({ customToken });
  } catch (error) {
    if (error instanceof LineAuthError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    logEvent("auth_line_unexpected", { errorName: (error as Error).name, message: "想定外のエラー" }, "ERROR");
    res.status(500).json({ error: "token_issue_failed" satisfies AuthErrorCode });
  }
}

// #837: LINE アカウントなしで図鑑を見せるデモ用。入力なしで、デモユーザーのカスタムトークンだけを返す。
// デモユーザーは Firestore ルールで自分の分しか読めず、書き込みは全拒否なので、トークンが広まっても他人の記録は読めない。
export const DEMO_UID = "demo-zukan";
const DEMO_LIMIT_PER_MINUTE = 60;
let demoWindowStart = 0;
let demoCount = 0;

export async function handleDemoAuth(_req: Request, res: Response): Promise<void> {
  const now = Date.now();
  if (now - demoWindowStart > 60_000) {
    demoWindowStart = now;
    demoCount = 0;
  }
  if (++demoCount > DEMO_LIMIT_PER_MINUTE) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }
  try {
    const customToken = await getAuth().createCustomToken(DEMO_UID, { demo: true });
    logEvent("auth_demo_issued", { message: "デモユーザーのトークンを発行しました" });
    res.json({ customToken });
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error as Error).name;
    logEvent("auth_demo_token_failed", { code, message: "デモのcreateCustomTokenに失敗" }, "ERROR");
    res.status(500).json({ error: "token_issue_failed" });
  }
}

// AUTH_ALLOWED_ORIGINS に含まれるOriginにだけCORSを許可する（Cookieは使わないのでCredentialsは付けない）。
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header("Origin");
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.vary("Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "3600");
    res.status(204).end();
    return;
  }
  next();
}

// express.json() のパース失敗（不正なJSON・サイズ超過）もJSONで返す。
export function jsonBodyErrorHandler(_error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  res.status(400).json({ error: "missing_id_token" satisfies AuthErrorCode });
}
