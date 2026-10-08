# ADK版クイズエージェントの本番統合（2026-09-19）

design.md 3章で設計し、`scripts/try-quiz-agent.ts`でローカル検証していたADK（`@google/adk`）ベースのクイズ生成エージェントを、`server.ts`の本番フローに統合した記録。

## 背景

これまでの`quiz.ts`は「コード側でカテゴリを1つ選び、そのカテゴリに絞ってGeminiに1問生成させる」という決定論的な実装だった。design.mdで設計していた「13カテゴリ全部について完成形のクイズを検討させてから1つを自律的に選ぶ」ADKエージェント版は、`scripts/try-quiz-agent.ts`でローカル検証済みだったが、本番の`server.ts`には統合されていなかった（`CLAUDE.md`の既知の未実装に記載されていた項目）。

## 設計: ハイブリッド構成

ユーザーが以前指定した「クイズのカテゴリ選定ルール」（不正解の間は同じカテゴリで出し直し、正解したら別カテゴリに切り替える）と、ADKエージェントによる自律的なカテゴリ選択は、単純には両立しない（「同じカテゴリに固定したい」場面でエージェントに自由に選ばせると要件を満たせない）。そこで以下のハイブリッド構成にした。

- **リトライ時（直前の回答が不正解）**: `quiz.ts`の`generateQuizForAnimal`をそのカテゴリ指定で直接呼ぶ。決定論的・高速（Gemini呼び出し1回のみ）
- **新しいカテゴリを選ぶ場面（正解した／初回）**: `src/quizAgent.ts`の`generateQuizWithAgent`を呼び、ADKエージェントに13カテゴリ全部を完成形クイズとして検討させてから1つを自律的に選ばせる

この使い分けにより、「決定論的であるべき部分」と「自律性を見せるべき部分」を明確に切り分けている。

## 実装ファイル

- `src/quizAgent.ts`（新規）: `scripts/try-quiz-agent.ts`にあったAgent/InMemoryRunner/FunctionTool/zodスキーマのロジックを、`generateQuizWithAgent(animal, askedCategories)`という関数としてモジュール化。`quiz.ts`の`QUIZ_CATEGORIES`/`QuizCategory`/`QuizQuestion`型を再利用し、重複定義を避けた
- `scripts/try-quiz-agent.ts`（更新）: 新モジュールを呼ぶ薄いラッパーに書き換え。ローカル検証用に所要時間も計測して表示するようにした
- `server.ts`の`handleStartQuiz`: 上記ハイブリッドロジックを実装。`pendingQuiz`に`selectionReason`・`consideredCategories`も保存し、「なぜこの問題が出たか」を後から追える形にした（自律性の証跡）

## 実測で判明した重大な制約: レイテンシ

ローカルで`generateQuizWithAgent`を実行したところ、**約24秒**かかることが判明した（`findRelatedSpecies`ツール呼び出しを含む場合）。LINEのreply tokenは短時間で失効するため、この待ち時間の間`replyMessage`を使い続けるのはリスクが高い。

### 対応: reply即時応答 + 非同期push

ADK経路では、以下の非同期構成にした。

1. **即座に**LINEのローディングインジケーター表示API（`showLoadingAnimation`）を呼ぶ（`replyToken`を消費しない、ユーザーのuserIdに対して呼べるAPI）。ネイティブの「入力中」アニメーションが画面に表示される
2. その間に`generateQuizWithAgent`を実行（〜24秒）
3. 完成したら`pushMessage`でクイズを送信する。この`pushMessage`自体がローディング表示を自動的に消す効果を持つ（LINEの仕様: 新しいメッセージが届くとローディング表示は自動解除される）
4. エラー時も`pushMessage`でエラーメッセージを送ることで、ローディング表示を確実に解除する

この構成により、「reply tokenの有効期限切れ」と「ユーザーが何も表示されないまま長時間待たされる」の両方を回避している。

## 審査基準「自律性」との関係

このADK統合により、以下がFableヒアリングで指摘された「自律性がゼロの決定論的パイプライン」という弱点への直接的な対応になっている。

- `findRelatedSpecies`ツールの呼び出しログ（「類似した仲間」「同じ水槽にいる魚」カテゴリの時だけ条件付きで呼ばれる）が、外部から観測可能な自律的分岐行動の証拠になる
- `consideredCategories`（13問全部の完成形）と`selectionReason`がFirestoreの`pendingQuiz`に保存されるため、「13問中12問を捨てて1問を選んだ」という自律的な意思決定の過程がデータとして残り、後からログ・LIFF等で追跡できる

## 未確認・今後の課題

- 実機（Cloud Run上）でのレイテンシは未計測（ローカル実行の約24秒がそのまま当てはまるとは限らない。Cloud Run側のコールドスタート・ネットワーク条件次第でさらに伸びる可能性もある）
- ローディングインジケーターの`loadingSeconds`は安全のため最大値の60秒に設定しているが、実際にはpushMessageが届いた時点でより早く解除される想定
- 「リトライ時は決定論的、新カテゴリはADK」という使い分け自体をユーザー体験として意識してもらう必要はなく、内部実装の切り替えとして透過的にしている
