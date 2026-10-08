import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { middleware, messagingApi, webhook } from "@line/bot-sdk";
import type { Readable } from "node:stream";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firestore.js";
import { uploadImageToGCS } from "./storage.js";
import { readPanelFromImage } from "./identifyFish.js";
import {
  findAnimalById,
  type KaiyukanAnimal,
  findTankmates,
  findFamilyMates,
  findTankmateNames,
  findFamilyMateNames,
  findAnimalsByExhibition,
  listExhibitions,
  toAbsoluteImageUrl,
  getExhibitionName,
  searchAnimalsByName,
  searchExhibitionsByName,
  normalizeAnimalName,
} from "./kaiyukanData.js";
import {
  generateQuizForAnimal,
  planQuizCategory,
  QUIZ_HISTORY_WINDOW,
  QUIZ_PROMPT_VERSION,
  type QuizQuestion,
  type QuizCategory,
  type QuizHistoryEntry,
} from "./quiz.js";
import { generateQuizWithAgent, toHistoryCandidates, type AgentQuizCandidate } from "./quizAgent.js";
import { logEvent, hashId, withLogContext, parseTraceHeader } from "./log.js";
import { runAgent, logGuard, type AgentRunRecord } from "./agentRun.js";
import {
  QUIZ_POOL_VERSION,
  findPoolCandidates,
  getQuizPool,
  hasPool,
  toAgentCandidates,
  type PoolMissReason,
  type QuizPool,
} from "./quizPool.js";
import { selectPoolQuestion } from "./quizPoolSelector.js";
import { claimWebhookEvent, getRuntimeConfig, truncateUserText, MAX_USER_TEXT_CHARS } from "./guards.js";
import {
  DEFAULT_QUIZ_LEVEL,
  LEVEL_EXCLUDED_CATEGORIES,
  applyFinishedAnswer,
  filterCategoriesForLevel,
  levelChangeLine,
  normalizeProfile,
  type LevelDecision,
  type QuizLevel,
  type QuizProfile,
} from "./quizLevel.js";
import { decideQuizLevel } from "./quizLevelAgent.js";
import { decideAnswerOutcome, type PendingAnswerState } from "./quizAnswer.js";
import { fallbackHint, generateQuizHint, type QuizHintResult } from "./quizHint.js";
import {
  buildCandidatesFlexMessage,
  buildQuizFlexMessage,
  buildNotFoundFlexMessage,
  buildGachaFlexMessage,
  buildMatesFlexMessage,
  buildNoMatesMessage,
  buildAlreadyFoundMessage,
  withExploreQuickReply,
  buildExhibitionAnimalsFlexMessage,
  buildExhibitionListFlexMessage,
  buildAquariumFlexMessage,
  buildStationAquariumFlexMessage,
  type MateCard,
} from "./flexMessages.js";
import {
  classifyStationAquariumIntent,
  runStationAquariumAgent,
  toPresentationResult,
} from "./stationAquariumAgent.js";
import { findNearestAquariumWithRoute } from "./nearestAquarium.js";
import { characterLine } from "./characters.js";
import { buildWelcomeMessages } from "./welcomeMessage.js";
import { generateCharacterChat } from "./characterChat.js";
import { corsMiddleware, handleDemoAuth, handleLineAuth, jsonBodyErrorHandler } from "./lineAuth.js";

const channelSecret = process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelSecret) throw new Error("LINE_CHANNEL_SECRET が設定されていません");
if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません");

// reply / push を送るたびに reply_sent を1行出す（#832 A1）。メッセージ本文は出さず、件数と成否だけ。
function withSendLog(raw: messagingApi.MessagingApiClient): messagingApi.MessagingApiClient {
  return new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop !== "replyMessage" && prop !== "pushMessage") return typeof value === "function" ? value.bind(target) : value;
      const via = prop === "replyMessage" ? "reply" : "push";
      return async (request: { messages: unknown[] }, ...rest: unknown[]) => {
        const messageCount = request.messages.length;
        try {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).call(target, request, ...rest);
          logEvent("reply_sent", { via, messageCount, ok: true, message: `LINEへ送信しました (${via})` });
          return result;
        } catch (error) {
          logEvent("reply_sent", { via, messageCount, ok: false, error, message: `LINEへの送信に失敗しました (${via})` }, "ERROR");
          throw error;
        }
      };
    },
  });
}

const client = withSendLog(new messagingApi.MessagingApiClient({ channelAccessToken }));
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

// design.md 1.2節: 1:1トーク上のユーザー起点イベントのみ扱う（グループ/ルーム経由は無視）
function getUserId(event: webhook.Event): string | undefined {
  return event.source?.type === "user" ? event.source.userId : undefined;
}

function pendingQuizRef(userId: string, animalId: string) {
  return db.doc(`users/${userId}/pendingQuiz/${animalId}`);
}

function collectionRef(userId: string, animalId: string) {
  return db.doc(`users/${userId}/collection/${animalId}`);
}

// docs/specs/791-quiz-history: 回答済みの出題履歴（自動ID）。出題カテゴリの選定と、LIFF図鑑の履歴表示に使う。
function quizHistoryCollection(userId: string, animalId: string) {
  return db.collection(`users/${userId}/animals/${animalId}/quizHistory`);
}

// 停止スイッチ（#832 C5）。止まっている機能なら定型文で応答して true を返す（Firestore の config/runtime。60秒キャッシュ）。
async function replyIfDisabled(
  target: "quiz" | "station" | "chat" | "identify",
  replyToken: string,
  fixedText: string,
): Promise<boolean> {
  const config = await getRuntimeConfig();
  if (!config.disabledAgents.has(target)) return false;
  logGuard(target, "kill_switch", "skipped");
  await client.replyMessage({
    replyToken,
    messages: [characterLine("dr-jinbei", "think", config.maintenanceMessage ?? fixedText)],
  });
  return true;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// 画像の識別(Gemini Vision)は時間がかかるため、先にreplyTokenで「解析中」を即返信し、
// 結果は完了後にpushMessageで送る（駅からの水族館調査と同じ待たせ方）。
async function handleImageMessage(replyToken: string, userId: string, messageId: string): Promise<void> {
  if (await replyIfDisabled("identify", replyToken, "むむ、今は写真を読む機械がお休み中じゃ。しばらくしてからまた送っておくれ。")) return;
  logEvent("image_received", { messageIdHash: hashId(messageId), message: "写真を受け取りました" });
  await client.replyMessage({
    replyToken,
    messages: [characterLine("kawauso", "think", "写真データ受信っす！ただちに解析中っす、ちょっと待っててほしいっす！")],
  });

  try {
    const content = await blobClient.getMessageContent(messageId);
    const buffer = await streamToBuffer(content);

    // GCSへの保存と生きもの識別(Gemini Vision)は互いの結果に依存しないため並列化する
    // (以前はuploadを待ってからidentifyしていたが、直列にする理由がなかった)。
    const [, { candidates, exhibitions }] = await Promise.all([
      uploadImageToGCS({
        buffer,
        destFileName: `line-images/${messageId}.jpg`,
        contentType: "image/jpeg",
      }),
      readPanelFromImage(buffer, "image/jpeg"),
    ]);

    // 種名が読めず、水槽の看板（例: グレート・バリア・リーフ）だけ読めたときは「水槽から探す」と同じ動き
    if (candidates.length === 0 && exhibitions.length > 0) {
      logEvent("image_exhibition_found", { messageIdHash: hashId(messageId), hits: exhibitions.length });
      const messages: messagingApi.Message[] =
        exhibitions.length === 1
          ? [
              characterLine("kawauso", "happy", `${exhibitions[0].name}の水槽っすね！ここにいる子を見せるっす！`),
              ...(await buildExhibitionAnimalsMessages(exhibitions[0].slug)),
            ]
          : [
              characterLine("kawauso", "happy", `水槽の名前が${exhibitions.length}つ写ってたっす！どの水槽っすか？`),
              buildExhibitionListFlexMessage(exhibitions),
            ];
      await client.pushMessage({ to: userId, messages });
      return;
    }

    if (candidates.length === 0) {
      await client.pushMessage({
        to: userId,
        messages: [
          characterLine("kawauso", "think", "うーん……図鑑と照らし合わせたっすけど……"),
          buildNotFoundFlexMessage(),
        ],
      });
      return;
    }

    const foundLine =
      candidates.length === 1 ? "解析完了っす！出たっす！" : `解析完了っす！${candidates.length}件見つかったっす！`;

    await client.pushMessage({
      to: userId,
      messages: [characterLine("kawauso", "happy", foundLine), buildCandidatesFlexMessage(candidates)],
    });
  } catch (error) {
    logEvent("image_identify_failed", { messageIdHash: hashId(messageId), error, message: "画像の解析に失敗しました" }, "ERROR");
    await client.pushMessage({
      to: userId,
      messages: [
        characterLine("dr-jinbei", "think", "むむ、写真がうまく読み取れなんだ。すまんが、もう一度送っておくれ。"),
      ],
    });
  }
}

// 生き物を選んだ直後の入口。design.mdの「初めて見つけた生きものはガチャ演出」の判定を
// (以前はクイズ回答後に行っていたが)ここに前倒しする。以降どのカテゴリに進むかは
// 「仲間を見る」「クイズ」のクイックリプライでユーザー自身が選ぶ「気まま」な探索フローにする。
// 文字で送られた名前を水槽（展示エリア）の名前と部分一致で照合する。
// 1件ならリッチメニューの「水槽から探す」でエリアを選んだときと同じ生きものカード、複数なら当たった水槽だけのボタン一覧
async function replyIfExhibitionMatches(replyToken: string, text: string): Promise<boolean> {
  const exhibitions = await searchExhibitionsByName(text);
  if (exhibitions.length === 0) return false;
  logEvent("exhibition_search", { queryChars: text.length, hits: exhibitions.length });
  if (exhibitions.length === 1) {
    await handleShowByExhibition(replyToken, exhibitions[0].slug);
    return true;
  }
  await client.replyMessage({
    replyToken,
    messages: [
      characterLine("kawauso", "happy", `「${text}」の水槽は${exhibitions.length}つあるっす！どの水槽っすか？`),
      buildExhibitionListFlexMessage(exhibitions),
    ],
  });
  return true;
}

// 文字で送られた名前を海遊館の生きものと部分一致で照合する。1件以上当たれば候補カードを返して true
async function replyIfNameMatches(replyToken: string, text: string): Promise<boolean> {
  // カードは最大10枚。11件目があるかで「10匹以上」と言い分ける
  const MAX_CARDS = 10;
  const hits = await searchAnimalsByName(text, MAX_CARDS + 1);
  if (hits.length === 0) return false;
  const query = normalizeAnimalName(text);
  const candidates = await Promise.all(
    hits.slice(0, MAX_CARDS).map(async (animal) => ({
      id: animal.id,
      // 元データの名前に <br> が入っている種がある（ミナミイワトビ<br>ペンギン）
      name: animal.name.replace(/<br\s*\/?>/gi, ""),
      imageUrl: toAbsoluteImageUrl(animal.img),
      confidence: normalizeAnimalName(animal.name) === query ? ("high" as const) : ("low" as const),
      exhibitionName: await getExhibitionName(animal.mainExhibition),
    })),
  );
  logEvent("name_search", { queryChars: text.length, hits: hits.length });
  const line =
    candidates.length === 1
      ? "この子っすね！見つけたら登録するっす！"
      : hits.length > MAX_CARDS
        ? `名前に「${text}」が入る子がたくさんいたっす！近い順に${MAX_CARDS}匹出すっす！`
        : `名前に「${text}」が入る子が${candidates.length}匹いたっす！どの子っすか？`;
  await client.replyMessage({
    replyToken,
    messages: [characterLine("kawauso", "happy", line), buildCandidatesFlexMessage(candidates)],
  });
  return true;
}

async function handleSelectFish(replyToken: string, userId: string, animalId: string): Promise<void> {
  const animal = await findAnimalById(animalId);
  if (!animal) {
    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "その生きものの情報が見つからなかったよ。" }],
    });
    return;
  }

  const colRef = collectionRef(userId, animalId);
  const isFirstFind = await db.runTransaction(async (tx) => {
    const snap = await tx.get(colRef);
    if (snap.exists) {
      tx.update(colRef, { updatedAt: Timestamp.now() });
      return false;
    }
    tx.set(colRef, {
      name: animal.name,
      firstFoundAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      rarity: "unknown",
      knowledgeUnlocked: {},
      completed: false,
    });
    return true;
  });

  // WHEN 同じ生き物を2回目以降見つける THEN system SHALL ガチャ演出なしで通常のカード返却のみ行う
  const message = isFirstFind
    ? buildGachaFlexMessage({
        id: animalId,
        name: animal.name,
        family: animal.family,
        scientificName: animal.scientificName,
        description: animal.description,
        imageUrl: toAbsoluteImageUrl(animal.img),
        exhibitionName: await getExhibitionName(animal.mainExhibition),
      })
    : buildAlreadyFoundMessage(animal.name);

  await client.replyMessage({
    replyToken,
    messages: withExploreQuickReply(
      [characterLine("dr-jinbei", "happy", "ふむ、ワシの仲間の写真じゃな。上手に撮れておるぞい。"), message],
      animalId,
    ),
  });
}

async function toMateCard(animal: { id: string; name: string; img: string; mainExhibition: string }): Promise<MateCard> {
  return {
    id: animal.id,
    name: animal.name,
    imageUrl: toAbsoluteImageUrl(animal.img),
    exhibitionName: await getExhibitionName(animal.mainExhibition),
  };
}

async function handleShowTankmates(replyToken: string, animalId: string): Promise<void> {
  const tankmates = await findTankmates(animalId, 3);
  if (tankmates.length === 0) {
    await client.replyMessage({
      replyToken,
      messages: withExploreQuickReply([buildNoMatesMessage("すいそうの仲間")], animalId),
    });
    return;
  }

  const cards = await Promise.all(tankmates.map(toMateCard));
  await client.replyMessage({
    replyToken,
    messages: withExploreQuickReply([buildMatesFlexMessage("🔍 すいそうの仲間", "#4A90D9", cards)], animalId),
  });
}

async function handleShowFamily(replyToken: string, animalId: string): Promise<void> {
  const familyMates = await findFamilyMates(animalId, 3);
  if (familyMates.length === 0) {
    await client.replyMessage({
      replyToken,
      messages: withExploreQuickReply([buildNoMatesMessage("しんせきの仲間")], animalId),
    });
    return;
  }

  const cards = await Promise.all(familyMates.map(toMateCard));
  await client.replyMessage({
    replyToken,
    messages: withExploreQuickReply([buildMatesFlexMessage("🧬 しんせきの仲間", "#8E7CC3", cards)], animalId),
  });
}

// リッチメニュー「水槽から探す」入口。19展示エリアの一覧を提示し、ユーザーにエリアを選ばせる。
async function handleBrowseExhibitions(replyToken: string): Promise<void> {
  const exhibitions = await listExhibitions();
  await client.replyMessage({
    replyToken,
    messages: [
      characterLine("kawauso", "happy", "どのすいそうから探すっすか？"),
      buildExhibitionListFlexMessage(exhibitions),
    ],
  });
}

// エリア選択後: そのエリア(mainExhibition一致)の生き物からランダムに3件をカードで提示する。
// 返信内容は、リッチメニュー・文字の水槽名（reply）と写真の水槽の看板（push）で共通
async function buildExhibitionAnimalsMessages(exhibitionSlug: string): Promise<messagingApi.Message[]> {
  const animals = await findAnimalsByExhibition(exhibitionSlug, 3);
  if (animals.length === 0) {
    return [{ type: "text", text: "そのすいそうの生きものが見つからなかったよ。" }];
  }
  const exhibitionName = await getExhibitionName(exhibitionSlug);
  const cards = await Promise.all(animals.map(toMateCard));
  return [buildExhibitionAnimalsFlexMessage(exhibitionName, cards)];
}

async function handleShowByExhibition(replyToken: string, exhibitionSlug: string): Promise<void> {
  await client.replyMessage({ replyToken, messages: await buildExhibitionAnimalsMessages(exhibitionSlug) });
}

// 直近の回答済みクイズ（新しい順、最大QUIZ_HISTORY_WINDOW件）。カテゴリ選定(planQuizCategory)の入力。
// 取得に失敗しても出題は止めない: []を返し、全カテゴリを候補にして続行する（出し直しの判定はできない）。
async function getRecentQuizHistory(userId: string, animalId: string): Promise<QuizHistoryEntry[]> {
  try {
    const snap = await quizHistoryCollection(userId, animalId)
      .orderBy("askedAt", "desc")
      .limit(QUIZ_HISTORY_WINDOW)
      .get();
    return snap.docs.map((doc) => {
      const data = doc.data();
      return { category: data.category as QuizCategory, isCorrect: data.isCorrect === true };
    });
  } catch (error) {
    logEvent("quiz_history_read_failed", { animalId, error, message: "クイズ履歴の取得に失敗しました" }, "WARNING");
    return [];
  }
}

function userRef(userId: string) {
  return db.doc(`users/${userId}`);
}

// ログは log.ts の logEvent（1行JSON・severity付き・nullは"none"・userIdHashは文脈から付く。design 3.1）
const logQuizEvent = (event: string, fields: Record<string, unknown>): void => logEvent(event, fields);

// Firestore の Timestamp を QuizRecentEntry の Date に直してから normalizeProfile に渡す
function toProfileRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as { recent?: unknown };
  if (!Array.isArray(obj.recent)) return raw;
  return {
    ...obj,
    recent: obj.recent.map((entry) => {
      const e = entry as { at?: unknown };
      return e && typeof e === "object" && e.at instanceof Timestamp ? { ...e, at: e.at.toDate() } : entry;
    }),
  };
}

// 学習状況。読み取りに失敗しても出題は止めない（レベル2の初期状態で続行）
async function getQuizProfile(userId: string): Promise<QuizProfile> {
  try {
    const snap = await userRef(userId).get();
    return normalizeProfile(toProfileRaw(snap.data()?.quizProfile));
  } catch (error) {
    logEvent("quiz_profile_read_failed", { error, message: "学習状況の取得に失敗しました（レベル2で続行）" }, "WARNING");
    return normalizeProfile(undefined);
  }
}

interface ObtainedQuiz {
  quiz: QuizQuestion;
  generatedBy: "live-single" | "live-agent" | "pool";
  selectionReason?: string;
  consideredCategories?: AgentQuizCandidate[];
  /** この問題を作ったエージェント1回のID（agent_run とつなぐ）。規則の出題では無い */
  runId?: string;
  /** コードが介入した種別（candidate_replaced / fallback_rule / kill_switch） */
  guard?: string;
  // #831: 作り置き。プールから出したときだけ poolId 等が入る。poolMissReason は出せたら "none"
  poolId?: string;
  consideredPoolIds?: string[];
  selectedBy?: "agent" | "rule";
  poolExplanation?: string;
  poolMissReason?: PoolMissReason | "kill_switch" | "load_failed" | "history_read_failed";
  poolCandidateCount?: number;
  poolFallbackCause?: string;
}

// #831: 出題に要る作り置きの文脈。プールの読み込み・停止スイッチ・その人が出題済みの作り置き ID を1回で集める
interface PoolContext {
  pool: QuizPool;
  poolDisabled: boolean;
  quizDisabled: boolean;
  /** 読めなかったときは null（同じ問題を出さないことを優先してプールを使わない） */
  askedPoolIds: Set<string> | null;
}

async function loadPoolContext(userId: string, animalId: string): Promise<PoolContext> {
  const [pool, config] = await Promise.all([getQuizPool(), getRuntimeConfig()]);
  const poolDisabled = config.disabledAgents.has("quiz_pool");
  const quizDisabled = config.disabledAgents.has("quiz");
  let askedPoolIds: Set<string> | null = new Set();
  // 作り置きがある生きものだけ、出題済みの作り置き ID を読む（他の生きものは読み取りを増やさない）
  if (!poolDisabled && hasPool(pool, animalId)) {
    try {
      const snap = await quizHistoryCollection(userId, animalId).where("generatedBy", "==", "pool").select("poolId").get();
      for (const doc of snap.docs) {
        const id = doc.data().poolId;
        if (typeof id === "string") askedPoolIds.add(id);
      }
    } catch (error) {
      logEvent("quiz_pool_history_read_failed", { animalId, error, message: "作り置きの出題済みの取得に失敗しました（その場で作ります）" }, "WARNING");
      askedPoolIds = null;
    }
  }
  return { pool, poolDisabled, quizDisabled, askedPoolIds };
}

// 決定論的に1カテゴリの問題を作る（出し直し・エージェント失敗時・停止スイッチ時の共通経路）。
// design.md 3.3節: 「類似した仲間」「同じ水槽にいる魚」は実在する種名でグラウンディングする
async function generateRuleQuiz(animal: KaiyukanAnimal, category: QuizCategory, level: QuizLevel): Promise<QuizQuestion> {
  const groundingNames =
    category === "類似した仲間"
      ? await findFamilyMateNames(animal.id)
      : category === "同じ水槽にいる魚"
        ? await findTankmateNames(animal.id)
        : [];
  // 誤答に混ぜてはいけない「同じ展示／同じ科の全種名」
  const avoidNames =
    category === "類似した仲間"
      ? await findFamilyMateNames(animal.id, Infinity)
      : category === "同じ水槽にいる魚"
        ? await findTankmateNames(animal.id, Infinity)
        : [];
  return generateQuizForAnimal(animal, category, groundingNames, undefined, level, avoidNames);
}

// 問題の取得口（#829 design 8.1 / #831 design 3.3）。先に作り置きを引き、無ければ今の「その場で作る」に落ちる。
async function obtainQuiz(args: {
  animal: KaiyukanAnimal;
  plan: ReturnType<typeof planQuizCategory>;
  level: QuizLevel;
  candidates: readonly QuizCategory[];
  poolCtx: PoolContext;
  recent: QuizHistoryEntry[];
  profile: QuizProfile;
}): Promise<ObtainedQuiz> {
  const { animal, plan, level, candidates, poolCtx, recent, profile } = args;
  let missReason: NonNullable<ObtainedQuiz["poolMissReason"]>;
  if (poolCtx.poolDisabled) {
    missReason = "kill_switch";
  } else if (poolCtx.pool.stats.files === 0) {
    missReason = "load_failed";
  } else if (!hasPool(poolCtx.pool, animal.id)) {
    missReason = "no_pool_for_animal";
  } else if (poolCtx.askedPoolIds === null) {
    missReason = "history_read_failed";
  } else {
    const found = findPoolCandidates({
      pool: poolCtx.pool,
      animalId: animal.id,
      plan,
      level,
      allowed: plan.kind === "retry" ? [plan.category] : filterCategoriesForLevel(candidates, level),
      askedPoolIds: poolCtx.askedPoolIds,
    });
    if (found.candidates.length > 0) return obtainFromPool(animal, plan, level, found.candidates, poolCtx, recent, profile);
    missReason = found.missReason;
  }
  const live = await obtainLiveQuiz({ animal, plan, level, candidates });
  return { ...live, poolMissReason: missReason };
}

// 作り置きから出す。retry は 1問をコードで、fresh は 1件ならそのまま・2件以上は選択エージェント（5秒、失敗は規則）
async function obtainFromPool(
  animal: KaiyukanAnimal,
  plan: ReturnType<typeof planQuizCategory>,
  level: QuizLevel,
  poolCandidates: ReturnType<typeof findPoolCandidates>["candidates"],
  poolCtx: PoolContext,
  recent: QuizHistoryEntry[],
  profile: QuizProfile,
): Promise<ObtainedQuiz> {
  let chosen = poolCandidates[0];
  let selectedBy: "agent" | "rule" = "rule";
  let selectionReason = "同じカテゴリの作り置きをそのまま出題";
  let fallbackCause: string | null = plan.kind === "retry" ? "retry_by_code" : "single_candidate";
  let runId: string | null = null;
  if (plan.kind === "fresh" && poolCandidates.length > 1) {
    const sel = await selectPoolQuestion({
      animal: { id: animal.id, name: animal.name },
      level,
      recentForAnimal: recent.map((r) => ({ category: r.category, isCorrect: r.isCorrect })),
      recentOverall: profile.recent.map((r) => ({ category: r.category, isCorrect: r.isCorrect, hintUsed: r.hintUsed })),
      candidates: poolCandidates.map((q) => ({
        id: q.id,
        category: q.category,
        question: q.question,
        grounded: q.factSource === "official" || q.factSource === "wikipedia",
      })),
      killSwitch: poolCtx.quizDisabled,
    });
    chosen = poolCandidates.find((q) => q.id === sel.chosenId) ?? poolCandidates[0];
    selectedBy = sel.selectedBy;
    selectionReason = sel.reason;
    fallbackCause = sel.fallbackCause;
    runId = sel.runId;
  } else if (plan.kind === "fresh") {
    selectionReason = "候補が1件のためそのまま出題";
  }
  const guard =
    fallbackCause === "kill_switch" || fallbackCause === "candidate_replaced"
      ? fallbackCause
      : fallbackCause === "schema_invalid" || fallbackCause === "timeout" || fallbackCause === "error"
        ? "fallback_rule"
        : undefined;
  return {
    quiz: {
      animalId: animal.id,
      category: chosen.category,
      question: chosen.question,
      choices: [...chosen.choices],
      correctIndex: chosen.correctIndex,
      speakerPersona: chosen.category === "ダジャレ" ? "ジンベエ名誉教授" : undefined,
      level,
      generatedBy: "pool",
      promptVersion: QUIZ_POOL_VERSION,
    },
    generatedBy: "pool",
    selectionReason,
    consideredCategories: toAgentCandidates(poolCandidates),
    runId: runId ?? undefined,
    guard,
    poolId: chosen.id,
    consideredPoolIds: poolCandidates.map((q) => q.id),
    selectedBy,
    poolExplanation: chosen.explanation,
    poolMissReason: "none",
    poolCandidateCount: poolCandidates.length,
    poolFallbackCause: fallbackCause ?? undefined,
  };
}

// 今の「その場で作る」経路（#829 まで）。作り置きに当たらなかったときに使う
async function obtainLiveQuiz(args: {
  animal: KaiyukanAnimal;
  plan: ReturnType<typeof planQuizCategory>;
  level: QuizLevel;
  candidates: readonly QuizCategory[];
}): Promise<ObtainedQuiz> {
  const { animal, plan, level, candidates } = args;
  if (plan.kind === "retry") {
    // 出し直しは決定論的に同カテゴリを再生成するだけで十分なので、ADKエージェントは呼ばない(往復を増やさない)。
    const quiz = await generateRuleQuiz(animal, plan.category, level);
    return { quiz, generatedBy: "live-single" };
  }
  // 正解した／まだ何も答えていない「新しいカテゴリを選ぶ」場面では、ADKエージェントに候補カテゴリを
  // 自律的に検討させて1つ選ばせる(design.md 3章)。そのレベルで出さないカテゴリはコードで除く。
  const allowed = filterCategoriesForLevel(candidates, level);

  // 停止スイッチ（C5）: エージェントを呼ばず、候補の先頭カテゴリを規則で出題する。agent_run(outcome=kill_switch)に残す
  if ((await getRuntimeConfig()).disabledAgents.has("quiz")) {
    return runAgent({ agent: "quiz", model: "rule", promptVersion: QUIZ_PROMPT_VERSION, fields: { animalId: animal.id } }, async (ctx) => {
      ctx.setOutcome("kill_switch");
      ctx.guard("kill_switch", "fell_back", "規則の出題に切り替え");
      const quiz = await generateRuleQuiz(animal, allowed[0], level);
      return { quiz, generatedBy: "live-single" as const, guard: "kill_switch" };
    });
  }

  try {
    const agentResult = await generateQuizWithAgent(animal, allowed, level);
    return {
      quiz: agentResult.quiz,
      generatedBy: "live-agent",
      selectionReason: agentResult.selectionReason,
      consideredCategories: agentResult.consideredCategories,
      runId: agentResult.runId,
      guard: agentResult.guard ?? undefined,
    };
  } catch (error) {
    // 時間切れ(45秒)・失敗・出力の形式不正（C6）: 遊びを止めず、規則の出題に切り替える
    const failedRunId = (error as { agentRunId?: string }).agentRunId;
    logGuard("quiz", "fallback_rule", "fell_back", error instanceof Error ? error.name : "error", { failedRunId: failedRunId ?? null });
    const quiz = await generateRuleQuiz(animal, allowed[0], level);
    return { quiz, generatedBy: "live-single", guard: "fallback_rule" };
  }
}

async function handleStartQuiz(replyToken: string, userId: string, animalId: string): Promise<void> {
  const requestedAt = Date.now(); // quiz_delivered.totalMs の起点（「考え中」の reply より前）
  // 生成に時間がかかる(ADK経路は約24秒)ため、先にreplyTokenで「考え中」を即返信し、
  // 出題は完了後にpushMessageで送る（画像解析・駅からの水族館調査と同じ待たせ方）。
  await client.replyMessage({
    replyToken,
    messages: [characterLine("kawauso", "think", "ちょっと待っててほしいっす！いま調査クイズを考え中っす……")],
  });

  try {
    // findAnimalById(キャッシュ済み配列からの検索)・getRecentQuizHistory・getQuizProfile(Firestore読み取り)は
    // 互いの結果に依存しないため並列化する。
    const [animal, recent, profile, poolCtx] = await Promise.all([
      findAnimalById(animalId),
      getRecentQuizHistory(userId, animalId),
      getQuizProfile(userId),
      loadPoolContext(userId, animalId),
    ]);
    if (!animal) {
      await client.pushMessage({
        to: userId,
        messages: [{ type: "text", text: "その生きものの情報が見つからなかったよ。" }],
      });
      return;
    }

    // 難易度の決定（例外を投げない。失敗しても規則・据え置きで必ず決まる）
    const decision = await decideQuizLevel(profile);
    const level = decision.to;
    const userIdHash = hashId(userId);
    logQuizEvent("quiz_level_decision", {
      userIdHash,
      animalId,
      ...decision,
      agreesWithRule: decision.to === decision.ruleTo,
    });

    // カテゴリ選定ルール(docs/specs/791-quiz-history): 直前の回答が不正解なら同じカテゴリーで出し直す
    // （正解するまで同じカテゴリー）。それ以外は、その生きものの過去5問とカテゴリが被らないものを候補にする。
    const plan = planQuizCategory(recent);
    const candidates = plan.kind === "retry" ? [plan.category] : plan.candidates;
    const excludedCategories = LEVEL_EXCLUDED_CATEGORIES[level].filter((c) => plan.kind !== "retry" && candidates.includes(c));

    const startedAt = Date.now();
    const obtained = await obtainQuiz({ animal, plan, level, candidates, poolCtx, recent, profile });
    const quiz: QuizQuestion = {
      ...obtained.quiz,
      level,
      generatedBy: obtained.generatedBy,
      promptVersion: obtained.quiz.promptVersion ?? QUIZ_PROMPT_VERSION,
    };
    logQuizEvent("quiz_generated", {
      userIdHash,
      animalId,
      level,
      category: quiz.category,
      generatedBy: obtained.generatedBy,
      runId: obtained.runId ?? null,
      guard: obtained.guard ?? null,
      poolId: obtained.poolId ?? null,
      selectedBy: obtained.selectedBy ?? null,
      poolCandidateCount: obtained.poolCandidateCount ?? null,
      poolMissReason: obtained.poolMissReason ?? null,
      poolFallbackCause: obtained.poolFallbackCause ?? null,
      promptVersion: quiz.promptVersion,
      excludedCategories: excludedCategories.length > 0 ? excludedCategories : "none",
      latencyMs: Date.now() - startedAt,
    });

    const quizToken = await savePendingQuiz(userId, animalId, quiz, decision, profile, obtained);
    const intro =
      plan.kind === "retry"
        ? "教授も太鼓判っす！それでは調査クイズを発動するっすよ！"
        : "お待たせっす！クイズができたっすよ！";

    const changeLine = levelChangeLine(decision.from, decision.to);
    await client.pushMessage({
      to: userId,
      messages: [
        ...(changeLine ? [characterLine(changeLine.character, changeLine.expression, changeLine.text)] : []),
        characterLine("kawauso", "happy", intro),
        buildQuizFlexMessage({ ...quiz, referencesWikipedia: Boolean(animal.wikipedia) }, quizToken),
      ],
    });
    logQuizEvent("quiz_delivered", {
      userIdHash,
      animalId,
      generatedBy: obtained.generatedBy,
      poolId: obtained.poolId ?? null,
      level,
      category: quiz.category,
      totalMs: Date.now() - requestedAt,
    });
  } catch (error) {
    logEvent("quiz_generate_failed", { animalId, error, message: "クイズ生成に失敗しました" }, "ERROR");
    // 「考え中」を返した後なので、無応答にしない。再挑戦ボタン＋探検クイックリプライを添えて選び直せるようにする
    await client.pushMessage({
      to: userId,
      messages: withExploreQuickReply(
        [characterLine("dr-jinbei", "think", "むむ、クイズがうまく作れなかったのう。もう一度試してみておくれ。")],
        animalId,
      ),
    });
  }
}

// design.md 1.3節: pendingQuizはFirestoreに永続化する（インメモリMapは複数インスタンスで壊れるため廃止）。
// selectionReason/consideredCategoriesは、ADKエージェントが実際に検討した過程の記録
// (「なぜこの問題が出たか」を後から追える、自律性の証跡として残す。決定論的経路ではundefined)。
// 問題とレベルの決定は同じ WriteBatch で書く（勝った問題と決定の組み合わせを必ず一致させる。design 3.3）。
async function savePendingQuiz(
  userId: string,
  animalId: string,
  quiz: QuizQuestion,
  decision: LevelDecision,
  profile: QuizProfile,
  extra: {
    generatedBy: "live-single" | "live-agent" | "pool";
    selectionReason?: string;
    consideredCategories?: AgentQuizCandidate[];
    runId?: string;
    guard?: string;
    poolId?: string;
    consideredPoolIds?: string[];
    selectedBy?: "agent" | "rule";
    poolExplanation?: string;
  },
): Promise<number> {
  const askedAt = Timestamp.now();
  const answerToken = askedAt.toMillis();
  const batch = db.batch();
  batch.set(pendingQuizRef(userId, animalId), {
    animalId: quiz.animalId,
    category: quiz.category,
    question: quiz.question,
    choices: quiz.choices,
    correctIndex: quiz.correctIndex,
    speakerPersona: quiz.speakerPersona ?? null,
    selectionReason: extra.selectionReason ?? null,
    consideredCategories: extra.consideredCategories ?? null,
    runId: extra.runId ?? null,
    guard: extra.guard ?? null,
    // #831: 作り置き。poolExplanation は正解の根拠を含むので、読み取り不可のここにだけ置く
    poolId: extra.poolId ?? null,
    consideredPoolIds: extra.consideredPoolIds ?? null,
    selectedBy: extra.selectedBy ?? null,
    poolExplanation: extra.poolExplanation ?? null,
    askedAt,
    level: decision.to,
    generatedBy: extra.generatedBy,
    promptVersion: quiz.promptVersion ?? QUIZ_PROMPT_VERSION,
    levelDecision: decision,
    attempt: 1,
    answerToken,
    prevAnswerToken: null,
    retryStartedAt: null,
    eliminatedIndex: null,
    hint: null,
    hintSource: null,
    hintRejectReason: null,
    explanation: null,
  });
  const changed = decision.to !== decision.from;
  batch.set(
    userRef(userId),
    {
      quizProfile: {
        level: decision.to,
        lastLevelDecision: { ...decision, at: askedAt },
        ...(changed ? { lastChangeDirection: decision.direction === "down" ? "down" : "up", levelChangedAtCount: profile.answeredCount } : {}),
        updatedAt: askedAt,
      },
    },
    { merge: true },
  );
  await batch.commit();
  // 出題の識別子。回答のpostbackに載せ、handleAnswerQuizで最新の出題との一致を確認する
  // （本文のFlexは古い問題もタップできてしまうため、新しい問題への誤回答を防ぐ）。
  return answerToken;
}

interface PendingQuizDoc extends QuizQuestion {
  askedAt?: Timestamp;
  attempt?: number;
  answerToken?: number;
  prevAnswerToken?: number | null;
  retryStartedAt?: number | null;
  eliminatedIndex?: number | null;
  hint?: string | null;
  hintSource?: "llm" | "fallback" | null;
  hintRejectReason?: string | null;
  explanation?: string | null;
  levelDecision?: LevelDecision;
  // #832: 判断の記録（回答時に quizHistory へ引き継ぐ）
  selectionReason?: string | null;
  consideredCategories?: AgentQuizCandidate[] | null;
  runId?: string | null;
  guard?: string | null;
  // #831
  poolId?: string | null;
  consideredPoolIds?: string[] | null;
  selectedBy?: "agent" | "rule" | null;
  poolExplanation?: string | null;
}

function toPendingState(data: PendingQuizDoc): PendingAnswerState {
  return {
    correctIndex: data.correctIndex,
    attempt: data.attempt === 2 ? 2 : 1,
    eliminatedIndex: typeof data.eliminatedIndex === "number" ? data.eliminatedIndex : null,
    answerToken: data.answerToken ?? data.askedAt?.toMillis() ?? 0,
    prevAnswerToken: typeof data.prevAnswerToken === "number" ? data.prevAnswerToken : null,
    retryStartedAt: typeof data.retryStartedAt === "number" ? data.retryStartedAt : null,
  };
}

// 2択（ヒント付き再挑戦）の返信メッセージ。新規の2択と、古い3択を押されたときの出し直しで共用する。
function buildRetryMessages(
  quiz: QuizQuestion,
  animal: KaiyukanAnimal | undefined,
  hint: string,
  eliminatedIndex: number,
  answerToken: number,
  level: QuizLevel,
  lead: ReturnType<typeof characterLine>,
  outro: ReturnType<typeof characterLine>,
): messagingApi.Message[] {
  return [
    lead,
    characterLine("dr-jinbei", "think", hint),
    outro,
    buildQuizFlexMessage(
      { ...quiz, referencesWikipedia: Boolean(animal?.wikipedia), level, eliminatedIndex },
      answerToken,
    ),
  ];
}

// quizTokenは回答のpostbackに載っている出題の識別子(pendingQuiz.answerToken)。判定は decideAnswerOutcome（design 3.4）。
// 無い場合（識別子導入前に出した問題）は従来どおり受け付ける。
async function handleAnswerQuiz(
  replyToken: string,
  userId: string,
  animalId: string,
  choiceIndex: number,
  quizToken?: number,
  isRedelivery = false,
): Promise<void> {
  const pendingRef = pendingQuizRef(userId, animalId);
  const colRef = collectionRef(userId, animalId);
  const uRef = userRef(userId);
  // 履歴のIDはトランザクションの外で決める。トランザクションが再試行されても同じIDになり、二重登録しない。
  const historyRef = quizHistoryCollection(userId, animalId).doc();

  // design 4.5: pendingQuiz と users を先にまとめて読み（Firestoreは全ての読み取り→全ての書き込みの順が必須）、
  // 判定 → 書き込みの順に進める。LLM（ヒント）呼び出しはトランザクションの外。
  // findAnimalById(キャッシュ済み配列からの検索)はトランザクションの結果に依存しないため並列化する。
  const [txResult, animal] = await Promise.all([
    db.runTransaction(async (tx) => {
      // --- 読み取り（全部先） ---
      const pendingSnap = await tx.get(pendingRef);
      const userSnap = await tx.get(uRef);

      const pendingData = pendingSnap.exists ? (pendingSnap.data() as PendingQuizDoc) : null;
      const profile = normalizeProfile(toProfileRaw(userSnap.data()?.quizProfile));
      const nowMs = Date.now();
      const outcome = decideAnswerOutcome({
        pending: pendingData ? toPendingState(pendingData) : null,
        animalId,
        choiceIndex,
        token: quizToken,
        now: nowMs,
        lastFinished: profile.lastFinished,
      });
      const state = pendingData ? toPendingState(pendingData) : null;

      // --- 書き込み ---
      let newToken: number | null = null;
      if (pendingData && state && outcome.kind === "finished") {
        const level = pendingData.level ?? DEFAULT_QUIZ_LEVEL;
        const now = Timestamp.now();
        tx.delete(pendingRef);
        // 次回のカテゴリー選定(planQuizCategory)の入力になる履歴。isCorrect は最終の正誤。
        // 履歴は回答後にだけ書くので、出題中の問題の正解(pendingQuiz、LIFFからは読めない)は漏れない。
        tx.set(historyRef, {
          category: pendingData.category,
          question: pendingData.question,
          choices: pendingData.choices,
          correctIndex: pendingData.correctIndex,
          askedAt: now,
          isCorrect: outcome.isCorrect,
          level,
          attempts: outcome.attempts,
          hintUsed: outcome.hintUsed,
          hintStage: outcome.hintUsed ? 1 : 0,
          hintSource: pendingData.hintSource ?? null,
          hintRejectReason: pendingData.hintRejectReason ?? null,
          eliminatedIndex: outcome.eliminatedIndex,
          levelDecision: pendingData.levelDecision ?? null,
          generatedBy: pendingData.generatedBy ?? null,
          promptVersion: pendingData.promptVersion ?? null,
          // #832 B1/B2: 判断の記録を引き継ぐ。選ばれなかった候補の選択肢と正解番号は落とす
          runId: pendingData.runId ?? null,
          selectionReason: pendingData.selectionReason ?? null,
          consideredCategories: toHistoryCandidates(pendingData.consideredCategories),
          guard: pendingData.guard ?? null,
          // #831: 出題済みの作り置きを突き合わせる ID。答えは同じ文書に既にあるので新しく漏れる情報は無い
          poolId: pendingData.poolId ?? null,
          selectedBy: pendingData.selectedBy ?? null,
          consideredPoolIds: pendingData.consideredPoolIds ?? null,
        });
        tx.set(colRef, { updatedAt: now }, { merge: true });
        const applied = applyFinishedAnswer(
          profile,
          {
            level,
            category: pendingData.category,
            isCorrect: outcome.isCorrect,
            hintUsed: outcome.hintUsed,
            attempts: outcome.attempts,
            at: now.toDate(),
          },
          { animalId, answerToken: state.answerToken, at: nowMs },
        );
        tx.set(uRef, { quizProfile: { ...applied, updatedAt: now } }, { merge: true });
      } else if (state && outcome.kind === "retry") {
        newToken = Math.max(nowMs, state.answerToken + 1);
        tx.update(pendingRef, {
          attempt: 2,
          eliminatedIndex: outcome.eliminatedIndex,
          prevAnswerToken: state.answerToken,
          answerToken: newToken,
          retryStartedAt: nowMs,
        });
      }

      // 返信に要る値だけを返す（返信はトランザクションの外で組み立てる）
      return { outcome, pending: pendingData, state, newToken };
    }),
    findAnimalById(animalId),
  ]);

  const { outcome, pending, state, newToken } = txResult;
  const level: QuizLevel = pending?.level ?? DEFAULT_QUIZ_LEVEL;
  logQuizEvent("quiz_answer", {
    userIdHash: hashId(userId),
    animalId,
    kind: outcome.kind,
    attempt: state?.attempt ?? null,
    isCorrect: outcome.kind === "finished" ? outcome.isCorrect : null,
    level: pending ? level : null,
    generatedBy: pending?.generatedBy ?? null,
    poolId: pending?.poolId ?? null,
    isRedelivery,
  });

  if (outcome.kind === "duplicate" || outcome.kind === "invalid") return;

  if (outcome.kind === "stale") {
    // Webhook の再送で古いと判った回答には返信しない（元の回答には既に返信済みのため）
    if (isRedelivery) return;
    // 識別子の無い回答で問題が無い場合は、従来どおり「見つからない」を返す
    if (!pending && quizToken === undefined) {
      await client.replyMessage({
        replyToken,
        messages: [{ type: "text", text: "クイズが見つからなかったよ。もう一度写真を送ってみてね。" }],
      });
      return;
    }
    // C5: 2択を出したのに古い3択を押された（2択の返信が届かなかった場合の復旧も兼ねる）→ 2択を出し直す
    if (outcome.retryInProgress && pending && state && state.eliminatedIndex !== null) {
      await client.replyMessage({
        replyToken,
        messages: buildRetryMessages(
          pending,
          animal,
          pending.hint ?? fallbackHint(level),
          state.eliminatedIndex,
          state.answerToken,
          level,
          characterLine("kawauso", "think", "下の2択で答えてほしいっす！"),
          characterLine("kawauso", "happy", "ひとつ消したから、残りの2つから選んでほしいっす！"),
        ),
      });
      return;
    }
    await client.replyMessage({
      replyToken,
      messages: withExploreQuickReply(
        [characterLine("kawauso", "think", "そのクイズはもう終わってるっす！最新のクイズに答えるか、下から新しく挑戦してほしいっす！")],
        animalId,
      ),
    });
    return;
  }

  if (!pending) return; // 型の絞り込み用（retry / finished は pending がある）

  if (outcome.kind === "retry") {
    // 2回目に進めたことが確定したあとで、トランザクションの外でヒントを作る（失敗してもフォールバックで必ず返す）
    const quizForHint: QuizQuestion = {
      animalId,
      category: pending.category,
      question: pending.question,
      choices: pending.choices,
      correctIndex: pending.correctIndex,
      speakerPersona: pending.speakerPersona,
    };
    const eliminatedIndex = outcome.eliminatedIndex;
    const token = newToken ?? state?.answerToken ?? 0;
    const result: QuizHintResult = animal
      ? await generateQuizHint(animal, quizForHint, eliminatedIndex, level)
      : {
          hint: fallbackHint(level),
          hintSource: "fallback",
          hintRejectReason: "error",
          explanation: null,
          latencyMs: 0,
        };
    try {
      await pendingRef.update({
        hint: result.hint,
        hintSource: result.hintSource,
        hintRejectReason: result.hintRejectReason,
        explanation: result.explanation,
      });
    } catch (error) {
      logEvent("quiz_hint_save_failed", { animalId, error, message: "ヒントの保存に失敗しました" }, "WARNING");
    }
    await client.replyMessage({
      replyToken,
      messages: buildRetryMessages(
        quizForHint,
        animal,
        result.hint,
        eliminatedIndex,
        token,
        level,
        characterLine("kawauso", "normal", "ああーっ！惜しいっす！でも良い予想っすね！"),
        characterLine("kawauso", "happy", "教授のヒントが出たっす！ひとつ消したから、残りの2つから選び直してみるっす！"),
      ),
    });
    return;
  }

  // finished（design 9.3 の3パターン）
  const correctChoice = pending.choices[pending.correctIndex];
  // 説明文は80字以内の最後の「。」で切る（文の途中で切ると「…展示するにあたり、」のように途切れる）
  const factoid = animal?.description ? firstSentences(animal.description, 80) : undefined;
  const explanationText = pending.explanation ?? pending.poolExplanation ?? factoid;
  let messages: messagingApi.Message[];
  if (outcome.isCorrect && outcome.attempts === 1) {
    // UC-B/UC-C(docs/charactor/dialogue-scenarios.md): カワウソ助教授が反応し、ジンベエ名誉教授が添える掛け合い形式。
    messages = [
      characterLine("kawauso", "happy", "大正解っす〜〜！！さすが研究員さん、観察力バツグンっすね！"),
      characterLine("dr-jinbei", "happy", explanationText ? `ふむ、見事じゃ。${explanationText}` : "ふむ、見事じゃ。よく調べたのう。"),
    ];
  } else if (outcome.isCorrect) {
    messages = [
      characterLine("kawauso", "happy", "やったっす！ヒントから見事に見抜いたっすね！"),
      characterLine(
        "dr-jinbei",
        "happy",
        explanationText ? `ふむ、見事じゃ。${explanationText}` : "ふむ、見事じゃ。よく調べたのう。",
      ),
    ];
  } else {
    messages = [
      characterLine("kawauso", "normal", "むむっ、今回は手ごわかったっす……！"),
      characterLine(
        "dr-jinbei",
        "think",
        `ふむ、正解は「${correctChoice}」じゃ。${explanationText ?? "またおいで。"}`,
      ),
    ];
  }

  await client.replyMessage({ replyToken, messages: withExploreQuickReply(messages, animalId) });
}

// 位置情報から最寄りの水族館を案内する（docs/specs/789-nearest-aquarium）。
// 緯度経度はこの関数の引数として渡すだけで、Firestoreにもログにも一切出さない。
// 説明文を、maxLength 以内の最後の「。」までで返す。1文目が maxLength を超えるなら1文目だけ、「。」が無く長すぎるなら undefined
function firstSentences(text: string, maxLength: number): string | undefined {
  const head = text.slice(0, maxLength);
  const lastStop = head.lastIndexOf("。");
  if (lastStop >= 0) return head.slice(0, lastStop + 1);
  const firstStop = text.indexOf("。");
  if (firstStop >= 0) return text.slice(0, firstStop + 1);
  return text.length <= maxLength ? text : undefined;
}

async function handleLocationMessage(replyToken: string, latitude: number, longitude: number): Promise<void> {
  const result = await findNearestAquariumWithRoute(latitude, longitude);
  if (!result) {
    await client.replyMessage({
      replyToken,
      messages: [characterLine("dr-jinbei", "think", "むむ、水族館の地図が見当たらんのう。少し待ってからもう一度送っておくれ。")],
    });
    return;
  }

  await client.replyMessage({
    replyToken,
    messages: [
      characterLine("kawauso", "happy", result.introLine),
      buildAquariumFlexMessage(result),
      characterLine("dr-jinbei", "normal", result.closingLine),
    ],
  });
}

async function handlePostback(replyToken: string, userId: string, data: string, isRedelivery = false): Promise<void> {
  const params = new URLSearchParams(data);
  const action = params.get("action");
  const animalId = params.get("animalId");

  if (action === "selectFish" && animalId) {
    await handleSelectFish(replyToken, userId, animalId);
    return;
  }

  if (action === "showTankmates" && animalId) {
    await handleShowTankmates(replyToken, animalId);
    return;
  }

  if (action === "showFamily" && animalId) {
    await handleShowFamily(replyToken, animalId);
    return;
  }

  if (action === "browseExhibitions") {
    await handleBrowseExhibitions(replyToken);
    return;
  }

  if (action === "showByExhibition") {
    const exhibition = params.get("exhibition");
    if (exhibition) {
      await handleShowByExhibition(replyToken, exhibition);
    }
    return;
  }

  if (action === "startQuiz" && animalId) {
    await handleStartQuiz(replyToken, userId, animalId);
    return;
  }

  if (action === "answerQuiz" && animalId) {
    const choiceIndexRaw = params.get("choiceIndex");
    const choiceIndex = choiceIndexRaw !== null ? Number(choiceIndexRaw) : NaN;
    const quizTokenRaw = params.get("t");
    const quizToken = quizTokenRaw !== null ? Number(quizTokenRaw) : undefined;
    if (Number.isInteger(choiceIndex)) {
      await handleAnswerQuiz(replyToken, userId, animalId, choiceIndex, quizToken, isRedelivery);
    }
    return;
  }
}

// 駅の水族館エージェントの判断の記録（#832 B3/B5）。本人だけが読める。入力の自由文は残さない。30日でTTL削除（expireAt）。
const AGENT_RUN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
async function saveStationAgentRun(userId: string, record: AgentRunRecord): Promise<void> {
  const now = Timestamp.now();
  const aquariums = Array.isArray(record.decision?.aquariums) ? (record.decision?.aquariums as string[]).slice(0, 3) : [];
  await db.doc(`users/${userId}/agentRuns/${record.runId}`).set({
    agent: record.agent,
    runId: record.runId,
    outcome: record.outcome,
    latencyMs: record.latencyMs,
    model: record.model,
    promptVersion: record.promptVersion,
    decision: record.decision ?? null,
    aquariums,
    createdAt: now,
    expireAt: Timestamp.fromMillis(now.toMillis() + AGENT_RUN_TTL_MS),
  });
}

// 1イベントの入口。文脈(userIdHash)を持たせ、再送なら何もしない（#832 A2/C7）。
async function handleEvent(event: webhook.Event): Promise<void> {
  // design.md 1.2節: userIdが取れない(グループ/ルーム経由等)イベントはこのフローでは扱わない
  const userId = getUserId(event);
  if (!userId) return;

  await withLogContext({ userIdHash: hashId(userId) }, async () => {
    const isRedelivery = event.deliveryContext?.isRedelivery === true;
    const webhookEventIdHash = event.webhookEventId ? hashId(event.webhookEventId) : null;
    logEvent("webhook_received", {
      lineEventType: event.type,
      messageType: event.type === "message" ? event.message.type : null,
      action: event.type === "postback" ? new URLSearchParams(event.postback.data).get("action") : null,
      isRedelivery,
      webhookEventIdHash,
      message: `Webhookを受け取りました (${event.type})`,
    });
    if (!(await claimWebhookEvent(event.webhookEventId))) {
      logEvent("webhook_duplicate", { isRedelivery, webhookEventIdHash, message: "同じイベントの再送のため処理しませんでした" }, "WARNING");
      return;
    }
    await dispatchEvent(event, userId);
  });
}

async function dispatchEvent(event: webhook.Event, userId: string): Promise<void> {

  // 友だち追加（ブロック解除を含む）: キャラのあいさつと使い方のカルーセルを返す（welcomeMessage.ts、5件以内）
  if (event.type === "follow") {
    if (!event.replyToken) return;
    await client.replyMessage({ replyToken: event.replyToken, messages: buildWelcomeMessages() });
    logEvent("welcome_sent", { message: "友だち追加のウェルカムメッセージを送りました" });
    return;
  }

  if (event.type === "postback") {
    if (!event.replyToken) return;
    await handlePostback(event.replyToken, userId, event.postback.data, event.deliveryContext?.isRedelivery === true);
    return;
  }

  if (event.type !== "message") return;
  const { replyToken, message } = event;
  if (!replyToken) return;

  if (message.type === "text") {
    // 自由文は200文字で切ってからLLMに渡す（#832 C2。区切りは各モジュールの buildUserInput）
    const truncated = truncateUserText(message.text);
    if (truncated.truncated) {
      logGuard("chat", "input_truncated", "truncated", `${truncated.originalLength}->${MAX_USER_TEXT_CHARS}`, {
        inputChars: truncated.originalLength,
      });
    }
    const text = truncated.text;

    // 生きものの名前（部分一致）。当たれば写真のときと同じ候補カードを出し、選んでもらって図鑑に登録する。
    // LLM を呼ばないので停止スイッチより先に判定する。水槽（展示エリア）の名前 → 生きものの名前の順
    if (await replyIfExhibitionMatches(replyToken, text)) return;
    if (await replyIfNameMatches(replyToken, text)) return;

    // 停止スイッチ（C5）: 駅・雑談の両方が止まっていればLLMを呼ばない
    const runtime = await getRuntimeConfig();
    const stationOff = runtime.disabledAgents.has("station");
    const chatOff = runtime.disabledAgents.has("chat");
    const maintenance = (fallback: string) => characterLine("dr-jinbei", "think", runtime.maintenanceMessage ?? fallback);
    if (stationOff && chatOff) {
      logGuard("chat", "kill_switch", "skipped");
      await client.replyMessage({ replyToken, messages: [maintenance("今は調査隊も、おしゃべりもお休み中じゃ。しばらくしてからまた話しかけておくれ。")] });
      return;
    }

    // 駅・地名を起点にした水族館の質問判定（Issue #790）
    const isStationQuery = await classifyStationAquariumIntent(text);
    if (isStationQuery && stationOff) {
      logGuard("station", "kill_switch", "skipped");
      await client.replyMessage({ replyToken, messages: [maintenance("今は調査隊がお休み中じゃ。しばらくしてからまた聞いておくれ。")] });
      return;
    }
    if (isStationQuery) {
      // 先に replyToken で「調べ中っす！」を即時返信
      await client.replyMessage({
        replyToken,
        messages: [
          characterLine("kawauso", "think", "駅からの水族館調査っすね！ただいま調査中っす、ちょっと待っててほしいっす！"),
        ],
      });

      // バックグラウンドでエージェントを実行し、完了後に pushMessage で送信
      (async () => {
        try {
          const agentResult = await runStationAquariumAgent(text, {
            onFinish: (record) => saveStationAgentRun(userId, record),
          });
          const presentation = toPresentationResult(agentResult);

          const pushMessages: messagingApi.Message[] = [
            characterLine("kawauso", "happy", agentResult.kawausoLine),
          ];

          if (presentation) {
            pushMessages.push(buildStationAquariumFlexMessage(presentation));
          }

          pushMessages.push(characterLine("dr-jinbei", "normal", agentResult.jinbeiLine));

          await client.pushMessage({
            to: userId,
            messages: pushMessages,
          });
        } catch (error) {
          // agent_run(outcome=error/timeout)に記録済み。ここは利用者への案内
          await client.pushMessage({
            to: userId,
            messages: [
              characterLine(
                "dr-jinbei",
                "think",
                "すまんな、海図やダイヤがうまく調べられなんだ。駅名を変えてもう一度試してみておくれ。",
              ),
            ],
          });
        }
      })().catch((err) => {
        logEvent("station_agent_async_failed", { error: err, message: "水族館調査エージェントの非同期処理でエラーが発生しました" }, "ERROR");
      });

      return;
    }

    if (chatOff) {
      logGuard("chat", "kill_switch", "skipped");
      await client.replyMessage({ replyToken, messages: [maintenance("今はおしゃべりはお休み中じゃ。しばらくしてからまた話しかけておくれ。")] });
      return;
    }

    // UC-D(docs/charactor/dialogue-scenarios.md): 自由な雑談・質問には、2人のキャラクター性を
    // 保ったままGeminiに1〜2行の掛け合いで応答させる（単純なechoからの置き換え）。
    try {
      const lines = await generateCharacterChat(text);
      await client.replyMessage({
        replyToken,
        messages: lines.map((line) => characterLine(line.character, line.expression, line.text)),
      });
    } catch {
      await client.replyMessage({
        replyToken,
        messages: [characterLine("dr-jinbei", "think", "むむ、うまく聞き取れなかったのう。もう一度言ってみておくれ。")],
      });
    }
    return;
  }

  if (message.type === "image") {
    await handleImageMessage(replyToken, userId, message.id);
    return;
  }

  if (message.type === "location") {
    // マスタの読み込み失敗(ENOENT等)でも無応答にしない。errorオブジェクトに座標は含まれない。
    try {
      await handleLocationMessage(replyToken, message.latitude, message.longitude);
    } catch (error) {
      logEvent("nearest_aquarium_failed", { error, message: "最寄り水族館の検索に失敗しました" }, "ERROR");
      await client.replyMessage({
        replyToken,
        messages: [characterLine("dr-jinbei", "think", "むむ、海図がうまく読めなんだ。すまんが、もう一度送っておくれ。")],
      });
    }
    return;
  }

  await client.replyMessage({
    replyToken,
    messages: [{ type: "text", text: "画像かテキストを送ってね" }],
  });
}

const app = express();

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.post("/webhook", middleware({ channelSecret }), (req: Request, res: Response) => {
  // LINEのWebhook配信は応答が遅いと再送(=イベント二重処理)につながるため、即座に200を返し、
  // イベント処理は非同期(fire-and-forget)で行う。ADKクイズ経路は実測で約24秒かかることがあり、
  // これをawaitしたままだと再送リスクが現実的に高くなる。
  const body = req.body as webhook.CallbackRequest;
  res.status(200).end();
  // 同じ trace を、非同期の後処理(pushMessageまで)のログすべてに付ける（#832 A2）
  const trace = parseTraceHeader(req.header("x-cloud-trace-context"));
  withLogContext({ trace }, () =>
    Promise.all(body.events.map(handleEvent)).catch((error) => {
      logEvent("webhook_failed", { error, message: "Webhookイベント処理中にエラーが発生しました" }, "ERROR");
    }),
  );
});

// LIFF(ミニアプリ)用: IDトークンを検証してFirebaseカスタムトークンを返す（docs/specs/785-liff-firebase-auth）。
// express.json() は /webhook のLINE署名検証(生ボディ)を壊さないよう、このルートだけに付ける。
app.options("/auth/line", corsMiddleware);
app.post("/auth/line", corsMiddleware, express.json({ limit: "16kb" }), handleLineAuth, jsonBodyErrorHandler);
app.options("/auth/demo", corsMiddleware);
app.post("/auth/demo", corsMiddleware, handleDemoAuth);

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  logEvent("server_started", { port, message: `listening on ${port}` });
});
