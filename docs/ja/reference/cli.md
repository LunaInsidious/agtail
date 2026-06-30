# CLI リファレンス

```
agtail [global options] <command> [command options]
```

## グローバルオプション

これらはコマンドの前に置いてください。

| Option | Description |
| --- | --- |
| `--mask` | 出力中のシークレットをマスクする(デフォルトはオフ) |
| `--archived <mode>` | アーカイブされたセッション: `all`(デフォルト)/ `only` / `none` |
| `--programmatic <mode>` | プログラム駆動(SDK 駆動)のセッション: `all`(デフォルト)/ `only` / `none` |
| `--claude-dir <path>` | Claude Code のルートを上書きする(デフォルト `~/.claude/projects`) |
| `--codex-dir <path>` | Codex のルートを上書きする(デフォルト `~/.codex/sessions`) |

## `grep <pattern>`

すべてのセッションを横断して検索します。空のパターン(`""`)はフィルタのみを意味します。

| Option | Description |
| --- | --- |
| `--agent <agents>` | エージェントに限定する。カンマ区切り: `claude-code,codex` |
| `--tool <glob>` | ツールに限定する。繰り返し指定可能。グロブ可(`Bash`、`Write`、`mcp__*`) |
| `--cwd <substr>` | cwd にこれを含むセッションに限定する |
| `--since <date>` | この ISO 日付以降のイベントのみ |
| `--until <date>` | この ISO 日付以前のイベントのみ(日付のみの場合はその日全体を含む) |
| `--kind <kinds>` | イベント種別に限定する。カンマ区切り |
| `--source <name>` | 1 つのインポート済みコレクションに限定する(`sources` を参照) |
| `--regex` | パターンを正規表現として扱う |
| `--case-sensitive` | 大文字小文字を区別してマッチする(デフォルトは大文字小文字を区別しない) |
| `--limit <n>` | n 件のマッチで停止する |
| `--json` | NDJSON を出力する(1 行につき 1 マッチ) |

## `list`

| Option | Description |
| --- | --- |
| `--agent <agents>` | エージェントに限定する(カンマ区切り) |
| `--project <substr>` | cwd の部分文字列でフィルタする |
| `--source <name>` | 1 つのインポート済みコレクションに限定する |
| `--since <date>` / `--until <date>` | 期間でフィルタする |

## `show <id>`

`id` はプレフィックスでも可です。

| Option | Description |
| --- | --- |
| `--agent <agents>` | エージェントに限定する(カンマ区切り) |
| `--tools` | ツール呼び出しのみを表示する |

## `stats [id]`

| Option | Description |
| --- | --- |
| `--agent <agents>` | エージェントに限定する(カンマ区切り) |
| `--project <substr>` | cwd の部分文字列でフィルタする |

## `export`

ネイティブ(ローカル)のセッションをポータブルな JSON エクスポートにバンドルします。フィルタは**どのセッションを**バンドルするかを選択し、各マッチはトランスクリプト全体をエクスポートします。フィルタを指定しない場合は、すべてのセッションがエクスポートされます。[マシン間同期](../guide/sync)を参照してください。

| Option | Description |
| --- | --- |
| `-o, --out <file>` | バンドルをファイルに書き込む(デフォルト: stdout) |
| `--agent <agents>` | エージェントに限定する(カンマ区切り) |
| `--query <text>` | コンテンツがこのテキストにマッチするセッションのみ |
| `--tool <glob>` | あるツールを使用するセッションのみ。繰り返し指定可能。グロブ可 |
| `--model <name>` | あるモデルを使用するセッションのみ。繰り返し指定可能 |
| `--cwd <substr>` | cwd にこれを含むセッションのみ |
| `--since <date>` / `--until <date>` | 期間内にアクティビティのあるセッションのみ |
| `--kind <kinds>` | これらのイベント種別を含むセッションのみ(カンマ区切り) |

## `import <file>`

セッションバンドルをインポートします。パストラバーサルのエントリと(`--overwrite` なしの場合)既存のファイルはスキップされ、書き込まれません。

| Option | Description |
| --- | --- |
| `--to <dest>` | 宛先: `agtail`(インポートストア、デフォルト)/ `native`(エージェントディレクトリ) |
| `--name <collection>` | `agtail` モードでインポート先となるコレクション(デフォルト `imported`) |
| `--overwrite` | 宛先に既に存在するファイルを上書きする |

## `sources`

オプションなし。インポートしたコレクション(それぞれ同期された 1 人 / 1 マシン)とそのセッション件数を一覧表示します。

## `serve`

| Option | Description |
| --- | --- |
| `--port <n>` | ポート(デフォルト `8765`)。常に `127.0.0.1` にバインドされます |

## 出力

- `grep` のデフォルト出力は 1 ヒットにつき 1 行: `agent:sessionId  timestamp  kind  tool  snippet`。`--json` を指定すると、各行が JSON のマッチオブジェクト(NDJSON)となり、パイプに適します。
- `show` はターンごとのトークン / コストのバッジ付きでタイムラインを表示します。
- `stats` はツール使用回数とトークン / コストの合計を表示します。
- `export` は JSON バンドルを書き込み(または表示し)、`import` は書き込まれたファイル数とスキップされたファイル数を報告します。
