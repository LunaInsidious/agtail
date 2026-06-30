# CLI

すべてのコマンドは `node dist/cli/index.js <command>`(または `agtail <command>`)で実行します。フラグの網羅的な一覧については、[CLI リファレンス](../reference/cli)を参照してください。

## grep — 主要コマンド

すべてのセッションを横断して検索します。

```sh
# すべてのエージェントを横断して用語を検索する
agtail grep blogsync

# ツール種別でフィルタ: Bash の実行のみ / 特定の Write のみ / MCP の副作用のみ
agtail grep "" --tool Bash
agtail grep "" --tool Write --cwd myproject
agtail grep "" --tool 'mcp__*'

# 複合条件: cwd × ツール × 期間 × エージェント、パイプ向けに NDJSON で出力
agtail grep deploy --agent codex --since 2026-06-01 --until 2026-06-24 --json
```

メッセージテキスト、ツール入力(command、file_path、url、query など)、ツール結果、思考(thinking)を検索します。`--tool` はグロブ(例: `mcp__*`)を受け付け、繰り返し指定可能です。

## list

セッションを新しい順に一覧表示します。ソースでタグ付けされ(claude / codex)、サブエージェントは親の下にネストされます。

```sh
agtail list
agtail list --agent codex
agtail list --project myproject
agtail list --source alice          # インポートしたコレクションのみ(後述)
```

## show

1 つのセッションのタイムラインを表示します。

```sh
agtail show <id>            # id はプレフィックスでも可
agtail show <id> --tools    # ツール呼び出しのみ
```

各アシスタントターンには、`[42,548 tok ≈$0.5851]` のようにトークン / コストが注記されます([トークンとコスト](./cost)を参照)。サブエージェントのセッションには `↳ subagent (Explore) of <parentId>` というヘッダーが表示されます。

## stats

ツール使用回数に加えて、トークン / コストの合計を表示します。

```sh
agtail stats <id>           # 1 つのセッション
agtail stats                # すべてのセッション
agtail stats --project foo
```

## export / import / sources

マシン間でセッションを移動します。`export` はローカルのセッション(任意でフィルタ可能)をポータブルな JSON ファイルにバンドルし、`import` はバンドルを名前付きコレクション(またはネイティブのエージェントディレクトリへ戻す形)に書き込み、`sources` はインポートしたコレクションを一覧表示します。

```sh
agtail export -o my-sessions.json
agtail export --query deploy --tool Bash -o audit.json    # grep と同様にフィルタ
agtail import alice.json --name alice                     # コレクション "alice" へ
agtail import my-sessions.json --to native                # エージェントディレクトリへ復元
agtail sources                                            # コレクションと件数を一覧表示
```

全体のモデル(コレクション、宛先、上書きゲート)については[マシン間同期](./sync)を参照してください。

## serve

ローカルの Web UI を起動します(127.0.0.1 のみ — 外部トラフィックなし)。

```sh
agtail serve                # http://127.0.0.1:8765
agtail serve --port 9000
```

詳細は [Web UI](./web-ui) を参照してください。

## 共通オプション

これらは**グローバル**オプションです — コマンドの前に置いてください。

| Option | Description |
| --- | --- |
| `--mask` | 出力中のシークレットをマスクする(デフォルトはオフ — 元のテキストが表示されます) |
| `--archived <mode>` | アーカイブされたセッション: `all`(デフォルト)/ `only` / `none` |
| `--programmatic <mode>` | プログラム駆動(SDK 駆動)のセッション: `all`(デフォルト)/ `only` / `none` |
| `--claude-dir <path>` | Claude Code のルートを上書きする(デフォルト `~/.claude/projects`) |
| `--codex-dir <path>` | Codex のルートを上書きする(デフォルト `~/.codex/sessions`) |

多くのサブコマンドは `--source <collection>` も受け付け、1 つのインポート済みコレクション(またはこのマシン自身のセッションを指す `@local`)にスコープを限定できます。
