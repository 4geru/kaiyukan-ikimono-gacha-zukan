import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

// #832 構造化ログ（design 3.1〜3.4）。標準出力に1行JSONを書く。Cloud Run が jsonPayload として取り込み、
// severity / message / logging.googleapis.com/trace を特別な項目として読み替える。
// 個人情報（LINE userId の生値・自由文・座標）は出さない: hashId で匿名化し、危険な項目名と userId 形式の値は logEvent が落とす。

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export const APP_NAME = "kaiyukan-gacha-bot";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "kaiyukan-gacha-hackathon";

// ---------------------------------------------------------------------------
// ハッシュ（design 3.4 / 論点1: #829 と同じ SHA-256 の先頭8桁）
// ---------------------------------------------------------------------------

export function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// 文脈（trace・userIdHash）。Webhook は 200 を先に返して非同期で処理するため、引数でなく AsyncLocalStorage で持ち回る
// ---------------------------------------------------------------------------

export interface LogContext {
  trace?: string;
  userIdHash?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...ctx }, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

// X-Cloud-Trace-Context: "TRACE_ID/SPAN_ID;o=1" -> "projects/<project>/traces/<TRACE_ID>"
export function parseTraceHeader(header: string | undefined, projectId: string = PROJECT_ID): string | undefined {
  if (!header) return undefined;
  const traceId = header.split("/")[0]?.trim();
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return undefined;
  return `projects/${projectId}/traces/${traceId}`;
}

// ---------------------------------------------------------------------------
// 1行の組み立て
// ---------------------------------------------------------------------------

// 出してはいけない項目名（呼び出し側の取りこぼしに対する安全網）
const FORBIDDEN_KEYS = new Set([
  "userId",
  "userid",
  "text",
  "userMessage",
  "message_text",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "address",
  "replyToken",
  "webhookEventId",
  "messageId",
]);
const LINE_USER_ID = /\bU[0-9a-f]{32}\b/g;
const MAX_STRING = 500;

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") {
    const redacted = value.replace(LINE_USER_ID, "[redacted-userId]");
    return redacted.length > MAX_STRING ? `${redacted.slice(0, MAX_STRING)}…` : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = FORBIDDEN_KEYS.has(k) ? "[omitted]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

// 例外は name / message だけ（スタックは ERROR のときだけ別項目で付ける）
export function errorFields(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 300) };
  return { name: "NonError", message: String(error).slice(0, 300) };
}

export function buildLogLine(
  event: string,
  fields: Record<string, unknown>,
  severity: Severity = "INFO",
  now: { version?: string } = {},
): Record<string, unknown> {
  const { message, error, ...rest } = fields;
  const ctx = getLogContext();
  const line: Record<string, unknown> = {
    severity,
    message: typeof message === "string" ? message : event,
    event,
    app: APP_NAME,
    version: now.version ?? process.env.K_REVISION ?? "local",
  };
  if (ctx.trace) line["logging.googleapis.com/trace"] = ctx.trace;
  if (ctx.userIdHash) line.userIdHash = ctx.userIdHash;
  Object.assign(line, sanitize(rest) as Record<string, unknown>);
  if (error !== undefined) {
    line.error = sanitize(errorFields(error));
    if (severity === "ERROR" && error instanceof Error && error.stack) {
      line.stack = String(sanitize(error.stack));
    }
  }
  // message はサニタイズ済みの文字列にする
  line.message = sanitize(line.message);
  return line;
}

type Sink = (severity: Severity, line: string) => void;
const defaultSink: Sink = (severity, line) => {
  if (severity === "ERROR") console.error(line);
  else console.log(line);
};
let sink: Sink = defaultSink;

// 確認スクリプト用: 出力先を差し替える（戻り値で元に戻す）
export function setLogSink(next: Sink | null): void {
  sink = next ?? defaultSink;
}

export function logEvent(event: string, fields: Record<string, unknown> = {}, severity: Severity = "INFO"): void {
  try {
    sink(severity, JSON.stringify(buildLogLine(event, fields, severity)));
  } catch {
    // ログの失敗で本処理を止めない
  }
}
