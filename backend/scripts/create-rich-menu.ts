// dump-rich-menu.ts で保存した既存メニュー(定義JSON・画像)を元に、「水槽から探す」だけ
// inputOption: "closeRichMenu" を付けた新しいリッチメニューを作り、デフォルトに設定する。
// 旧メニューの削除はしない（動作確認後に手動で消す）。
// 使い方: cd backend && npx tsx scripts/create-rich-menu.ts <元のrichMenuId> [--apply]
//   --apply なし: 送信内容を表示するだけ(LINE側は変更しない)
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { messagingApi } from "@line/bot-sdk";

const sourceId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!sourceId || sourceId.startsWith("--")) {
  console.error("使い方: npx tsx scripts/create-rich-menu.ts <元のrichMenuId> [--apply]");
  process.exit(1);
}

const dumpDir = path.resolve("../images/richmenu");

async function readImage(): Promise<{ data: Buffer; type: string }> {
  for (const [ext, type] of [["png", "image/png"], ["jpg", "image/jpeg"]] as const) {
    try {
      return { data: await readFile(path.join(dumpDir, `${sourceId}.${ext}`)), type };
    } catch {
      // 次の拡張子を試す
    }
  }
  throw new Error(`${dumpDir} に ${sourceId} の画像(.png/.jpg)がありません。先に dump-rich-menu.ts を実行してください`);
}

async function main() {
  const source = JSON.parse(await readFile(path.join(dumpDir, `${sourceId}.json`), "utf-8")) as messagingApi.RichMenuResponse;

  const targets = source.areas.filter(
    (area) => area.action?.type === "postback" && area.action.data === "action=browseExhibitions",
  );
  if (targets.length !== 1) {
    throw new Error(`「水槽から探す」のpostbackエリアが ${targets.length} 件見つかりました（1件のはず）`);
  }

  const request: messagingApi.RichMenuRequest = {
    size: source.size,
    selected: source.selected,
    name: source.name,
    chatBarText: source.chatBarText,
    areas: source.areas.map((area) =>
      area === targets[0] ? { ...area, action: { ...area.action, inputOption: "closeRichMenu" } } : area,
    ) as messagingApi.RichMenuArea[],
  };

  console.log(JSON.stringify(request, null, 2));
  if (!apply) {
    console.log("\n(dry-run) --apply を付けると作成・画像アップロード・デフォルト設定を行います");
    return;
  }

  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が未設定です");
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

  const image = await readImage();
  const { richMenuId } = await client.createRichMenu(request);
  console.log(`作成: ${richMenuId}`);
  await blobClient.setRichMenuImage(richMenuId, new Blob([new Uint8Array(image.data)], { type: image.type }));
  console.log("画像アップロード完了");
  await client.setDefaultRichMenu(richMenuId);
  console.log(`デフォルトに設定: ${richMenuId}`);
  console.log(`旧メニュー(${sourceId})は残してあります。動作確認後に手動で削除してください`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
