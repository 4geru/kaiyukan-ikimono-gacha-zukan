import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { identifyFishFromImage } from "../src/identifyFish.js";

async function main() {
  const files = process.argv.slice(2);
  const dir = join(process.cwd(), "..", "images", "guide");
  for (const file of files) {
    const buffer = await readFile(join(dir, file));
    const candidates = await identifyFishFromImage(buffer, "image/jpeg");
    const summary = candidates.map((c) => `${c.name}(${c.confidence})`).join(", ");
    console.log(`${file}\t${summary}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
