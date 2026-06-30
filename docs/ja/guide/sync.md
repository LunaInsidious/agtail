# クロスマシン同期

トランスクリプトはマシンごとに存在します。agtail は一連のセッションを 1 つのポータブルな JSON バンドルに**エクスポート**し、別のマシンで**インポート**できます。これにより、単一のビューアで複数マシンを横断検索したり、1 人の監査者が複数人の履歴を並べてレビューしたりできます。

## エクスポート

エクスポートは、あなたの **native**（ローカルの、インポートされていない）セッションを 1 つの JSON ファイルにまとめます。

```sh
# everything, to a file
agtail export -o my-sessions.json

# a filtered subset (same filters as grep): only these become a bundle
agtail export --query deploy --tool Bash --since 2026-06-01 -o deploy-audit.json
agtail export --agent codex --cwd northwind-web -o web.json
```

Web UI では、リストヘッダーの **Export** アクションが同じ処理を行います。*Export all*、または検索 / フィルタがアクティブな場合は *Export results*（フィルタはサーバー側で上限なく再実行されるため、バンドルはフィルタした内容と正確に一致します）。

バンドルは、各トランスクリプトの相対パスと内容を保持するプレーンな JSON ドキュメント（`{ agtailExport: 1, created, files: [...] }`）です。差分を取りやすく、共有前に内容を確認しても安全です。

## インポート

インポートは、バンドルのセッションを 2 つの宛先のいずれかに書き込みます:

| 宛先 | 書き込み先 | 用途 |
| --- | --- | --- |
| **agtail**（デフォルト） | agtail 独自のインポートストア。名前付き**コレクション**にグループ化される | 自分のエージェントに触れずに他のマシンを閲覧 / 監査する |
| **native** | 実際のエージェントディレクトリ（`~/.claude/projects`、…） | 新しいマシンに自分のセッションを復元する |

```sh
# default: into the agtail store, collection "imported"
agtail import my-sessions.json

# into a named collection (one per person/machine you audit)
agtail import alice.json --name alice

# restore into the real agent dirs (your own sessions, new laptop)
agtail import my-sessions.json --to native

# allow overwriting files that already exist at the destination
agtail import my-sessions.json --overwrite
```

`--overwrite` がない場合、既に存在するファイルは**スキップ**され、コマンドは書き込まれた数とスキップされた数を報告します。宛先の外へ抜け出す（`..` による）バンドルのパスは拒否され、書き込まれることはありません。

::: warning native + overwrite（要注意）
`--to native --overwrite` は、稼働中のエージェントディレクトリに書き込み、*かつ*既存のファイルを置き換えます。これは実際の履歴を上書きしてしまう可能性のある唯一の組み合わせです。このため Web UI は、明示的な確認の背後にこの操作をゲートします。
:::

## コレクションとソース切替

agtail ストアへのインポートは**コレクション**（`imported/<collection>/<agent>/…`）にグループ化され、複数のソースを区別できます。各コレクションは 1 人の人物または 1 台のマシンです。

- `agtail sources` は、コレクションとそのセッション数を一覧表示します。
- Web UI では、**ソース切替（ソーススイッチャー）**（インポートが 1 つ以上あると表示されます）が、ビュー全体を *All sources*、*Local*（このマシン自身のセッション）、または 1 つのコレクションにスコープします。

インポートされたセッションは、エージェントが再開する可能性のあるローカル履歴になりすまさないようにタグ付けされます。これらは native ディレクトリの外に存在し、リスト上で目に見える形でマークされます。
