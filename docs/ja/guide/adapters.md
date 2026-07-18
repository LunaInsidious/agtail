# アダプタと正規化モデル

agtail はエージェント非依存です。各エージェントには、そのエージェントがトランスクリプトをどこに保存し、それらを 1 つの共有モデルへどうマッピングするかを知る**アダプタ**があります。それ以外のすべて — 検索、CLI、サーバー、Web — は正規化された形に対して動作するため、すべてのエージェントで同じように機能します。

## 正規化モデル

`Session` はメタデータと `Event` のリストを持ちます。主要なイベント種別は次のとおりです。

| kind | meaning |
| --- | --- |
| `text` | ユーザーまたはアシスタントのメッセージ |
| `thinking` | モデルの推論 |
| `tool_use` | ツール呼び出し(その `tool`、`input`、およびマージされた `result` を伴う) |
| `tool_result` | 単独の結果(通常はその `tool_use` にマージされる) |
| `hook` | フックの発火(そのイベント、トリガーとなったツール、コマンド、注入されたテキスト) |
| `summary` / `system` | メタデータ的なレコード |
| `unknown` | アダプタが特にマッピングしないあらゆるレコード種別 — そのまま保持され、決して破棄されない |

アシスタントターンは [トークン / コスト](./cost) のための `usage`(および `model`)を伴う場合があります。

## フックとプラグインの帰属

Claude Code はフックの発火をトランスクリプトに記録します。agtail はそれらを `hook` イベントとして表示します。**イベント**(PostToolUse、Stop、SessionStart、…)、**それをトリガーしたツール**(記録された `toolUseID` 経由で解決)、設定された**コマンド**、そして — `hook_additional_context` の場合 — **フックが注入したテキスト**です。

トランスクリプトはコマンド名を記録しますが、プラグインは記録しません。agtail は表示時にそのコマンドをローカルにインストールされたプラグインキャッシュ(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`)と照合することで、所有する**プラグイン**を解決します。これはローカルインストールのルックアップであるため、プラグインチップはこのマシンにインストールされたプラグインに対してのみ表示されます。他所からインポートされたセッションは解決されません。

## プログラム駆動セッションと派生セッション

セッションは、それが*どのように*起動されたか — Claude の `entrypoint`(`cli`、`sdk-py`、`sdk-ts`、`claude-desktop`、…)または Codex のオリジネーター — を記録します。agtail は SDK 駆動の起動を**プログラム駆動**として分類します(フィルタ可能で、UI では 🤖 でマークされます)。

プラグインは Agent SDK を介してヘッドレスなレビューを派生させることができますが、子セッションはプラグインへ戻るリンクを記録しません。agtail はそれを推論します。プラグインは自身のソース内のリテラルなテンプレートからレビュープロンプトを構築し、派生したセッションのプロンプトはその文字列そのままで始まるため、最初の行が SDK を呼び出すプラグインのソースと照合されます。これは意図的に最初の行の完全一致です(実際のセッションの監査により、緩いマッチングはプロンプトが内部の言い回しを共有するプラグインを誤帰属させることが示されました)。そしてフックの帰属と同様に、ローカルにインストールされたプラグインのみを解決します。

## Claude Code

- **場所:** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
- スキーマには多くのレコード種別があります。agtail は中核となる会話を正確にマッピングし、残りを `unknown` として表示します。
- Claude は 1 つの API レスポンスを複数行(コンテンツブロックごとに 1 行)にわたって書き込み、それぞれが同じ `usage` を繰り返します。agtail はトークンとコストが多重計上されないよう、使用量を **`message.id` ごとに 1 回**カウントします。
- **サブエージェント**は `<parentId>/subagents/agent-<id>.jsonl` に、兄弟の `.meta.json`(`agentType`、`description`、派生元の `toolUseId`)とともに存在します。agtail はそれらを親セッションの子としてタグ付けします。

## Codex

- **場所:** `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`
- 最近の Codex(v0.14x)はロールアウトを SQLite DB でインデックス化しますが、ファイルは glob で発見可能なため、agtail はそれらを直接読み取ります。
- 各行は `{ timestamp, type, payload }` です。agtail の正規のタイムラインは **`event_msg`** ストリーム(クリーンなユーザー / アシスタント / 推論 / ツールアクティビティ)です。並行する `response_item` ストリームは生の Responses-API ミラーであり — メッセージを繰り返し、大きなシステムプロンプトを伴う — ため、意図的に再投影されません。ストリーミングの `*_delta` イベントはスキップされ、それ以外のサブタイプは `unknown` として表示されます。

## トランスクリプトの完全性

壊れた行が 1 行あっても読み取りは中断せず、agtail はその行を飛ばして解析を続けます。ただし損失を隠しもしません。行単位(JSONL)のトランスクリプトでは、破棄した解析不能行を数え、さらに**最後の行**が壊れていた場合はそのセッションを **truncated**(書き込み途中で切れた＝中断・強制終了の強いシグナル)としてフラグします。どちらもセッションヘッダに赤い ⚠ の注記として表示され(CLI・web とも)、不完全な記録を綺麗な記録と取り違えないようにします。これはフィルタではなくフォレンジック上の注記で、綺麗に読めたセッションには何も付きません。

## セッションの終わり方とコンパクション

実行メカニクスのシグナルをもう2つ。いずれも**フォーマットが実際に記録している内容だけ**から読み取り、捏造しません。そのためどれが出るかはエージェントによって異なります。

- **終了** — 正常に終わらなかった場合のみフラグします。*interrupted*(turn が始まったのに完了しなかった＝Codex が `task_started` を書いたが対応する `task_complete` が無い)、または *limit*(最終 turn がモデルの出力トークン上限に達した＝Claude の `stop_reason: max_tokens`)。正常終了には何も付きません。
- **コンパクション** — エージェントがウィンドウ内に収めるため自身の文脈を圧縮した箇所を、agtail は境界イベントとして印を付け(Claude は `isCompactSummary` として記録)、セッション単位で数えます。境界より前の詳細はそれ以降のすべてから失われるため、後半の「X を忘れた」挙動の説明になることが多いです。Codex はコンパクションのマーカーを記録しないので、Codex セッションには出ません。

どちらもセッションヘッダ(CLI・web)に表示され、コンパクション境界は発生箇所でタイムラインにもインラインで印が付きます。

ネイティブのエージェントディレクトリに加えて、各アダプタは agtail 自身の**インポートストア**(`~/.local/share/agtail/imported/<collection>/<agent>/…`、`XDG_DATA_HOME` を尊重)も読み取ります。これはネイティブのレイアウトをミラーします。そこで見つかったセッションは `imported` とタグ付けされ、コレクション名を伴うため、同期されてきた履歴はローカル履歴と並んで検索可能になりますが、エージェントが再開できるセッションを装うことは決してありません。[Cross-machine sync](./sync) を参照してください。

## エージェントの追加

新しいエージェントは Claude Code / Codex と同じく **in-tree** で追加します。実行時にプラグインを読み込む仕組みはありません。アダプタを書いて登録するだけです(同種のローカルビューアと同じ方針。[位置づけのメモ](./vs-otel) 参照)。

手順:

1. `Adapter` を書く — 手書き、またはヘルパー(後述)経由。
2. `registerNodeAdapters`(`src/core/adapters/register-node.ts`)に登録する:
   ```ts
   registerAdapters((overrides) => [
     claudeCodeAdapter(overrides["claude-code"]),
     codexAdapter(overrides["codex"]),
     myAgentAdapter(overrides["my-agent"]),   // ← 追加
   ]);
   ```
   `Agent` id はオープンな文字列でバリデーションはレジストリ駆動のため、他のどのレイヤーも変更する必要はありません。id は CLI フィルタ・ファセット・Web UI へ自動的に流れます。`overrides["my-agent"]` を読むことで、`--dir my-agent=<path>` で既定以外のセッションルートを指定できるようになります。

アダプタは正規化された `Session` / `Event` の形を生成し、任意で `describeTool(tool, input)` を実装して自エージェントのツール呼び出しを 1 行に要約できます(`undefined` を返すと CLI・Web 双方が使う共通の要約器に委譲します)。

組み込みアダプタはフォーマットが独特なため `Adapter` インターフェース(`roots()`、`findSessions()`、`readSession()`、`transferFiles()`)を手書きしています。よくあるディスク配置なら、2 つの内部ヘルパーで大半をカバーできます。

### 楽な道: `fileAdapter`

**1 セッション = ディレクトリ配下の 1 JSONL ファイル**というよくある形なら、`fileAdapter`(`src/core/adapters/file-adapter.ts`)が `Adapter` を書いてくれます。ディレクトリ走査・インポートストアの走査・archived タグ付け・空スタブのスキップ・エクスポートを引き受け、あなたは `parse`(生レコード → `Session` のマッピング)だけを書きます:

```ts
import { fileAdapter } from "./file-adapter.js";

export const myAgentAdapter = (root?: string): Adapter =>
  fileAdapter({
    agent: "my-agent",
    root: root ?? "~/.my-agent/sessions",
    match: (name) => name.endsWith(".jsonl"),
    parse: (lines, ctx) => ({
      agent: "my-agent",
      id: ctx.id,          // ファイル名フォールバック。実 id がレコード内にあればそれを返す
      path: ctx.path,
      mtime: ctx.mtime,
      title: "…", messages: lines.length,
      events: lines.map(toEvent),   // ← 本質的な作業はここだけ
    }),
  });
```

**発見単位**(`unit`)を選び、**読み取りモード**をちょうど 1 つ指定します:

| 配置 | `unit` | 読み取りモード | 例 |
| --- | --- | --- | --- |
| 1 セッション = 1 JSONL ファイル | `"file"`(既定) | `parse(lines, ctx)` | Codex, Gemini CLI |
| 1 セッション = 1 JSON ファイル | `"file"` | `parseJson(data, ctx)` | Continue |
| 1 セッション/タスク = 1 ディレクトリ | `"dir"` | `read(path, ctx)` | Cline, Roo Code, OpenHands |
| その他(file/dir 単位) | どちらでも | `read(path, ctx)` | 任意 |

`match` は対象ファイルを選ぶ(unit:"file" では必須)か、サブディレクトリ名を絞り込みます(unit:"dir" では任意)。その他のオプション: `base`、`archivedRoot`(セッションを `archived` とタグ付けする第 2 のルート)、`transferMatch`、`importStore`(既定 true)、`skipEmpty`(既定 true)。誤設定(読み取りモードが 0 個/2 個以上、`match` 欠落)は登録時に throw します。

`buildSession(ctx, events, extra)`(同じモジュール)がイベントからタイトル・開始/終了時刻・モデル・メッセージ数を導出するため、`parse` は通常レコード → イベントのマッピングだけを行えば済みます。

`fileAdapter` がモデル化**しない**唯一の形は*1 ファイルに多数のセッションが入る*形(例: Aider の `.aider.chat.history.md`)です。これは単位 == セッションが崩れるため、`Adapter` インターフェースを直接手書きします。SQLite 系エージェントは `sqliteAdapter`(後述)を使います。

### SQLite 系エージェント: `sqliteAdapter`

一部のエージェントは履歴を 1 つの SQLite DB に多数のセッションを行として保持します(OpenCode, Goose, Cursor, …)。`sqliteAdapter`(`src/core/adapters/sqlite-adapter.ts`)を使います。Node 組み込みの `node:sqlite`(依存ゼロ・遅延ロード)で DB を読み取り専用で開き、ファイル欠落を許容し、合成セッション id ↔ path を対応付けます。あなたはエージェント固有の 2 つのクエリだけを書きます:

```ts
import { sqliteAdapter } from "./sqlite-adapter.js";

export const myAgentAdapter = (root?: string): Adapter =>
  sqliteAdapter({
    agent: "my-agent",
    db: root ?? "~/.my-agent/history.db",
    listSessions: (db) => db.prepare("select id, title, cwd from sessions").all().map(rowToMeta),
    readSession: (db, id) => rowsToSession(db, id),   // id で引いて Session を組む
  });
```

行は `unknown` フィールドを持つプレーンオブジェクトとして返るので、自分で絞り込みます。注意: `node:sqlite` は実験的機能(一度だけ警告を出力)で、DB 系セッションには**エクスポートがありません**(セッション単位のネイティブファイルが無いため)。特に Cursor はリバースエンジニアリングされたバージョン差のあるスキーマと複数の重なるストアを持つため、インストール済みバージョンに対して検証してください。

### インポートストア

`fileAdapter` / `sqliteAdapter` は agtail のインポートストア(同期されてきた履歴)を既に走査します。手書きの `Adapter` で同じ挙動が欲しい場合は、`src/core/imported.ts` から `collectionDir`、`collectionOf`、`listCollections` を import します。Codex アダプタが参照実装です。

**ブラウザ / playground 注記。** これらのアダプタは `node:fs` / `node:sqlite` を使う **Node 専用**で、CLI と自ホストの `agtail serve` で動きます。純 Web の playground は DI で `node:fs` を排除し、固定のインメモリアダプタ集合を積みます。(なお、ここでの「アダプタ」は Claude Code の*マーケットプレイス*プラグインとは無関係です。後者は [フック/SDK 帰属](#フックとプラグインの帰属) のためだけに読まれます。)
