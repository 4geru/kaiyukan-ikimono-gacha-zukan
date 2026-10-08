import { GoogleGenAI, Type } from "@google/genai";
import type { CharacterKey, Expression } from "./characters.js";
import { logGuard, withLlmLog } from "./agentRun.js";
import {
  buildUserInput,
  extractJsonObject,
  INJECTION_GUARD_NOTICE,
  isSafeCharacterLine,
  SAFE_CHARACTER_LINE,
  stripUrls,
} from "./guards.js";

export interface CharacterChatLine {
  character: CharacterKey;
  expression: Expression;
  text: string;
}

const MODEL = "gemini-2.5-flash";

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          character: { type: Type.STRING, enum: ["kawauso", "dr-jinbei"] },
          expression: { type: Type.STRING, enum: ["normal", "happy", "think"] },
          text: { type: Type.STRING },
        },
        required: ["character", "expression", "text"],
      },
      minItems: "1",
      maxItems: "2",
    },
  },
  required: ["lines"],
};

const SYSTEM_INSTRUCTION = `あなたは海遊館のLINE Botに登場する2人のキャラクターです。次の口調で掛け合いをしてください。
- カワウソ助教授(kawauso): テンポよく元気で賑やかなファシリテーター役。語尾は「〜っす」。
- ジンベエ名誉教授(dr-jinbei): 重厚で知識豊富な長老役。語尾は「〜じゃ」「〜のう」。

ユーザーからの雑談・質問に、このキャラクター性を保ったまま1〜2行の掛け合いで応答してください。
事実に基づかない内容は断定せず、分からないことは「詳しくは分からんのう」のように正直に答えてください。
小学生にも分かる言葉を使ってください。${INJECTION_GUARD_NOTICE}`;

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

export async function generateCharacterChat(userMessage: string): Promise<CharacterChatLine[]> {
  const ai = getClient();

  let responseText: string | undefined;
  try {
    const contents = buildUserInput(userMessage);
    const response = await withLlmLog("chat", MODEL, contents.length, () =>
      ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    );
    responseText = response.text;
  } catch (error) {
    throw new Error(
      `キャラクターチャットの生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!responseText) {
    throw new Error("Geminiのレスポンスが空でした");
  }

  const parsed = JSON.parse(extractJsonObject(responseText)) as { lines: CharacterChatLine[] };
  if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
    throw new Error(`Geminiのレスポンスが期待した形式ではありませんでした: ${responseText}`);
  }
  return parsed.lines.map(sanitizeChatLine);
}

// セリフから URL を外し、口調が崩れていたら決まったセリフに差し替える
function sanitizeChatLine(line: CharacterChatLine): CharacterChatLine {
  const { text, removed } = stripUrls(line.text);
  if (removed) logGuard("chat", "output_sanitized", "replaced", "url");
  if (!text || !isSafeCharacterLine(line.character, text)) {
    logGuard("chat", "tone_broken", "replaced", line.character);
    return { ...line, expression: "think", text: SAFE_CHARACTER_LINE[line.character] };
  }
  return { ...line, text };
}
