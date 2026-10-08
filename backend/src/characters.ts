import type { messagingApi } from "@line/bot-sdk";

// docs/charactor/dialogue-scenarios.md のUDCBK（掛け合いユースケース集）に登場する2キャラクター。
export type CharacterKey = "kawauso" | "dr-jinbei";
export type Expression = "normal" | "happy" | "think";

const CHARACTER_NAMES: Record<CharacterKey, string> = {
  kawauso: "カワウソ助教授",
  "dr-jinbei": "ジンベエ名誉教授",
};

const BASE_URL = "https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/character";

const ICON_URLS: Record<CharacterKey, Record<Expression, string>> = {
  kawauso: {
    normal: `${BASE_URL}/kawauso-normal.png`,
    happy: `${BASE_URL}/kawauso-happy.png`,
    think: `${BASE_URL}/kawauso-think.jpeg`,
  },
  "dr-jinbei": {
    normal: `${BASE_URL}/dr-jinbei-normal.png`,
    happy: `${BASE_URL}/dr-jinbe-happy.jpeg`,
    think: `${BASE_URL}/dr-jinbei-think.jpeg`,
  },
};

// LINEのMessage.senderで送信元アイコン・名前を上書きし、1つのreplyMessage内で
// 複数キャラが交互に喋っているように見せる（Flex Messageに押し込めず、通常のtextメッセージを
// キャラごとに複数個並べる方式。dialogue-scenarios.mdの掛け合い形式にそのまま対応できる）。
export function characterLine(
  character: CharacterKey,
  expression: Expression,
  text: string,
  quickReply?: messagingApi.QuickReply,
): messagingApi.TextMessage {
  return {
    type: "text",
    text,
    sender: {
      name: CHARACTER_NAMES[character],
      iconUrl: ICON_URLS[character][expression],
    },
    quickReply,
  };
}
