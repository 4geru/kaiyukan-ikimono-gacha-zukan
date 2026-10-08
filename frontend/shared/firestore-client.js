// Firebase初期化とFirestore読み取りヘルパー（design.md 5節）。
// バンドラーを使わず、Firebase JS SDK（modular API）のESM CDN配布を<script type="module">からimportする。
// Firestoreを読む前に、LIFFのIDトークン→バックエンド(/auth/line)→Firebaseカスタムトークンでサインインする
// （docs/specs/785-liff-firebase-auth/design.md 3節。ルールは request.auth.uid == userId の自分の分だけ読める）。
import { AUTH_API_URL, CDN_VERSIONS, FIREBASE_CONFIG } from "./config.js";
import { clearReloginFlag, getIdToken, isDemo, reloginForFreshToken } from "./liff-client.js";
import { mockGetUserDoc, mockGetCollectionEntry, mockWatchCollection, mockGetQuizHistory } from "./firestore-mock.js";

let dbHandlePromise;

// localhost/127.0.0.1で開いている時は、本番Firestoreに一切触れずローカルモックデータを使う
// (firestore-mock.js。エミュレータもJavaも不要)
function useMock() {
  return typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);
}

function getDbHandle() {
  if (!dbHandlePromise) {
    const base = `https://www.gstatic.com/firebasejs/${CDN_VERSIONS.firebase}`;
    dbHandlePromise = Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`),
      import(`${base}/firebase-auth.js`),
    ]).then(([{ initializeApp }, firestore, authModule]) => {
      const app = initializeApp(FIREBASE_CONFIG);
      const db = firestore.getFirestore(app);
      const auth = authModule.getAuth(app);
      return { db, auth, signInWithCustomToken: authModule.signInWithCustomToken, ...firestore };
    });
  }
  return dbHandlePromise;
}

// ログイン前にFirebase SDKの読み込みだけ先に始める（ページ側が呼ぶ。モック時は何もしない）
export function prewarmFirebase() {
  if (!useMock()) getDbHandle().catch(() => { dbHandlePromise = undefined; });
}

async function fetchCustomToken(idToken) {
  const response = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`認証に失敗しました: ${body.error || response.status}`);
    error.code = body.error;
    throw error;
  }
  return body.customToken;
}

async function signIn(userId) {
  const { auth, signInWithCustomToken } = await getDbHandle();
  await auth.authStateReady();
  // ページ遷移後は永続化されたセッションを再利用し、/auth/line を呼ばない
  if (auth.currentUser?.uid === userId) return;

  // #837: デモは LINE を通さず、デモユーザーのトークンをもらう
  if (isDemo()) {
    const response = await fetch(AUTH_API_URL.replace(/\/auth\/line$/, "/auth/demo"), { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`デモの認証に失敗しました: ${body.error || response.status}`);
    await signInWithCustomToken(auth, body.customToken);
    return;
  }

  const idToken = await getIdToken();
  if (!idToken) throw new Error("LIFFのIDトークンを取得できません（LIFFの外で開いている可能性があります）");

  let customToken;
  try {
    customToken = await fetchCustomToken(idToken);
  } catch (error) {
    // IDトークンが期限切れなら、LIFFの再ログインでページごと遷移してやり直す（1回だけ）
    if (error.code === "id_token_expired" && reloginForFreshToken()) return new Promise(() => {});
    throw error;
  }
  await signInWithCustomToken(auth, customToken);
  clearReloginFlag();
}

// getUserDoc / watchCollection などが同時に呼ばれても、サインインは1回だけにする。失敗したら次回やり直せる。
const signInPromises = new Map();

function ensureSignedIn(userId) {
  if (useMock()) return Promise.resolve();
  if (!signInPromises.has(userId)) {
    const promise = signIn(userId).catch((error) => {
      signInPromises.delete(userId);
      throw error;
    });
    signInPromises.set(userId, promise);
  }
  return signInPromises.get(userId);
}

// users/{userId} を取得する。存在しない場合は null。
export async function getUserDoc(userId) {
  if (useMock()) return mockGetUserDoc(userId);
  await ensureSignedIn(userId);
  const { db, doc, getDoc } = await getDbHandle();
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data() : null;
}

// users/{userId}/collection/{animalId} を取得する。存在しない場合は null。
export async function getCollectionEntry(userId, animalId) {
  if (useMock()) return mockGetCollectionEntry(userId, animalId);
  await ensureSignedIn(userId);
  const { db, doc, getDoc } = await getDbHandle();
  const snap = await getDoc(doc(db, "users", userId, "collection", animalId));
  return snap.exists() ? snap.data() : null;
}

// users/{userId}/animals/{animalId}/quizHistory の新しい順（#832: 「なぜこの問題？」の表示用）。
// 各要素は { id, ...data }。selectionReason / consideredCategories が無い古い履歴はそのまま返す（表示側で「記録なし」とする）。
export async function getQuizHistory(userId, animalId, max = 10) {
  if (useMock()) return mockGetQuizHistory(userId, animalId);
  await ensureSignedIn(userId);
  const { db, collection, query, orderBy, limit, getDocs } = await getDbHandle();
  const snap = await getDocs(
    query(collection(db, "users", userId, "animals", animalId, "quizHistory"), orderBy("askedAt", "desc"), limit(max))
  );
  const entries = [];
  snap.forEach((docSnap) => entries.push({ id: docSnap.id, ...docSnap.data() }));
  return entries;
}

// users/{userId}/collection 配下をリアルタイム購読する。
// onChangeには { id, ...data } の配列を渡す。onError（任意）は認証・購読に失敗した時（権限エラー等）に呼ばれる。
// 戻り値は購読解除用のunsubscribe関数（Promiseでラップ）。onErrorを渡した場合、失敗しても拒否されず何もしない解除関数を返す。
export function watchCollection(userId, onChange, onError) {
  if (useMock()) return mockWatchCollection(userId, onChange, onError);
  return ensureSignedIn(userId)
    .then(getDbHandle)
    .then(({ db, collection, onSnapshot }) => {
      return onSnapshot(
        collection(db, "users", userId, "collection"),
        (snapshot) => {
          const entries = [];
          snapshot.forEach((docSnap) => entries.push({ id: docSnap.id, ...docSnap.data() }));
          onChange(entries);
        },
        onError
      );
    })
    .catch((error) => {
      if (!onError) throw error;
      onError(error);
      return () => {};
    });
}
