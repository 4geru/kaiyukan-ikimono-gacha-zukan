# デモユーザーの図鑑 — Design

- バックエンド: `POST /auth/demo`（`lineAuth.ts` の `handleDemoAuth`）。入力なしで uid `demo-zukan` の Firebase カスタムトークンを返す。CORS は `/auth/line` と同じ許可リスト。インスタンスごとに 1分 60回までの簡易な回数制限
- Firestore ルール: 変更なし（`isOwner` で demo-zukan は自分の分だけ get/list、書き込みは全拒否）
- データ: `backend/scripts/seed-demo-user.ts` が、users が1人（末尾6b85）のときだけ、その人の quizProfile・collection・quizHistory を `users/demo-zukan` にコピー。元の uid が値に含まれていたら中止
- フロント:
  - `shared/liff-client.js`: `?demo=1` を見たら sessionStorage に記録し、以降のページもデモ扱い。デモ中は LIFF を通さず `{ userId: "demo-zukan" }` を返し、上部に「デモ表示中」の帯を出す
  - `shared/firestore-client.js`: デモ中は `/auth/demo` でトークンを取ってサインイン
  - 紹介ページ（`index.html`）: 「LINE なしで図鑑を見る」ボタン → `zukan.html?demo=1`
