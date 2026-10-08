import type { messagingApi } from "@line/bot-sdk";
import { characterLine } from "./characters.js";

// 友だち追加（follow イベント）時のウェルカムメッセージ。
// 構成: カワウソ助教授のあいさつ → ジンベエ名誉教授のあいさつ → 使い方 Flex カルーセル（5枚）。
// 画像は Gemini 生成（scripts/generate-welcome-images.ts）を公開バケットに置いたもの。文字は画像に含めずFlex側で書く。
// 注意: layout: 'baseline' の直下に box を置かない（CLAUDE.md の過去障害）。ここでは vertical/horizontal のみ使う。

const ASSET_BASE = "https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/welcome";
export const ZUKAN_LIFF_URL = "https://kaiyukan-gacha-hackathon.web.app/zukan.html";

const IMAGE_ASPECT = "3:2";

function stepBubble(opts: { image: string; step: string; title: string; body: string }): messagingApi.FlexBubble {
  return {
    type: "bubble",
    hero: {
      type: "image",
      url: `${ASSET_BASE}/${opts.image}`,
      size: "full",
      aspectRatio: IMAGE_ASPECT,
      aspectMode: "cover",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "lg",
      contents: [
        { type: "text", text: opts.step, size: "sm", weight: "bold", color: "#1a8f8f" },
        { type: "text", text: opts.title, size: "xl", weight: "bold", wrap: true },
        { type: "text", text: opts.body, size: "md", wrap: true, color: "#444444" },
      ],
    },
  };
}

function finalBubble(): messagingApi.FlexBubble {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "lg",
      paddingAll: "xl",
      justifyContent: "center",
      contents: [
        { type: "text", text: "さあ、はじめよう！", size: "xl", weight: "bold", wrap: true },
        { type: "text", text: "まずは水槽の横の解説パネルを撮って送ってみるっす！", size: "md", wrap: true, color: "#444444" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "md",
          color: "#1a8f8f",
          action: { type: "uri", label: "図鑑を見る", uri: ZUKAN_LIFF_URL },
        },
      ],
    },
  };
}

export function buildWelcomeFlex(): messagingApi.FlexMessage {
  return {
    type: "flex",
    altText: "使い方：パネルを撮る→図鑑に登録→仲間をたどる→クイズ→駅から水族館",
    contents: {
      type: "carousel",
      contents: [
        stepBubble({ image: "welcome-1-panel.jpg", step: "STEP 1", title: "パネルを撮って送る", body: "水槽の横の解説パネルを撮影して送ってほしいっす！" }),
        stepBubble({ image: "welcome-2-zukan.jpg", step: "STEP 2", title: "図鑑に登録！", body: "生きものを見つけたらガチャでカードをゲット。仲間の生きものもたどれるっす！" }),
        stepBubble({ image: "welcome-3-quiz.jpg", step: "STEP 3", title: "クイズに挑戦", body: "レベルに合わせた問題を出すっす。困ったらヒントもあるっす！" }),
        stepBubble({ image: "welcome-4-station.jpg", step: "STEP 4", title: "水族館をさがす", body: "「新大阪駅から1時間で行ける水族館は？」と聞いてみるっす！" }),
        finalBubble(),
      ],
    },
  };
}

export function buildWelcomeMessages(): messagingApi.Message[] {
  const flex = buildWelcomeFlex();
  return [
    characterLine("kawauso", "happy", "はじめましてっす！ボクはカワウソ助教授っす！いっしょに水族館のいきものを調べるっすよ！"),
    characterLine("dr-jinbei", "normal", "ふむ、ワシはジンベエ名誉教授じゃ。使い方はこの下にまとめたでの。ゆっくり見てくれたまえのう。"),
    flex,
  ];
}
