# agtail — エージェント機能カバレッジ 検証 TODO

背景（2026-07-02）: fresh な `claude -p` / `codex exec` セッション（最新スキーマ Claude Code 2.1.196 / Codex 0.142.0）に対して agtail を実地検証。広い範囲は正しく表示できたが、以下は **非対話 headless では誘発できず live 未検証**。各項目: 機能を再現 → agtail が正しく表示するか確認（ダメなら修正）。

凡例: 🎯 = 誘発方法 · ✅ = agtail が出すべき表示。

## Claude Code

- [ ] **Skill 呼び出し** — 🎯 対話 `claude` でスキル起動（`/deep-research`・`/commit` 等、または自動発火）。✅ `Skill` tool_use が `skill名  args` に整形（summarizer 追加済・live 未確認）。
- [ ] **画像入力** — 🎯 対話セッションで画像を貼付/添付。✅ フロー内に `🖼 [image]`（blockEvent＋tool_result 対応済・単体テスト済、live 確認したい）。media type 表示も検討。
- [ ] **MCP ツール（`mcp__*`）** — 🎯 MCP サーバを設定し呼ぶセッションを実行。✅ 可読表示 — **現状 summarizer が無く生 JSON**。mcp__* 用サマリ（server/tool＋主要 args）を検討。
- [ ] **AskUserQuestion** — 🎯 エージェントが質問する対話セッション。✅ `AskUserQuestion` → 質問文 / `N questions`（summarizer 追加済・live 未確認）。
- [ ] **plan mode / ExitPlanMode** — 🎯 plan mode で実行し plan を承認。✅ `ExitPlanMode` → plan の1行目（summarizer 追加済・live 未確認）。
- [ ] **WebFetch** — 🎯 実際の fetch を誘発（WebSearch だけでなく）。✅ URL を表示。
- [ ] **MultiEdit / NotebookEdit** — 🎯 誘発。✅ file_path 表示（Edit と同ロジック）。
- [ ] **TodoWrite（ツールとして）** — 🎯 多段タスクで TodoWrite ツールを実発火させる（live テストでは inline markdown で出た）。✅ `N todos · ▶ <active>`。
- [ ] **StructuredOutput / Workflow / Monitor** — 実履歴に出現（StructuredOutput は頻出）だが **summarizer が無く生 JSON / 巨大スクリプトのダンプ**。サマリを追加。

## Codex

- [ ] **サブエージェント: spawn_agent / wait_agent / close_agent** — 🎯 サブエージェントを spawn する codex 実行。✅ **現状は名前そのまま → JSON サマリ**。summarizer 追加＋Claude 同様の親子リンク（linkage）を検討。
- [ ] **tool_search_call / tool_search_output** — 🎯 codex の tool search を誘発。✅ **現状タイムラインに投影されず（ドロップ）** — `codex.ts` に処理を追加。
- [ ] **画像入力 / MCP / web search** — 🎯 各々誘発して表示確認。

## その他やるべきこと

- [ ] **Playwright e2e を UX worktree で再実行** — web 変更（session loading / EventRow ツールサマリ / Timeline ヘッダ時刻 / sidebar `.automark` 省略）は unit・`pnpm check` のみで、e2e 未確認。
- [ ] **ux/session-loading の視覚確認**（現状ロジック/check のみ。他はスクショ済）。
- [ ] 検証で作ったテストセッションの掃除: `~/.claude/projects/-private-tmp-agtail-live-test/`、本日の `~/.codex/sessions/2026/07/02/rollout-…`、`/private/tmp/agtail-live-test/`。
