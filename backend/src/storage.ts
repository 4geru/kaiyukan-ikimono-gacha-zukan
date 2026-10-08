import { Storage } from "@google-cloud/storage";

// 認証情報は渡さない: Cloud Run上はアタッチされたサービスアカウント、
// ローカルは gcloud ADC / GOOGLE_APPLICATION_CREDENTIALS をSDKが自動解決する
const storage = new Storage();

export async function uploadImageToGCS(params: {
  buffer: Buffer;
  destFileName: string;
  contentType?: string;
}): Promise<{ gcsUri: string; publicUrl: string }> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error(
      "環境変数 GCS_BUCKET_NAME が設定されていません。アップロード先のGCSバケット名を設定してください。"
    );
  }

  const { buffer, destFileName, contentType } = params;
  const file = storage.bucket(bucketName).file(destFileName);

  try {
    await file.save(buffer, {
      contentType: contentType ?? "application/octet-stream",
      // uniform bucket-level accessが前提のため、オブジェクト単位のACL操作(predefinedAcl等)は行わない
      resumable: false,
    });
  } catch (error) {
    throw new Error(
      `GCSへの画像アップロードに失敗しました (bucket: ${bucketName}, file: ${destFileName}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return {
    gcsUri: `gs://${bucketName}/${destFileName}`,
    publicUrl: `https://storage.googleapis.com/${bucketName}/${destFileName}`,
  };
}
