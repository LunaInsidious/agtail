---
layout: home

hero:
  name: agtail
  text: コーディングエージェント履歴の横断検索
  tagline: Claude Code と Codex を横断する、事後検索のためのフォレンジックツール ——「あの操作はどこで起きて、何をしたのか？」。まず検索、閲覧は二の次。
  actions:
    - theme: brand
      text: はじめる
      link: /ja/guide/getting-started
    - theme: alt
      text: コンセプト
      link: /ja/guide/concepts
    - theme: alt
      text: Playground を試す
      link: https://lunainsidious.github.io/agtail/playground/

features:
  - title: 検索優先
    details: grep が主役。tool × model × cwd × 期間 × エージェント × 由来 の複合フィルタを中心に据えた横断検索。タイムラインや統計はその副産物です。
  - title: エージェント非依存
    details: Claude Code と Codex を単一のスキーマに正規化し、同じインターフェースで読みます。エージェントをいくつ足しても入り口は一つ。
  - title: 読み取り専用
    details: 一切編集しません。固定された過去を忠実に再生・抽出するだけ。元のトランスクリプトはそのまま、agtail はインデックスと検索だけを持ちます。
  - title: CLI と Web UI
    details: ターミナルから agtail grep / list / show / stats で問い合わせるか、agtail serve で検索優先の2ペイン UI を開きます。
  - title: トークンとコスト
    details: ターンごとのトークン数と概算コスト。価格は LiteLLM 由来で、掲載のないモデルは推測せず「不明」と表示します。
  - title: フックとプラグイン帰属
    details: フックの発火を検索可能な一級イベントとして扱います ── どのイベントが、どのツールを契機に発火し、どんなテキストを注入し、どの導入済みプラグインに属するか。
  - title: プログラム駆動・サブエージェントのセッション
    details: SDK 起動やサブエージェントのセッションを検出し、文脈の下にネストします。起動されたレビューは、それを起動したプラグインへ帰属します。
  - title: マシン間同期
    details: セッションを可搬な束（バンドル）にエクスポートし、別マシンで名前付きコレクションにインポート。複数マシン・複数人の履歴を一つのビューアで並べて監査できます。
---
