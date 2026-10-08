import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePoolLine, poolLineSchema } from "../src/quizPool.js";

// #831 作り置きの在庫一覧（LLM・Firestore なし）。種ごとの approved / rejected / pending / 起動時に捨てられる行の数と、
// rejected の理由の先頭を出す。使い方: npx tsx scripts/report-quiz-pool.ts
const dir = join(dirname(fileURLToPath(import.meta.url)), "../data/quiz-pool");
const files = (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort((a, b) => parseInt(a) - parseInt(b));

const rows: Record<string, string | number>[] = [];
const rejectedIssues: string[] = [];
const byLevel: Record<number, number> = {};
const total = { approved: 0, rejected: 0, pending: 0, invalid: 0 };
for (const name of files) {
  const counts = { approved: 0, rejected: 0, pending: 0, invalid: 0 };
  for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      counts.invalid++;
      continue;
    }
    const r = parsePoolLine(raw);
    if ("question" in r) {
      counts.approved++;
      byLevel[r.question.level] = (byLevel[r.question.level] ?? 0) + 1;
    } else {
      counts[r.skip]++;
      if (r.skip === "rejected") {
        const p = poolLineSchema.safeParse(raw);
        if (p.success) rejectedIssues.push(`${p.data.id}: ${p.data.review.issues?.[0] ?? "(理由なし)"}`);
      }
    }
  }
  rows.push({ file: name, ...counts });
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += counts[k];
}
console.table(rows);
console.log("合計", total);
console.log("レベル別 approved", byLevel);
console.log(`rejected の理由（先頭10件 / ${rejectedIssues.length}件）`);
for (const l of rejectedIssues.slice(0, 10)) console.log(" -", l);
