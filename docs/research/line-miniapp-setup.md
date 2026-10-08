# LINEミニアプリ 設定手順メモ

調査日: 2026-09-19 / 関連: #784（LIFFフロント）, #785（認証基盤）、認証の詳細は [liff-firebase-custom-token-auth.md](liff-firebase-custom-token-auth.md)

## LIFFアプリとLINEミニアプリの違い

| | LIFFアプリ（LINE Loginチャネル） | LINEミニアプリ（専用チャネル） |
|---|---|---|
| LIFF ID | 1つ | 内部チャネルごとに1つ（Developing / Review / Published の計3つ） |
| URL | `https://liff.line.me/{LIFF_ID}` | `https://miniapp.line.me/{LIFF_ID}` |
| 審査 | 不要 | 未審査（unverified）のままでも作れるが一部機能に制限あり。審査を通すとverified |

このプロジェクトは**ミニアプリ（Published）を採用済み**。LIFF IDは `frontend/shared/config.js` の `LIFF_ID` に設定済み。

## 3つの内部チャネルの使い分け

| 内部チャネル | 用途 | 開けるのは |
|---|---|---|
| Developing（開発用） | 実装・動作確認 | 管理者とテスターのみ |
| Review（審査用） | 審査申請時にLINE側の審査担当が使う。verifiedを目指さない限り触らない | 審査担当・承認済み管理者 |
| Published（本番用） | 一般公開 | 管理者・一般ユーザー |

- **未審査ミニアプリは、Developingの設定変更がPublishedに反映される**（審査済みだとDevelopingのみに反映され、Review/Publishedは別管理）
- 実際に使うのは **Developing（開発中）と Published（デモ・公開）の2つ**
- `liff.init()` には、起動する内部チャネルに対応したLIFF IDを渡す。内部チャネルにつきLIFFアプリは1つしか追加できない

## 設定手順（LINE Developersコンソール）

1. **Providerを確認する**: Bot（Messaging API）と**同じProvider**にチャネルを作る。userIdはProviderごとに別の値になるため、別Providerだとfirestoreの `users/{userId}`（Bot側が書く）とLIFFのuserIdが一致しない ✅ 確認済み
2. **LINE MINI Appチャネルを作成**: Provider → Create a new channel → LINE MINI App。作成直後は未審査ミニアプリ
3. **内部チャネルごとにLIFF ID/URLを確認**: 3つそれぞれに発行される（形式 `https://miniapp.line.me/{LIFF_ID}`）
   - Published: `2011666398-2s9KLmu9` ✅ 取得済み
   - Developing: `2011666396-dgz7LpbK` ✅ 取得済み（URL: `https://miniapp.line.me/2011666396-dgz7LpbK`）
   - Review: 未取得（審査を出さない限り不要）
4. **Endpoint URLを設定**: 内部チャネルごとに設定し、そのURLにLIFFアプリ（HTML）をデプロイする。決め方は次節「Endpoint URLの決め方」。**決定: 開発 `https://kaiyukan-gacha-dev.web.app/` / 本番 `https://kaiyukan-gacha-hackathon.web.app/`**（コンソールへの入力は未）
5. **スコープを確認**: `openid`（userId取得に必須）。必要なら `profile`。未審査のPublishedでは通常の同意画面が出る
6. **チャネルIDを控える**: 各内部チャネルのBasic settingsに表示される。バックエンドの `/auth/line` がIDトークン検証の許可リストに使う
   - Developing: `2011666396` ✅ / Published: `2011666398` ✅（LIFF IDの `-` より前の数字と一致）
7. **テスターを追加**: Developingを開ける人をチャネルのRolesでテスターに登録する（チームメンバー・デモ確認者）
8. **Messaging APIとの連携**: デフォルトのLINE公式アカウントを連携済み ✅
9. **アプリ側に反映**:
   - `config.js` の `LIFF_ID`（現在はPublished）。Developingで開発するときは差し替える
   - バックエンドの `GACHA_LIFF_URL`（Flex Messageのボタンの遷移先）を `https://miniapp.line.me/{LIFF_ID}/...` 形式にする
10. **動作確認**: LINEアプリ内でミニアプリURLを開く。ローカルは `?debugUserId=` でLIFFを経由せずに確認できる（localhostではFirestoreもモック）

## Endpoint URLの決め方

LIFFの仕様（[Opening a LIFF app](https://developers.line.biz/en/docs/liff/opening-liff-app/) / [Developing a LIFF app](https://developers.line.biz/en/docs/liff/developing-liff-apps/)）から:

- LIFF URLを開くと、まず**Endpoint URLそのもの**（一次リダイレクト）に飛び、そこで `liff.init()` が動く。その後、二次リダイレクト先（Endpoint URL＋LIFF URLの後ろに付けたパス・クエリ）に飛ぶ
  - 例: Endpoint URLが `https://example.com/app/`、LIFF URLが `.../{id}/path_A/?k=v` → `https://example.com/app/path_A/?k=v`
- `liff.init()` は**Endpoint URLと同じか、それより下位のURL**でしか動作が保証されない（上位・別パスは非保証）
- 一次・二次の両方で `liff.init()` を実行する。Endpoint URLはHTTPSで、Developing/Reviewには Basic 認証付きURLも指定できる

これに合わせて **Endpoint URLは「ディレクトリ的なURL（末尾 `/`）で、そのURL自体がHTMLを返し、配下に各ページを置く」** 形にする。

| 案 | Endpoint URL（本番 / 開発） | 評価 |
|---|---|---|
| **A. Firebase Hosting（採用）** | `https://kaiyukan-gacha-hackathon.web.app/` / 開発用に別サイト（例 `https://kaiyukan-gacha-dev.web.app/`） | `/` に `index.html` を置ける。HTTPS・キャッシュ制御・開発/本番の分離が簡単。`firebasehosting` APIは有効。要: firebase CLI導入とログイン |
| B. GCS（現状の配信先） | `https://storage.googleapis.com/kaiyukan-gacha-hackathon-public-assets/gacha-demo/` | GCSはディレクトリURLにindex.htmlを返さないため、一次リダイレクトが404になる。`gacha-demo/` という名前の空フォルダ用オブジェクトにHTMLを置く回避策はあるが不自然 |
| C. Cloud Run | 静的配信コンテナのURL | 779 requirementsの方針には合うが、静的HTMLだけには重い |

- 開発と本番でLIFF IDが違うので、`config.js` の `LIFF_ID` は**ホスト名で切り替える**（実装済み。dev用ホスト → 開発のLIFF ID、それ以外はPublished）
- 入口の `index.html`（実装済み）は、LIFF SDKを読んで `liff.init()` するだけの薄いページ（`liff.state` があれば `liff.init()` 後に二次リダイレクト先へ遷移する）。パスなしのLIFF URLで開かれたときは図鑑（`zukan.html`）へ誘導する
- LIFF URLの後ろへのパス連結（`https://miniapp.line.me/{LIFF_ID}/zukan.html` など）は、LIFF URLの仕様からの推定。ミニアプリのURLで同じ動きになるかは実機で要確認

### Hosting構成（2026-09-19作成）

- サイト: `kaiyukan-gacha-hackathon`（既定・本番）、`kaiyukan-gacha-dev`（開発）。どちらも同じ `dist-liff/` を配信し、htmlとjsは `Cache-Control: no-cache`（`frontend/firebase.json`）
- デプロイ: `make deploy-liff-dev`（開発、ガードなし）/ `CONFIRM_785_DONE=yes make deploy-liff`（本番、#785完了までガード）。`make build-liff` で `dist-liff/` を作る
- LIFF URLの例: `https://miniapp.line.me/{LIFF_ID}/zukan.html`

## 現状チェックリスト

- [x] Providerの一致（Bot と同一）
- [x] Published の LIFF ID を `config.js` に設定
- [x] Developing の LIFF ID / チャネルID
- [x] Published のチャネルID
- [x] Endpoint URLの決定・Hostingサイト作成（コンソールへの入力は未）
- [ ] コンソールへEndpoint URLを入力（開発・本番）
- [ ] テスターの登録
- [ ] `GACHA_LIFF_URL` のミニアプリURL化
- [ ] Endpoint URLへのHTMLデプロイ（開発: `make deploy-liff-dev` / 本番: `deploy-liff`、#785完了までガードあり）

## 参考

- [Get started with LINE MINI App](https://developers.line.biz/en/docs/line-mini-app/quickstart/)
- [LINE Developers Console Guide for LINE MINI App](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/)
- [Registering LIFF apps](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
