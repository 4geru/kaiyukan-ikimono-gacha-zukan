# Fableレビュー: #784 LIFFフロントエンド design.md（2026-09-19 00:54）

`docs/specs/784-liff-frontend/design.md`（Issue #784: LIFF Webフロントエンド、designフェーズ）のドラフトを、tasksフェーズへ進む前にFableへレビュー依頼した記録。requirements.mdのレビュー（[2026-09-19-00-32-fable-design-review-liff-frontend.md](./2026-09-19-00-32-fable-design-review-liff-frontend.md)）の続き。

レビュー対象: design.mdの5つの主な判断（1節バンドラー非導入／3節画像URL解決方法／6.1節「既視聴」判定のsessionStorage実装／4節`?debugUserId=`／7節Makefileターゲット追加）。

## 結論

**軽微な修正2点（3節・4節）をdesign.mdに反映すればtasksフェーズに進んでよい**。1節・7節は妥当、2節は許容範囲だが1点補足推奨。3節・4節はtasksへ機械分解する前に、design.md自体の記述を一文明確化・修正しておくべき（実装後に気づくと手戻りが大きい種類の曖昧さ・リスクのため）。

## 観点別詳細

### 1. バンドラー非導入（妥当）

Firebase JS SDK（v9以降のmodular API）は`https://www.gstatic.com/firebasejs/<version>/firebase-app.js`等のESM CDN配布を公式にサポートしており、`<script type="module">`から直接importする使い方はFirebase公式ドキュメントにも「ビルドレスの選択肢」として明記されている。LIFF SDKも素の`<script src>`でグローバル`liff`を提供するだけなので両立に問題はない。1点補足すべきは、design.mdにCDN URLのバージョン番号（`<version>`部分）の固定方針が書かれていない点。`shared/`配下の複数ファイルが別々にimportする際にバージョンがずれると挙動差異の原因になるため、tasksで「バージョンを1箇所に集約する」を明記した方がよい。

### 2. 画像URLの2箇所分散（許容範囲、1点補足推奨）

design.md自身が認めている通りのトレードオフで、ハッカソン規模では妥当な判断。ただし見落としがある可能性: `animals-manifest.js`に該当`animalId`のエントリが無かった場合（#783側でイラスト生成が追いついていない、`make manifest && make upload-manifest`のデプロイし忘れ等）のフォールバック表示が設計に書かれていない。`shared/animals-lookup.js`の解決失敗時にプレースホルダー画像を出す等の仕様を、この節かtasksメモに一文足すべき。

### 3. `sessionStorage`による既視聴判定（要明確化）

design.md 6.1節は「`getCollectionEntry()`の`firstFoundAt`と…`sessionStorage`に`seen:{animalId}`を記録」の**両方**を見て判定するとあるが、両者をどう組み合わせるか（AND/OR、優先順位）が書かれていない。実は`firstFoundAt`は779design.md 1.3節のスキーマに既存で存在するフィールドであり、「ページ読み込み時点で該当animalIdのcollectionドキュメントが既に存在していたか」を見るだけで、タブ・端末非依存の判定が新規バックエンド変更なしに実現できる可能性がある（ドキュメント新規作成 vs 既存更新の区別は、遷移元（バックエンドがgacha直後にLIFFへ渡すクエリ等）で伝える方法もある）。これは`sessionStorage`単独より頑健になりうる選択肢であり、design.mdが「Firestoreに演出再生済みフラグを持たせるのは#783/#785調整が必要」と述べているのは"新規フィールド追加"の話であって、既存の`firstFoundAt`活用とは別の話。**tasksへ進む前に、判定ロジックの一文（両者の関係）を明記すべき**。

### 4. `?debugUserId=`クエリパラメータ（要修正）

ユーザーの懸念は妥当。`gacha.html`/`collection.html`/`card.html`はGCS公開バケットに直接置かれる静的HTMLであり、`?animalId=`同様「LIFF内でのみ動作しURLに現れない」という理由付けは`?debugUserId=`には当てはまらない——これは静的ファイルにURLクエリを1つ足すだけで誰でも試せる、明確に別種のリスクである。加えて5節では「Firestoreセキュリティルールは#785側の前提条件」と明記されており、ルール未整備期間はブラウザから直接Firestore SDKを叩けば元々どのuserIdのデータも読めてしまう状態にあるが、`?debugUserId=`はその操作の敷居を「devtoolsでSDKを叩く」から「URLにクエリを足すだけ」まで下げてしまう点が問題。design.mdやrequirements.mdが公開GitHubリポジトリに載る以上、パラメータ名自体も推測不要で公開されている。**修正すべき**: (a) #785のFirestoreセキュリティルールが整備されるまで`make deploy-liff`（本番3画面のデプロイ）を実行しない運用ルールをdesign.mdに明記する、および/または (b) `debugUserId`を本番3画面のデプロイ物からは外し、別URL・別デバッグフラグにする、のいずれかをtasksフェーズ前にdesign.mdへ追記すべき。

### 5. Makefileターゲット追加（妥当）

`deploy-liff`は既存の`manifest`/`upload-images`/`upload-manifest`前提ターゲットをそのまま再利用しており、変数（`PROJECT`/`GACHA_DEMO_PREFIX`等）の衝突や意図しない上書きは無い。既存`deploy`/`deploy-01/02/03`とも共存できる。唯一、冒頭の`.PHONY`宣言に`deploy-liff`が入っていない点は実装時task化すれば足りる程度の軽微な漏れ。

## 対応

上記の指摘はすべてdesign.mdに反映済み。

- 1節: CDN URLのバージョン番号を1箇所に集約する方針を追記
- 3節: 画像URLの真実の情報源が2箇所に分散する点は許容のまま、`animalId`未登録時のフォールバック（プレースホルダー画像＋Firestoreの`name`表示）を追記
- 6.1節: 「既視聴」判定を`sessionStorage`から`localStorage`（キー`seen:{userId}:{animalId}`）に変更し、Firestoreドキュメントの存在有無では判定できない理由（backendが`isFirstFind`の時だけFlex Messageを送るため、LIFF起動時点では既にドキュメントが存在する）を明記した上で、クライアント側の記録のみで判定する方式に一本化
- 4節: `?debugUserId=`のリスクを認め、「#785のFirestoreセキュリティルール整備までは`make deploy-liff`を実行しない」運用ルールと「`debugUserId`は本番3画面のデプロイ物に含めない」の両方を追記。新設した4.5節で#784の実装と#785完了の依存関係を明示
