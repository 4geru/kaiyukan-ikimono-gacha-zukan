// 現在LINEに登録されているリッチメニュー(定義JSON・画像)を読み取り専用で保存する。
// 作り直し(closeRichMenu対応)の元データを得るのが目的。LINE側は一切変更しない。
// 使い方: cd backend && npx tsx scripts/dump-rich-menu.ts [出力先ディレクトリ]
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { messagingApi } from "@line/bot-sdk";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
  console.error("LINE_CHANNEL_ACCESS_TOKEN が未設定です（backend/.env に海遊館ボットのトークンを入れてください）");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

const outDir = path.resolve(process.argv[2] ?? "../images/richmenu");

async function readStream(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// リッチメニュー画像はPNG/JPEGのみ。先頭バイトで拡張子を判定する。
function detectExtension(image: Buffer): string {
  if (image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  return "bin";
}

async function main() {
  const [{ richmenus }, defaultResult, aliasResult] = await Promise.all([
    client.getRichMenuList(),
    client.getDefaultRichMenuId().catch(() => ({ richMenuId: undefined })),
    client.getRichMenuAliasList().catch(() => ({ aliases: [] })),
  ]);

  const defaultId = defaultResult.richMenuId;
  console.log(`リッチメニュー ${richmenus.length} 件 / デフォルト: ${defaultId ?? "(なし)"}`);
  console.log(`エイリアス: ${aliasResult.aliases.map((a) => `${a.richMenuAliasId}->${a.richMenuId}`).join(", ") || "(なし)"}`);

  await mkdir(outDir, { recursive: true });

  for (const menu of richmenus) {
    const image = await readStream(await blobClient.getRichMenuImage(menu.richMenuId));
    const base = path.join(outDir, menu.richMenuId);
    await writeFile(`${base}.json`, JSON.stringify(menu, null, 2));
    await writeFile(`${base}.${detectExtension(image)}`, image);

    const mark = menu.richMenuId === defaultId ? " [デフォルト]" : "";
    console.log(`\n${menu.richMenuId}${mark}  "${menu.name}"  ${menu.size.width}x${menu.size.height}  chatBar="${menu.chatBarText}"`);
    for (const area of menu.areas ?? []) {
      const b = area.bounds;
      console.log(`  (${b?.x},${b?.y} ${b?.width}x${b?.height}) ${JSON.stringify(area.action)}`);
    }
  }

  console.log(`\n保存先: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
