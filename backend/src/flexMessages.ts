import type { messagingApi } from '@line/bot-sdk';
import type { FishCandidate } from './identifyFish.js';
import type { NearbyAquarium } from './aquariumData.js';
import type { AquariumRoute, NearestAquariumResult } from './nearestAquarium.js';
import { levelLabel, type QuizLevel } from './quizLevel.js';

// ADKエージェント(scripts/try-quiz-agent.ts)・quiz.tsのどちらの出力からも組み立てられるよう、
// Flex Message側は最小限の共通シェイプだけを要求する（呼び出し側でどちらの形式からも詰め替えられる）。
export interface QuizToPresent {
  animalId: string;
  category?: string;
  question: string;
  choices: string[];
  correctIndex: number;
  speakerPersona?: string;
  // Wikipediaを参考資料にして作った問題かどうか。CC BY-SA の出典表記を末尾に出すために使う。
  referencesWikipedia?: boolean;
  // #829: 難易度レベルの表示と、ヒント付き再挑戦の2択（消した選択肢の番号）
  level?: QuizLevel;
  eliminatedIndex?: number | null;
}

const MAX_ALT_TEXT_NAMES = 3;

const NOT_FOUND_ALT_TEXT = 'なぞの生きもの…？図鑑には載っていないみたい';

export function buildNotFoundFlexMessage(): messagingApi.FlexMessage {
  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#4ECDC4',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: '🌊 なぞの生きもの…？',
          color: '#FFFFFF',
          weight: 'bold',
          size: 'sm',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '海遊館の図鑑には載っていないみたい。',
          size: 'sm',
          wrap: true,
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'text',
          text: 'もう一度、案内板の文字がよく見える角度で撮ってみてね📷',
          size: 'sm',
          wrap: true,
          margin: 'md',
          color: '#8A94A6',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: NOT_FOUND_ALT_TEXT,
    contents: bubble,
  };
}

function buildCandidateBubble(candidate: FishCandidate): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    hero: {
      type: 'image',
      url: candidate.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: candidate.name,
          weight: 'bold',
          size: 'lg',
          wrap: true,
        },
        // 仲間カード（buildMateBubble）と同じ書き方で、どの展示エリアにいるかを出す
        ...(candidate.exhibitionName
          ? [
              {
                type: 'text',
                text: `🌊 ${candidate.exhibitionName}展示エリア`,
                size: 'xs',
                color: '#8A94A6',
                wrap: true,
                margin: 'sm',
              } satisfies messagingApi.FlexText,
            ]
          : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          action: {
            type: 'postback',
            label: '見つけた！',
            data: `action=selectFish&animalId=${encodeURIComponent(candidate.id)}`,
            displayText: candidate.name,
          },
        },
      ],
    },
  };
}

export function buildCandidatesFlexMessage(
  candidates: FishCandidate[],
): messagingApi.FlexMessage {
  const names = candidates.slice(0, MAX_ALT_TEXT_NAMES).map((c) => c.name).join('、');
  const altText =
    candidates.length === 1
      ? `候補: ${names}`
      : `候補が${candidates.length}件見つかりました: ${names}${candidates.length > MAX_ALT_TEXT_NAMES ? ' など' : ''}`;

  const contents: messagingApi.FlexContainer =
    candidates.length === 1
      ? buildCandidateBubble(candidates[0])
      : {
          type: 'carousel',
          contents: candidates.map(buildCandidateBubble),
        };

  return {
    type: 'flex',
    altText,
    contents,
  };
}

const CHOICE_LABELS = ['A', 'B', 'C', 'D'];
const CHOICE_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD166', '#A78BFA'];
const CHOICE_ICON_URLS = [
  'https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/select/a.png',
  'https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/select/b.png',
  'https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/select/c.png',
];

const RETRY_HEADER_COLOR = '#7B61FF';

function isRetryQuiz(quiz: QuizToPresent): boolean {
  return quiz.eliminatedIndex !== undefined && quiz.eliminatedIndex !== null;
}

function buildQuizHeader(quiz: QuizToPresent): messagingApi.FlexBox {
  const isCharacterQuiz = Boolean(quiz.speakerPersona);
  const isRetry = isRetryQuiz(quiz);
  const firstLine = isRetry
    ? '💡 ヒント付き再挑戦'
    : isCharacterQuiz
      ? `🐳 ${quiz.speakerPersona}`
      : `🐠 ${quiz.category ?? 'クイズ'}`;
  const contents: messagingApi.FlexComponent[] = [
    { type: 'text', text: firstLine, color: '#FFFFFF', weight: 'bold', size: 'sm' },
  ];
  if (quiz.level !== undefined) {
    // ヘッダーはvertical。textを足すだけでbaselineの入れ子制約には触れない
    contents.push({ type: 'text', text: levelLabel(quiz.level), color: '#FFFFFFCC', size: 'xxs', margin: 'xs' });
  }
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: isRetry ? RETRY_HEADER_COLOR : isCharacterQuiz ? '#F5A623' : '#4A90D9',
    paddingAll: 'md',
    contents,
  };
}

// 本文側は色だけの丸ポチにする（文字は出さない）。本文とクイックリプライでA/B/Cが二重に出て
// 被るのを避けるため。色を揃えることで「本文の●＝クイックリプライの丸アイコン」の対応関係を示す。
// 回答は、クイックリプライのA/B/C、または本文の選択肢の行そのもののタップのどちらでもできる。
function buildChoiceBadge(index: number, eliminated = false): messagingApi.FlexBox {
  return {
    type: 'box',
    layout: 'vertical',
    width: '14px',
    height: '14px',
    cornerRadius: '7px',
    backgroundColor: eliminated ? '#CCCCCC' : (CHOICE_COLORS[index] ?? '#999999'),
    contents: [],
  };
}

// 回答のpostback。クイックリプライと本文の選択肢の行で共有する。
// quizTokenは出題の識別子（pendingQuiz.askedAtのミリ秒）。本文のFlexは古い問題のものもタップできてしまうため、
// 最新の出題と一致しない回答をserver側で弾くのに使う（クイックリプライは最新の1通にしか出ないので従来は不要だった）。
function buildAnswerAction(quiz: QuizToPresent, index: number, quizToken?: number): messagingApi.PostbackAction {
  const tokenParam = quizToken !== undefined ? `&t=${quizToken}` : '';
  return {
    type: 'postback',
    label: CHOICE_LABELS[index] ?? String(index + 1),
    data: `action=answerQuiz&animalId=${encodeURIComponent(quiz.animalId)}&choiceIndex=${index}${tokenParam}`,
    displayText: `${CHOICE_LABELS[index] ?? index + 1}. ${quiz.choices[index]}`,
  };
}

function buildChoiceRow(quiz: QuizToPresent, index: number, quizToken?: number): messagingApi.FlexBox {
  const eliminated = quiz.eliminatedIndex === index;
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    alignItems: 'center',
    // 消した選択肢は押せない（actionを付けない）
    ...(eliminated ? {} : { action: buildAnswerAction(quiz, index, quizToken) }),
    contents: [
      buildChoiceBadge(index, eliminated),
      {
        type: 'text',
        text: quiz.choices[index],
        size: 'sm',
        wrap: true,
        flex: 1,
        ...(eliminated ? { color: '#AAAAAA', decoration: 'line-through' as const } : {}),
      },
    ],
  };
}

function buildQuizBody(quiz: QuizToPresent, quizToken?: number): messagingApi.FlexBox {
  const isCharacterQuiz = Boolean(quiz.speakerPersona);
  const choiceContents: messagingApi.FlexComponent[] = quiz.choices.flatMap((_choice, index) => [
    { type: 'separator', margin: 'md' } as messagingApi.FlexSeparator,
    buildChoiceRow(quiz, index, quizToken),
  ]);

  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'md',
    contents: [
      {
        type: 'text',
        text: isCharacterQuiz ? `「${quiz.question}」` : quiz.question,
        weight: 'bold',
        size: 'md',
        wrap: true,
        style: isCharacterQuiz ? 'italic' : undefined,
      },
      ...choiceContents,
      ...(quiz.referencesWikipedia
        ? [{ type: 'text', text: '参考: Wikipedia', size: 'xxs', color: '#8A94A6', margin: 'lg' } as messagingApi.FlexText]
        : []),
    ],
  };
}

// ボタンラベルは20文字制限で長い選択肢（特にダジャレ）が途中で切れるため、
// 全文はbody側のテキストで見せ、回答はA/B/Cだけの短いクイックリプライで受け取る。
function buildQuizQuickReply(quiz: QuizToPresent, quizToken?: number): messagingApi.QuickReply {
  return {
    // 2択のときは残り2つだけ。アイコンは元の番号のまま（色と記号の対応を崩さない）
    items: quiz.choices
      .map((_choice, index) => ({
        type: 'action' as const,
        imageUrl: CHOICE_ICON_URLS[index],
        action: buildAnswerAction(quiz, index, quizToken),
        index,
      }))
      .filter((item) => item.index !== quiz.eliminatedIndex)
      .map(({ index: _index, ...item }) => item),
  };
}

// 生き物を選んだ後、常についてくる「探検」用クイックリプライ（すいそうの仲間／しんせきの仲間／クイズ）。
// LINEは最後のメッセージのquickReplyしか表示しないため、withExploreQuickReplyで返信の末尾に付ける。
export function buildExploreQuickReply(animalId: string): messagingApi.QuickReply {
  return {
    items: [
      {
        type: 'action',
        action: {
          type: 'postback',
          label: 'すいそうの仲間',
          data: `action=showTankmates&animalId=${encodeURIComponent(animalId)}`,
          displayText: 'すいそうの仲間を見る',
        },
      },
      {
        type: 'action',
        action: {
          type: 'postback',
          label: 'しんせきの仲間',
          data: `action=showFamily&animalId=${encodeURIComponent(animalId)}`,
          displayText: 'しんせきの仲間を見る',
        },
      },
      {
        type: 'action',
        action: {
          type: 'postback',
          label: 'クイズ',
          data: `action=startQuiz&animalId=${encodeURIComponent(animalId)}`,
          displayText: 'クイズに挑戦する',
        },
      },
    ],
  };
}

// 返信メッセージ列の末尾に探検クイックリプライを付ける。
export function withExploreQuickReply(
  messages: messagingApi.Message[],
  animalId: string,
): messagingApi.Message[] {
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, quickReply: buildExploreQuickReply(animalId) }];
}

export interface MateCard {
  id: string;
  name: string;
  imageUrl: string;
  exhibitionName: string;
}

function buildMateBubble(headerText: string, headerColor: string, mate: MateCard): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerColor,
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: headerText,
          color: '#FFFFFF',
          weight: 'bold',
          size: 'sm',
        },
      ],
    },
    hero: {
      type: 'image',
      url: mate.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: [
        {
          type: 'text',
          text: mate.name,
          weight: 'bold',
          size: 'md',
          wrap: true,
        },
        {
          type: 'text',
          text: `🌊 ${mate.exhibitionName}展示エリア`,
          size: 'xs',
          color: '#8A94A6',
          wrap: true,
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: headerColor,
          action: {
            type: 'postback',
            label: '見つけた！',
            data: `action=selectFish&animalId=${encodeURIComponent(mate.id)}`,
            displayText: `${mate.name}を見つけた！`,
          },
        },
      ],
    },
  };
}

// 「すいそうの仲間」「しんせきの仲間」共通のカード表示（1〜3件、複数ならカルーセル）。
export function buildMatesFlexMessage(
  headerText: string,
  headerColor: string,
  mates: MateCard[],
): messagingApi.FlexMessage {
  const names = mates.map((m) => m.name).join('、');
  const contents: messagingApi.FlexContainer =
    mates.length === 1
      ? buildMateBubble(headerText, headerColor, mates[0])
      : { type: 'carousel', contents: mates.map((m) => buildMateBubble(headerText, headerColor, m)) };

  return {
    type: 'flex',
    altText: `${headerText}: ${names}`,
    contents,
  };
}

// リッチメニュー「水槽から探す」: 選んだエリアの生き物をカードで提示する。
// buildMatesFlexMessageと違い「今見ている生き物」の文脈がない(エリア起点)ため、
// 探検クイックリプライは付けない。カードの「見つけた！」ボタンは既存のbuildMateBubbleを再利用する。
export function buildExhibitionAnimalsFlexMessage(
  exhibitionName: string,
  animals: MateCard[],
): messagingApi.FlexMessage {
  const headerText = `🌊 ${exhibitionName}のなかま`;
  const headerColor = '#4A90D9';
  const names = animals.map((m) => m.name).join('、');
  const contents: messagingApi.FlexContainer =
    animals.length === 1
      ? buildMateBubble(headerText, headerColor, animals[0])
      : { type: 'carousel', contents: animals.map((m) => buildMateBubble(headerText, headerColor, m)) };

  return {
    type: 'flex',
    altText: `${headerText}: ${names}`,
    contents,
  };
}

const EXHIBITION_LIST_HEADER_COLOR = '#4A90D9';

function buildExhibitionButton(exhibition: { name: string; slug: string }): messagingApi.FlexButton {
  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: {
      type: 'postback',
      // postbackのlabelはLINE仕様上20文字まで。既存の19エリア名は収まるが念のため切り詰める。
      label: exhibition.name.length > 20 ? `${exhibition.name.slice(0, 19)}…` : exhibition.name,
      data: `action=showByExhibition&exhibition=${encodeURIComponent(exhibition.slug)}`,
      displayText: `${exhibition.name}から探す`,
    },
  };
}

// リッチメニュー「水槽から探す」: 展示エリア(19件)の一覧。件数がクイックリプライの上限(13件)を
// 超えるため、Flex Messageのボタン一覧(1列)で提示する。
export function buildExhibitionListFlexMessage(
  exhibitions: Array<{ name: string; slug: string }>,
): messagingApi.FlexMessage {
  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: EXHIBITION_LIST_HEADER_COLOR,
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: '🔍 すいそうから探す',
          color: '#FFFFFF',
          weight: 'bold',
          size: 'sm',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: exhibitions.map(buildExhibitionButton),
    },
  };

  return {
    type: 'flex',
    altText: 'すいそうから探す：エリアを選んでね',
    contents: bubble,
  };
}

export function buildNoMatesMessage(label: string): messagingApi.TextMessage {
  return {
    type: 'text',
    text: `残念、${label}の記録がまだ見つからなかったよ。`,
  };
}

export function buildAlreadyFoundMessage(animalName: string): messagingApi.TextMessage {
  return {
    type: 'text',
    text: `また会えたね、${animalName}！`,
  };
}

// requirements.md「カード生成・ガチャ演出」: 初めて見つけた生きものはガチャ演出用URLを案内する。
// LIFF本実装(#784)が完了するまでは、暫定でデプロイ済みの静的デモ(frontend/gacha-demo-03.html)を指す。
const DEFAULT_GACHA_URL =
  'https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/gacha-demo/gacha-demo-03.html';

export interface GachaAnimal {
  id: string;
  name: string;
  family: string;
  scientificName: string;
  description: string;
  imageUrl: string;
  exhibitionName: string;
}

// 選択肢バッジ(CHOICE_COLORS)と同じ配色を使い、アプリ全体でトーンを揃えた装飾ストライプ。
const DECOR_STRIPE_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD166', '#A78BFA', '#F5A623'];

function buildDecorStripe(): messagingApi.FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: DECOR_STRIPE_COLORS.map((color) => ({
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      height: '4px',
      flex: 1,
      contents: [],
    })),
  };
}

export function buildGachaFlexMessage(
  animal: GachaAnimal,
  gachaBaseUrl: string = process.env.GACHA_LIFF_URL || DEFAULT_GACHA_URL,
): messagingApi.FlexMessage {
  // gacha-demo-03.html は `?animalId=` を読んで、その生きもの固定でガチャ演出を表示する
  // (frontend/gacha-demo-03.html 参照)。ここでLINE側から実際のanimalIdを渡す。
  const gachaUrl = `${gachaBaseUrl}?animalId=${encodeURIComponent(animal.id)}`;
  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#F5A623',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: '🎉✨ はじめての発見！ ✨🎉',
          color: '#FFFFFF',
          weight: 'bold',
          size: 'sm',
          align: 'center',
        },
      ],
    },
    hero: {
      type: 'image',
      url: animal.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#FFFBF0',
      paddingAll: 'md',
      spacing: 'sm',
      contents: [
        {
          // layout:'baseline' はLINE Flex仕様上、直下にtext/icon以外(box等)を置けないため、
          // horizontalで代替する(バッジのボックスを詰めて表示するだけなのでhorizontalで十分)。
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#F5A623',
              cornerRadius: 'md',
              paddingAll: 'xs',
              contents: [
                {
                  type: 'text',
                  text: `図鑑No.${animal.id}`,
                  size: 'xxs',
                  color: '#FFFFFF',
                  weight: 'bold',
                  align: 'center',
                },
              ],
            },
          ],
        },
        {
          type: 'text',
          text: `🐟 ${animal.name}`,
          weight: 'bold',
          size: 'xl',
          margin: 'sm',
          wrap: true,
        },
        {
          type: 'text',
          text: `${animal.family} / ${animal.scientificName}`,
          size: 'xs',
          color: '#8A94A6',
          style: 'italic',
          wrap: true,
        },
        {
          type: 'text',
          text: `🌊 ${animal.exhibitionName}展示エリア`,
          size: 'xs',
          color: '#8A94A6',
          wrap: true,
        },
        buildDecorStripe(),
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#FFFFFF',
          borderWidth: '1px',
          borderColor: '#F5A623',
          cornerRadius: 'md',
          paddingAll: 'sm',
          contents: [
            {
              type: 'text',
              text: animal.description,
              size: 'sm',
              color: '#555555',
              wrap: true,
            },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#F5A623',
          action: {
            type: 'uri',
            label: '🎊 図鑑に登録する',
            uri: gachaUrl,
          },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `${animal.name}を図鑑に登録`,
    contents: bubble,
  };
}

const AQUARIUM_HEADER_COLOR = '#1E6FBA';

function formatDistance(distanceKm: number): string {
  return distanceKm < 10 ? `${distanceKm.toFixed(1)}km` : `${Math.round(distanceKm)}km`;
}

function buildRouteText(route: AquariumRoute): string {
  const parts = [`${route.minutes}分`, `乗換${route.transferCount}回`];
  if (route.fareYen !== undefined) parts.push(`${route.fareYen}円`);
  return `🚃 ${route.fromStationName}から ${parts.join(' / ')}`;
}

function buildAquariumBubble(
  headerText: string,
  aquarium: NearbyAquarium,
  route?: AquariumRoute,
): messagingApi.FlexBubble {
  const bodyContents: messagingApi.FlexComponent[] = [
    { type: 'text', text: aquarium.name, weight: 'bold', size: 'lg', wrap: true },
    {
      type: 'text',
      text: `${aquarium.prefecture} ・ 直線 ${formatDistance(aquarium.distanceKm)}`,
      size: 'xs',
      color: '#8A94A6',
      wrap: true,
    },
    { type: 'text', text: aquarium.address, size: 'xs', color: '#8A94A6', wrap: true },
    { type: 'separator', margin: 'md' },
    { type: 'text', text: `🚉 ${aquarium.access}`, size: 'sm', wrap: true, margin: 'md' },
  ];

  // 経路は取れたときだけ行ごと足す（取れないときの説明はジンベエ名誉教授のセリフが担当する）。
  if (route) {
    bodyContents.push({ type: 'text', text: buildRouteText(route), size: 'sm', wrap: true });
  }

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: AQUARIUM_HEADER_COLOR,
      paddingAll: 'md',
      contents: [
        { type: 'text', text: headerText, color: '#FFFFFF', weight: 'bold', size: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: AQUARIUM_HEADER_COLOR,
          action: { type: 'uri', label: '公式サイト', uri: aquarium.url },
        },
      ],
    },
  };
}

// 最寄り1館(経路つき)＋次点候補を並べる。経路検索は1位のみなので、次点はカードの経路行が出ない。
export function buildAquariumFlexMessage(result: NearestAquariumResult): messagingApi.FlexMessage {
  const first = buildAquariumBubble('🌊 いちばん近い水族館', result.nearest, result.route);
  const contents: messagingApi.FlexContainer =
    result.others.length === 0
      ? first
      : {
          type: 'carousel',
          contents: [first, ...result.others.map((a) => buildAquariumBubble('ほかの候補', a))],
        };

  return {
    type: 'flex',
    altText: `いちばん近い水族館: ${result.nearest.name}（直線${formatDistance(result.nearest.distanceKm)}）`,
    contents,
  };
}

export interface StationAquariumItem {
  name: string;
  prefecture: string;
  address: string;
  station: string;
  access: string;
  url: string;
  distanceKm?: number;
  travelMinutes?: number;
  transferCount?: number;
}

export interface StationAquariumResultPresentation {
  scenario: 'nearest' | 'travel_time';
  baseStationName: string;
  aquariums: StationAquariumItem[];
}

function buildStationAquariumBubble(
  item: StationAquariumItem,
  baseStationName: string,
  scenario: 'nearest' | 'travel_time',
  index: number,
): messagingApi.FlexBubble {
  const isS2 = scenario === 'travel_time' && item.travelMinutes !== undefined;

  const headerText = isS2
    ? `🚃 所要時間 約${item.travelMinutes}分`
    : index === 0
      ? '🌊 1番目に近い水族館'
      : 'ほかの候補';

  const subText = isS2
    ? `${item.prefecture} ・ 乗換${item.transferCount ?? 0}回`
    : item.distanceKm !== undefined
      ? `${item.prefecture} ・ 直線 ${formatDistance(item.distanceKm)}`
      : item.prefecture;

  const bodyContents: messagingApi.FlexComponent[] = [
    { type: 'text', text: item.name, weight: 'bold', size: 'lg', wrap: true },
    { type: 'text', text: subText, size: 'xs', color: '#8A94A6', wrap: true },
    { type: 'text', text: item.address, size: 'xs', color: '#8A94A6', wrap: true },
    { type: 'separator', margin: 'md' },
    { type: 'text', text: `🚉 ${item.access}`, size: 'sm', wrap: true, margin: 'md' },
  ];

  if (isS2) {
    bodyContents.push({
      type: 'text',
      text: `🚃 ${baseStationName}から 約${item.travelMinutes}分（乗換${item.transferCount ?? 0}回）`,
      size: 'sm',
      wrap: true,
    });
  }

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: AQUARIUM_HEADER_COLOR,
      paddingAll: 'md',
      contents: [{ type: 'text', text: headerText, color: '#FFFFFF', weight: 'bold', size: 'sm' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: AQUARIUM_HEADER_COLOR,
          action: { type: 'uri', label: '公式サイト', uri: item.url },
        },
      ],
    },
  };
}

export function buildStationAquariumFlexMessage(
  presentation: StationAquariumResultPresentation,
): messagingApi.FlexMessage {
  const { scenario, baseStationName, aquariums } = presentation;
  const bubbles = aquariums.map((item, index) =>
    buildStationAquariumBubble(item, baseStationName, scenario, index),
  );

  const contents: messagingApi.FlexContainer =
    bubbles.length === 1
      ? bubbles[0]
      : {
          type: 'carousel',
          contents: bubbles,
        };

  const names = aquariums.map((a) => a.name).join('、');
  const altText =
    scenario === 'nearest'
      ? `「${baseStationName}」から近い水族館: ${names}`
      : `「${baseStationName}」から行ける水族館: ${names}`;

  return {
    type: 'flex',
    altText,
    contents,
  };
}

export function buildQuizFlexMessage(quiz: QuizToPresent, quizToken?: number): messagingApi.FlexMessage {
  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    header: buildQuizHeader(quiz),
    body: buildQuizBody(quiz, quizToken),
  };

  return {
    type: 'flex',
    altText: quiz.question,
    contents: bubble,
    quickReply: buildQuizQuickReply(quiz, quizToken),
  };
}
