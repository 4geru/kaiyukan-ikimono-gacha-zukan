import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { KaiyukanAnimal } from "../src/kaiyukanData.js";
import { QUIZ_CATEGORIES, CATEGORY_BRIEFS, COMMON_QUIZ_RULES } from "../src/quiz.js";
import { QUIZ_LEVELS, LEVEL_EXCLUDED_CATEGORIES, LEVEL_CATEGORY_NOTES, type QuizLevel } from "../src/quizLevel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANIMALS_DATA_PATH = path.join(__dirname, "../data/kaiyukan-animals.json");
const WIKI_CACHE_PATH = path.join(__dirname, "../.cache/wikipedia-extracts.json");
const OUTPUT_DIR = path.join(__dirname, "../data/quiz-pool/input");

interface WikipediaExtract {
  id: string;
  title: string;
  lang: "ja" | "en";
  extract: string;
}

interface PoolInput {
  animal: {
    id: string;
    name: string;
    englishName: string;
    scientificName: string;
    family: string;
    classification: string;
    mainExhibition: string;
    description: string;
  };
  references: {
    wikipediaExtract: string;
  };
  familyMembers: string[];
  tankmates: string[];
  levelDefinitions: Record<QuizLevel, typeof QUIZ_LEVELS[1]>;
  levelCategoryNotes: Record<QuizLevel, Partial<Record<string, string>>>;
  categoryBriefs: typeof CATEGORY_BRIEFS;
  commonRules: readonly string[];
  quizzesToCreate: Array<{ category: string; level: QuizLevel }>;
}

function loadAnimalsData(): KaiyukanAnimal[] {
  const content = fs.readFileSync(ANIMALS_DATA_PATH, "utf8");
  return JSON.parse(content);
}

function loadWikipediaCache(): Record<string, WikipediaExtract> {
  try {
    const content = fs.readFileSync(WIKI_CACHE_PATH, "utf8");
    const data = JSON.parse(content) as WikipediaExtract[];
    return Object.fromEntries(data.map((item) => [item.id, item]));
  } catch {
    return {};
  }
}

function getAnimalById(animals: KaiyukanAnimal[], animalId: string): KaiyukanAnimal | null {
  return animals.find((a) => a.id === animalId) || null;
}

function getFamilyMembers(animals: KaiyukanAnimal[], targetFamily: string, excludeId: string): string[] {
  return animals
    .filter((a) => a.family === targetFamily && a.id !== excludeId)
    .map((a) => a.name)
    .sort();
}

function getTankmates(animals: KaiyukanAnimal[], targetExhibition: string, excludeId: string): string[] {
  return animals
    .filter((a) => a.mainExhibition === targetExhibition && a.id !== excludeId)
    .map((a) => a.name)
    .sort();
}

function buildQuizzesToCreate(): Array<{ category: string; level: QuizLevel }> {
  const quizzes: Array<{ category: string; level: QuizLevel }> = [];
  for (const category of QUIZ_CATEGORIES) {
    for (const level of [1, 2, 3, 4, 5] as const) {
      // レベル1では除外カテゴリをスキップ
      if (level === 1 && LEVEL_EXCLUDED_CATEGORIES[1].includes(category)) {
        continue;
      }
      quizzes.push({ category, level });
    }
  }
  return quizzes;
}

function buildPoolInput(animal: KaiyukanAnimal, animals: KaiyukanAnimal[], wikiCache: Record<string, WikipediaExtract>): PoolInput {
  const wiki = wikiCache[animal.id];
  const wikipediaExtract = wiki ? `Wikipedia ${wiki.lang === "en" ? "英語版" : "日本語版"}「${wiki.title}」の抜粋:\n${wiki.extract}` : "";

  return {
    animal: {
      id: animal.id,
      name: animal.name,
      englishName: animal.englishName,
      scientificName: animal.scientificName,
      family: animal.family,
      classification: animal.classification,
      mainExhibition: animal.mainExhibition,
      description: animal.description,
    },
    references: {
      wikipediaExtract,
    },
    familyMembers: getFamilyMembers(animals, animal.family, animal.id),
    tankmates: getTankmates(animals, animal.mainExhibition, animal.id),
    levelDefinitions: QUIZ_LEVELS,
    levelCategoryNotes: LEVEL_CATEGORY_NOTES as Record<QuizLevel, Partial<Record<string, string>>>,
    categoryBriefs: CATEGORY_BRIEFS,
    commonRules: COMMON_QUIZ_RULES,
    quizzesToCreate: buildQuizzesToCreate(),
  };
}

async function main() {
  const animalIds = process.argv.slice(2);
  if (animalIds.length === 0) {
    console.error("Usage: npx tsx build-quiz-pool-input.ts <animalId> [<animalId> ...]");
    process.exit(1);
  }

  const animals = loadAnimalsData();
  const wikiCache = loadWikipediaCache();

  // Create output directory if it doesn't exist
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const animalId of animalIds) {
    const animal = getAnimalById(animals, animalId);
    if (!animal) {
      console.error(`Animal with ID ${animalId} not found`);
      continue;
    }

    const poolInput = buildPoolInput(animal, animals, wikiCache);
    const outputPath = path.join(OUTPUT_DIR, `${animalId}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(poolInput, null, 2));
    console.log(`✓ Created ${outputPath}`);
  }
}

main().catch(console.error);
