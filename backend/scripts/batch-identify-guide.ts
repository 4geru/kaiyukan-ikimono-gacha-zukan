import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { identifyFishFromImage } from "../src/identifyFish.js";

async function main() {
  const dir = join(process.cwd(), "..", "images", "guide");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jpeg")).sort();

  for (const file of files) {
    const buffer = await readFile(join(dir, file));
    try {
      const candidates = await identifyFishFromImage(buffer, "image/jpeg");
      const summary = candidates.map((c) => `${c.name}(${c.confidence})`).join(", ");
      console.log(`${candidates.length > 0 ? "O" : "X"}\t${candidates.length}\t${file}\t${summary}`);
    } catch (error) {
      console.log(`ERR\t-\t${file}\t${(error as Error).message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
