// Flex Message Simulator 用 JSON を docs/welcome-flex.json に書き出す。
import { writeFile } from "node:fs/promises";
import { buildWelcomeFlex } from "../src/welcomeMessage.js";
await writeFile(new URL("../../docs/welcome-flex.json", import.meta.url), JSON.stringify(buildWelcomeFlex().contents, null, 2));
console.log("書き出しました");
