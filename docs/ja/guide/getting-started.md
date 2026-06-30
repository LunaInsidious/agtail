# agtail とは

**ag**(ent) + **tail** — コーディングエージェント(Claude Code、Codex)の履歴を対象としたフォレンジック検索ツールです。

エージェントは便利ですが不透明であり、「あの操作は実際に何をしたのか」を後から再構築するのは困難です。トランスクリプト(`~/.claude/projects/**/*.jsonl` など)には十分な情報が含まれていますが、3 つの限界があります。(1) 生の JSONL は人間が追える形式ではなく、複数セッションをまたいで grep できません。(2) これはツールが所有する揮発的なデータであり、監査ログではありません。(3) プロジェクトごと、セッションごと、マシンごとに散在しています。

agtail はこれらのギャップを埋めます。散在するトランスクリプトを、ツールやプロジェクトをまたいで grep できる単一の検索可能なプロジェクションへと正規化します。**検索こそが目的であり、閲覧は二次的なものです。** 全体的な背景については [コンセプト](./concepts) を参照してください。

![agtail の Web UI: 左側にソースでタグ付けされた統合セッション一覧、右側にセッションごとのタイムライン。](/screenshots/overview.png)

::: tip
本ドキュメント全体のスクリーンショットは、小さな架空のサンプルデータセット(「northwind」プロジェクト)を使用しており、誰かの実際の履歴ではありません。生成方法についてはリポジトリ内の `docs/screenshots/README.md` を参照してください。
:::

::: tip インストール不要で試す
[Playground](https://lunainsidious.github.io/agtail/playground/) は、同じ架空サンプルを使って agtail をブラウザ内だけで動かせます ── 検索・タイムライン・フック・エクスポート/インポート・ターミナル表示まで。アップロードは一切なく、インポートはメモリ上のみでリロードすると消えます。
:::

## 必要要件

- Node.js 20+
- pnpm
- 履歴を読みたいエージェント(Claude Code は `~/.claude/projects`、Codex は `~/.codex/sessions`)

## インストールとビルド

```sh
pnpm install
pnpm build      # Web SPA(dist-web)と CLI(dist)をビルドします
```

CLI は `node dist/cli/index.js <command>`(または `agtail` を使うなら `pnpm link --global`)で実行します。

## はじめの一歩

```sh
# 主要コマンド: すべてのセッションを横断して検索する
node dist/cli/index.js grep blogsync

# セッションを新しい順に、ソースでタグ付けして一覧表示する
node dist/cli/index.js list

# Web UI を起動する(127.0.0.1 のみ)
node dist/cli/index.js serve
# → http://127.0.0.1:8765
```

詳細は [CLI](./cli) と [Web UI](./web-ui) を参照してください。

## 本ドキュメントについて

ドキュメントサイトはアプリとは独立して管理されています(`docs/` 配下に独自の `package.json` を持ちます)。

```sh
cd docs
pnpm install
pnpm dev        # ローカルプレビュー
pnpm build      # 静的サイトを生成する(.vitepress/dist)
```
