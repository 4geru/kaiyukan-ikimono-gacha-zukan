// images/animals/ に生成済みのイラストを、公開GCSバケット(kaiyukan-gacha-hackathon-public-assets)の
// animals/ 配下にアップロードする。frontend/Makefile の `upload-images` ターゲット（gcloud CLI利用）と
// 同じ役割を、gcloud CLIなしでも実行できるNode版として用意したもの。
//
// 使い方:
//   tsx scripts/upload-animal-images.ts             # 未アップロード分だけ差分アップロード
//   tsx scripts/upload-animal-images.ts --force      # 既存ファイルも含め全件アップロードし直す
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";

const BUCKET_NAME = "kaiyukan-gacha-hackathon-public-assets";
const DEST_PREFIX = "animals";

// 認証情報は渡さない: gcloud ADC / GOOGLE_APPLICATION_CREDENTIALS をSDKが自動解決する
const storage = new Storage();

function parseArgs(argv: string[]) {
  return { force: argv.includes("--force") };
}

async function main(): Promise<void> {
  const { force } = parseArgs(process.argv.slice(2));

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const imagesDir = join(__dirname, "..", "..", "images", "animals");

  const files = (await readdir(imagesDir)).filter((f) => f.endsWith(".png"));
  if (files.length === 0) {
    console.log(`アップロード対象の画像が見つかりません: ${imagesDir}`);
    return;
  }

  const bucket = storage.bucket(BUCKET_NAME);

  let uploaded = 0;
  let skipped = 0;

  for (const fileName of files) {
    const destPath = `${DEST_PREFIX}/${fileName}`;
    const remoteFile = bucket.file(destPath);

    if (!force) {
      const [exists] = await remoteFile.exists();
      if (exists) {
        skipped++;
        continue;
      }
    }

    const buffer = await readFile(join(imagesDir, fileName));
    await remoteFile.save(buffer, {
      contentType: "image/png",
      resumable: false,
    });
    console.log(`アップロードしました: gs://${BUCKET_NAME}/${destPath}`);
    uploaded++;
  }

  console.log(`完了: ${uploaded}件アップロード、${skipped}件は既存のためスキップ`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
