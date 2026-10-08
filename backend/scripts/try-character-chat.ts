import "dotenv/config";
import { generateCharacterChat } from "../src/characterChat.js";

async function main() {
  const userMessage = process.argv[2] ?? "ジンベエ教授は何歳ですか？";
  const lines = await generateCharacterChat(userMessage);
  console.log(`--- ユーザー: ${userMessage} ---`);
  for (const line of lines) {
    console.log(`[${line.character}/${line.expression}] ${line.text}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
