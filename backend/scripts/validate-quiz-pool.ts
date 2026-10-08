import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LEVEL_EXCLUDED_CATEGORIES, type QuizLevel } from "../src/quizLevel.js";
import { KANJI_GRADE_12_SET } from "./kanji-grade12.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POOL_DIR = path.join(__dirname, "../data/quiz-pool");

interface PoolQuestion {
  id: string;
  animalId: string;
  category: string;
  level: QuizLevel;
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  factSource: string;
  groundingNames: string[];
  generatedBy: string;
  generatedAt: string;
  review: { status: string };
}

interface ValidationError {
  animalId: string;
  questionId: string;
  issue: string;
}

function validateQuestion(q: unknown, animalId: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof q !== "object" || q === null) {
    errors.push({ animalId, questionId: "unknown", issue: "Not a valid JSON object" });
    return errors;
  }

  const question = q as Record<string, unknown>;
  const questionId = typeof question.id === "string" ? question.id : "unknown";

  // Required fields
  if (typeof question.id !== "string") errors.push({ animalId, questionId, issue: "Missing or invalid id" });
  if (typeof question.animalId !== "string") errors.push({ animalId, questionId, issue: "Missing or invalid animalId" });
  if (typeof question.category !== "string") errors.push({ animalId, questionId, issue: "Missing or invalid category" });
  if (typeof question.level !== "number" || question.level < 1 || question.level > 5) {
    errors.push({ animalId, questionId, issue: "Missing or invalid level (must be 1-5)" });
  }
  if (typeof question.question !== "string") errors.push({ animalId, questionId, issue: "Missing or invalid question" });
  if (!Array.isArray(question.choices)) {
    errors.push({ animalId, questionId, issue: "Missing or invalid choices (must be array)" });
  } else {
    if (question.choices.length !== 3) {
      errors.push({ animalId, questionId, issue: `Wrong number of choices (expected 3, got ${question.choices.length})` });
    }
    if (!question.choices.every((c) => typeof c === "string")) {
      errors.push({ animalId, questionId, issue: "Not all choices are strings" });
    }
  }

  if (typeof question.correctIndex !== "number" || question.correctIndex < 0 || question.correctIndex > 2) {
    errors.push({ animalId, questionId, issue: "Missing or invalid correctIndex (must be 0-2)" });
  }

  // Check for duplicate choices
  if (Array.isArray(question.choices) && question.choices.length === 3) {
    const uniqueChoices = new Set(question.choices);
    if (uniqueChoices.size < 3) {
      errors.push({ animalId, questionId, issue: "Duplicate choices found" });
    }
  }

  if (typeof question.explanation !== "string") errors.push({ animalId, questionId, issue: "Missing or invalid explanation" });
  if (typeof question.factSource !== "string") errors.push({ animalId, questionId, issue: "Missing or invalid factSource" });
  if (!Array.isArray(question.groundingNames)) errors.push({ animalId, questionId, issue: "Missing or invalid groundingNames (must be array)" });

  // Check level 1 excluded categories
  if (question.level === 1 && typeof question.category === "string") {
    const excludedForLevel1: string[] = LEVEL_EXCLUDED_CATEGORIES[1];
    if (excludedForLevel1.includes(question.category)) {
      errors.push({
        animalId,
        questionId,
        issue: `Category "${question.category}" should not appear at level 1`,
      });
    }
  }

  return errors;
}

// 漢字を検査
function checkKanjiInText(text: string): string[] {
  const kanjiRegex = /[一-鿿]/g;
  const kanjis = text.match(kanjiRegex) || [];
  // 重複を除去
  return [...new Set(kanjis)];
}

// レベル1の漢字を検査（漢字があれば不合格）
function checkKanjiLevel1(questionText: string, choices: string[]): string | null {
  const questionKanjis = checkKanjiInText(questionText);
  if (questionKanjis.length > 0) {
    return `レベル1は漢字を使用できません（検出: ${questionKanjis.join("")}）`;
  }

  for (const choice of choices) {
    const choiceKanjis = checkKanjiInText(choice);
    if (choiceKanjis.length > 0) {
      return `レベル1は漢字を使用できません（検出: ${choiceKanjis.join("")}）`;
    }
  }

  return null;
}

// レベル2の漢字を検査（1・2年の240字以外の漢字があれば不合格）
function checkKanjiLevel2(questionText: string, choices: string[]): string | null {
  const textToCheck = questionText + choices.join("");
  const allKanjis = checkKanjiInText(textToCheck);

  const invalidKanjis = allKanjis.filter((kanji) => !KANJI_GRADE_12_SET.has(kanji));
  if (invalidKanjis.length > 0) {
    return `レベル2は小学1・2年の漢字のみ使用可能（検出した学年外の漢字: ${invalidKanjis.join("")}）`;
  }

  return null;
}

// 禁止語を検査
function checkProhibitedTerms(choices: string[]): boolean {
  const prohibitedTerms = ["無関係", "不明", "系統不明", "同一種"];
  return choices.some((choice) => prohibitedTerms.some((term) => choice.includes(term)));
}

// 問題文の雛形をチェック
function checkTemplateIssue(question: string, animalName: string, category: string): boolean {
  // 「について？」「について（追加）？」で終わる
  if (question.endsWith("について？") || question.endsWith("について（追加）？")) {
    return true;
  }

  // 生きもの名とカテゴリ名だけでできた問題文（例：「ジンベエザメの生息地？」）
  if (question.includes(animalName) && question.includes(category)) {
    const questionLower = question.toLowerCase();
    const animalLower = animalName.toLowerCase();
    const categoryLower = category.toLowerCase();

    // 生きもの名とカテゴリ名だけで構成されていないか確認
    // 簡易的な判定: 両方を含むが他の説明的な単語がない
    const minLength = Math.max(5, animalName.length + category.length + 5);
    if (question.length <= minLength && question.includes(animalName) && question.includes(category)) {
      return true;
    }
  }

  return false;
}

// 選択肢の長さをチェック
function checkChoicesLength(choices: string[], correctIndex: number): string | null {
  const lengths = choices.map((c) => c.length);
  const correctLength = lengths[correctIndex];
  const otherLengths = lengths.filter((_, i) => i !== correctIndex);
  const avgOther = otherLengths.reduce((a, b) => a + b, 0) / otherLengths.length;

  // 3つの選択肢のうち最長が8文字以下なら、長さの検査を適用しない
  const maxLen = Math.max(...lengths);
  if (maxLen <= 8) {
    return null;
  }

  // 正解の文字数が誤答の平均の1.6倍を超えない
  if (avgOther > 0 && correctLength > avgOther * 1.6) {
    return `正解の文字数(${correctLength})が誤答平均(${Math.round(avgOther)})の1.6倍を超える`;
  }

  // 3つの選択肢の文字数の差は最大でも2倍まで
  const minLen = Math.min(...lengths);
  if (minLen > 0 && maxLen / minLen > 2) {
    return `選択肢の最大文字数(${maxLen})と最小(${minLen})の比が2倍を超える`;
  }

  return null;
}

interface ParsedQuestion extends Record<string, unknown> {
  id?: string;
  question?: string;
  choices?: string[];
  correctIndex?: number;
}

function validateFile(filePath: string, animalName: string): {
  errors: ValidationError[];
  passCount: number;
  failCount: number;
} {
  const errors: ValidationError[] = [];
  const filename = path.basename(filePath);
  const animalId = filename.replace(".jsonl", "");
  let passCount = 0;
  let failCount = 0;

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");

    const seenIds = new Set<string>();
    const seenQuestions = new Set<string>();
    const correctIndexCount = { 0: 0, 1: 0, 2: 0 };
    const allQuestions: ParsedQuestion[] = [];

    lines.forEach((line, idx) => {
      if (!line.trim()) return;

      try {
        const q = JSON.parse(line) as ParsedQuestion;
        allQuestions.push(q);

        const lineErrors = validateQuestion(q, animalId);
        if (lineErrors.length > 0) {
          errors.push(...lineErrors);
          failCount++;
          return;
        }

        const questionId = typeof q.id === "string" ? q.id : `line-${idx + 1}`;

        // Check for duplicate IDs
        if (typeof q.id === "string") {
          if (seenIds.has(q.id)) {
            errors.push({ animalId, questionId, issue: `Duplicate id: ${q.id}` });
            failCount++;
            return;
          }
          seenIds.add(q.id);
        }

        // Track correct index distribution
        if (typeof q.correctIndex === "number" && q.correctIndex >= 0 && q.correctIndex <= 2) {
          correctIndexCount[q.correctIndex as 0 | 1 | 2]++;
        }

        // Check for duplicate questions
        if (typeof q.question === "string") {
          if (seenQuestions.has(q.question)) {
            errors.push({ animalId, questionId, issue: "問題文が重複している" });
            failCount++;
            return;
          }
          seenQuestions.add(q.question);
        }

        // Check for template issues
        if (typeof q.question === "string" && checkTemplateIssue(q.question, animalName, q.category as string)) {
          errors.push({ animalId, questionId, issue: "雛形の問題: 「について？」で終わるか、生きもの名とカテゴリ名だけで構成されている" });
          failCount++;
          return;
        }

        // Check for prohibited terms
        if (Array.isArray(q.choices) && checkProhibitedTerms(q.choices)) {
          errors.push({ animalId, questionId, issue: "禁止語を含む誤答: 「無関係」「不明」「系統不明」「同一種」など" });
          failCount++;
          return;
        }

        // Check kanji (level 1: no kanji allowed, level 2: only grade 1-2 kanji allowed)
        if (typeof q.question === "string" && Array.isArray(q.choices) && typeof q.level === "number") {
          if (q.level === 1) {
            const kanjiIssue = checkKanjiLevel1(q.question, q.choices);
            if (kanjiIssue) {
              errors.push({ animalId, questionId, issue: kanjiIssue });
              failCount++;
              return;
            }
          } else if (q.level === 2) {
            const kanjiIssue = checkKanjiLevel2(q.question, q.choices);
            if (kanjiIssue) {
              errors.push({ animalId, questionId, issue: kanjiIssue });
              failCount++;
              return;
            }
          }
        }

        // Check choices length
        if (Array.isArray(q.choices) && typeof q.correctIndex === "number") {
          const lengthIssue = checkChoicesLength(q.choices, q.correctIndex);
          if (lengthIssue) {
            errors.push({ animalId, questionId, issue: `選択肢の長さ不適切: ${lengthIssue}` });
            failCount++;
            return;
          }
        }

        passCount++;
      } catch (e) {
        errors.push({ animalId, questionId: `line-${idx + 1}`, issue: `Invalid JSON: ${(e as Error).message}` });
        failCount++;
      }
    });

    // Check for skewed correct answer distribution
    const total = lines.filter((l) => l.trim()).length;
    const expectedPerIndex = total / 3;
    const tolerance = expectedPerIndex * 0.4;
    Object.entries(correctIndexCount).forEach(([idx, count]) => {
      if (Math.abs(count - expectedPerIndex) > tolerance) {
        errors.push({
          animalId,
          questionId: "distribution",
          issue: `Warning: correctIndex ${idx}が${count}回出現（期待値約${Math.round(expectedPerIndex)}）`,
        });
      }
    });
  } catch (e) {
    errors.push({ animalId, questionId: "file", issue: `Failed to read file: ${(e as Error).message}` });
    failCount++;
  }

  return { errors, passCount, failCount };
}

function getAnimalName(animalId: string): string {
  try {
    const animalsPath = path.join(__dirname, "../data/kaiyukan-animals.json");
    if (!fs.existsSync(animalsPath)) {
      return "Unknown";
    }
    const animalsData = JSON.parse(fs.readFileSync(animalsPath, "utf8")) as Array<{ id: string; name: string }>;
    const animal = animalsData.find((a) => a.id === animalId);
    return animal?.name || "Unknown";
  } catch {
    return "Unknown";
  }
}

function validateAnimals(targetIds: string[]) {
  const poolDataDir = POOL_DIR;
  if (!fs.existsSync(poolDataDir)) {
    console.log(`✓ No pool data directory found (${poolDataDir}) - nothing to validate yet`);
    return;
  }

  const files = fs.readdirSync(poolDataDir).filter((f) => f.endsWith(".jsonl"));

  if (files.length === 0) {
    console.log("✓ No JSONL files found to validate");
    return;
  }

  // Filter files by target IDs
  const targetFiles = files.filter((f) => {
    const id = f.replace(".jsonl", "");
    return targetIds.length === 0 || targetIds.includes(id);
  });

  if (targetFiles.length === 0) {
    console.log(`✗ No files found for animal IDs: ${targetIds.join(", ")}`);
    return;
  }

  const resultsByAnimal = new Map<string, { errors: ValidationError[]; passCount: number; failCount: number }>();

  for (const file of targetFiles) {
    const filePath = path.join(poolDataDir, file);
    const animalId = file.replace(".jsonl", "");
    const animalName = getAnimalName(animalId);
    const result = validateFile(filePath, animalName);
    resultsByAnimal.set(animalId, result);
  }

  // Print results
  for (const [animalId, result] of resultsByAnimal) {
    const { errors, passCount, failCount } = result;
    const fatalErrors = errors.filter((e) => !e.issue.startsWith("Warning"));
    const warnings = errors.filter((e) => e.issue.startsWith("Warning"));

    if (fatalErrors.length > 0) {
      console.log(`\n✗ ${animalId}:`);
      fatalErrors.forEach((e) => {
        console.log(`${e.questionId} ${e.issue}`);
      });
    }

    if (warnings.length > 0) {
      console.log(`\n⚠ ${animalId} - ${warnings.length} warning(s):`);
      warnings.forEach((e) => {
        console.log(`  ${e.issue}`);
      });
    }

    // Print summary for each animal
    console.log(`\n${animalId}: ${passCount}/${passCount + failCount} 合格`);
  }

  // Print final summary
  console.log("\n=== サマリー ===");
  for (const [animalId, result] of resultsByAnimal) {
    console.log(`${animalId}: 合格 ${result.passCount}、不合格 ${result.failCount}`);
  }
}

// Get target animal IDs from command line arguments
const args = process.argv.slice(2);
validateAnimals(args);
