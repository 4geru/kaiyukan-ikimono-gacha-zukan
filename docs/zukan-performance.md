# 図鑑ページ（zukan.html）初期表示の計測と改善

## 改善前の読み込みの流れ

1. zukan.html（18KB, br）→ LIFF SDK（130KB, 実測約1.0s, `<body>`末尾の同期script）
2. `liff.init` → `liff.getProfile`
3. その後で初めて `loadAllAnimals()`（マニフェスト 88KB・**無圧縮**・GCS）を取得 ← LIFF完了後の直列
4. 骨組み表示後に `watchCollection` → Firebase SDK 3本（app 103KB / firestore 440KB / auth 151KB、gzip）をこの時点で初めて import ← 直列
5. `/auth/line`（Cloud Run）→ `signInWithCustomToken` → Firestore購読
6. 発見ずみタイルの画像。`animals/*.png` は **1枚 約1.7〜1.9MB（1024px）**。一覧の表示幅は最大150px程度

直列だった待ち: LIFF → マニフェスト → Firebase SDK → 認証 → Firestore。
最大の問題は画像（一覧に原寸PNGを使用）。

## 計測方法
- Node fetch で各リソースのサイズ・時間を計測（上記サイズ）
- headless Chromium（playwright-core）で localhost の mock（`?debugUserId=test-user`）に、発見ずみ12種（画面最上段）を与え、4Mbps / RTT100ms でスロットリングして計測。LIFF・認証は通らないため、マニフェストと画像に関する差を見る指標。スクリプトは一時ファイルのみ

## 前後の比較（4Mbps / 100ms、3回計測）

| 指標 | 改善前 | 改善後 |
|---|---|---|
| 初画面の発見ずみ画像（12枚）取得量 | 約 18.6MB | 約 0.45MB |
| 画像がそろうまで | 約 37〜38 秒 | 約 1.3〜2.0 秒 |
| 1枚あたり画像 | 約 1.8MB（PNG） | 約 13KB（webp 320px） |
| 骨組み表示（zukanRoot） | LIFF完了後 | マニフェスト到着直後（LIFF完了を待たない） |
| 実機での直列待ち | LIFF → マニフェスト → Firebase SDK → 認証 | LIFF ∥ マニフェスト ∥ Firebase SDK → 認証 |

※ 実機のLIFF/認証の所要時間は未計測（debugUserIdはlocalhost限定のため）。並列化によりそれらと「マニフェスト」「Firebase SDK（約700KB）」の取得が重ならなくなる分が短縮される想定。

## 実施した改善
- **サムネイル**: `make build-liff` が `dist-liff/thumbs/{id}.webp`（320px, q78, 243枚 計約3.2MB）を生成（cwebp。`.thumbs-cache/` に結果を再利用、cwebpや元画像が無ければ警告のみ）。一覧は thumbs を使い、404なら元画像にフォールバック
- **並列化**: `main()` で マニフェスト取得・Firebase SDK 先読み（`prewarmFirebase`）・LIFF初期化 を同時開始。マニフェスト到着で骨組み（総数・絞り込み・読み込み中）を先に表示
- **先読み**: preconnect（LIFF CDN / GCS / gstatic / Cloud Run）、マニフェストの preload、Firebase 3モジュールの modulepreload、LIFF SDK を `<head>` の defer へ
- **キャッシュ**: firebase.json の `thumbs/**` に `max-age=86400`（HTML・shared は no-cache のまま）
- 既存の loading="lazy" / decoding="async" は維持。見た目・動作は変更なし

## 見送り
- マニフェストのHTTP圧縮（GCS配信のため。88KB。必要なら hosting へ置く）
- Firestore読み取りの統合（collection購読1本 + rank-badge の users/{id} 1回で既に最小）
- `shared/*.js` の長期キャッシュ（ファイル名にハッシュが無いため no-cache のまま）
- 注意: Firebase のバージョンは zukan.html の modulepreload と `shared/config.js` の `CDN_VERSIONS.firebase` の2か所（更新時は両方）
