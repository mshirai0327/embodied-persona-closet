# Repository Guidelines

## Overview

embodied-claude-wardrobe は、Claude に「身体性」を与える MCP サーバー群と自律行動システムのモノレポです。感覚（視覚・聴覚・音声）、記憶、移動、欲望システムなどを独立した Python パッケージとして提供します。

## Project Structure

各 MCP サーバーは独立した Python パッケージ（`pyproject.toml` を持つ）です。

### MCP サーバー
- `.claude/mcps/memory-mcp/` — 長期記憶サーバー（連想発散・予測符号化・統合機能付き）。テストあり
- `.claude/mcps/hearing/` — 聴覚 MCP サーバー。テストあり
- `.claude/mcps/tts-mcp/` — テキスト読み上げ MCP サーバー。テストあり
- `.claude/mcps/wifi-cam-mcp/` — Wi-Fi PTZ カメラ制御 + 音声キャプチャ
- `.claude/mcps/usb-webcam-mcp/` — USB ウェブカメラキャプチャ
- `.claude/mcps/ip-webcam-mcp/` — IP ウェブカメラ MCP
- `.claude/mcps/system-temperature-mcp/` — システム温度センサー（Python 3.12+ 必須）
- `.claude/mcps/mobility-mcp/` — ロボット掃除機 MCP。テストあり
- `.claude/mcps/toio-mcp/` — toio キューブ MCP。テストあり
- `.claude/mcps/mcp-pet/` — ペットインタラクション MCP。テストあり
- `.claude/mcps/morning-call-mcp/` — モーニングコール MCP

### その他
- `.claude/scripts/` — Bun (TypeScript) のユーティリティスクリプト
- `.claude/hooks/` — Bash フック（`interoception.sh`, `recall-hook.sh` 等）
- `.claude/templates/` — ユーザーカスタマイズ用 Markdown テンプレート
- `installer/` — PyInstaller ベースの GUI インストーラー
- `docs/` — ドキュメントとアーキテクチャ図
- `autonomous-action.sh` — cron で 20 分ごとに実行する自律行動スクリプト
- `mcpBehavior.toml` — MCP 動作設定

## Development Commands

### Bun scripts
リポジトリルートで実行します。

```bash
bun install --frozen-lockfile
bun run typecheck:scripts
bun run test:scripts
```

- `bun run typecheck:scripts` は TypeScript 型チェックのみ。
- `bun run test:scripts` は CI 対象の Bun unit test。Kuzu 連携テストは通常 skip します。
- Kuzu 連携まで確認したい場合だけ `bun run test:scripts:kuzu` を実行します。
- スクリプト単体の実行は `bun .claude/scripts/<script-name>.ts` を使います。

### Python MCP packages
対象サブプロジェクトのディレクトリで実行します。

```bash
uv sync
uv run pytest
uv run ruff check .
```

- サーバー起動は `uv run <server-name>`。
- Lint や mypy は設定済みのサブプロジェクトでのみ実行します。

## Coding Style

- Python は 3.10+ 基準。ただし `.claude/mcps/system-temperature-mcp/` は 3.12+ 必須。
- Python は 4 スペースインデント、`snake_case` モジュール、`test_*.py` テストファイル。
- Ruff の行長は 100 文字。
- 非同期処理は `asyncio` スタイルを基本にします。
- TypeScript は Bun ランタイム前提。Node.js API より Bun ネイティブ API を優先します。

## Testing

- Python は `pytest` + `pytest-asyncio`。
- Python テストは各サブプロジェクトの `tests/` に置きます。
- Bun unit test は `.claude/scripts/*.test.ts`。
- CI 対象の Bun test は `bun run test:scripts`。
- Kuzu DB を開くテストは外部連携寄りなので CI から除外し、`bun run test:scripts:kuzu` で任意実行します。
- テストがある MCP パッケージ: `memory-mcp`, `hearing`, `tts-mcp`, `mobility-mcp`, `toio-mcp`, `mcp-pet`

## Configuration & Hardware Notes

- `.env` はコミットしない。認証情報は環境変数で渡します。
- 長期記憶データは `~/.claude/memories/` 以下に保存されます。
- WSL2 では USB ウェブカメラに `usbipd` フォワーディングが必要です。
- WSL2 ではシステム温度取得が動作しません。
- Tapo カメラはローカルカメラアカウント（TP-Link クラウドアカウントではない）と固定 IP を推奨します。

## Git Workflow

- 変更前に `git status --short --branch` を確認します。
- 既存の未コミット変更を勝手に戻さないでください。
- コミットする場合は、対象ファイルを明示して `git add <files>` します。
- コミットメッセージは Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`。
- メッセージ本文の最後に、次の co-author trailer を 1 行だけ正確に入れます。余計な文字、句読点、説明文を足さないでください。

```text
Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>
```

例:

```bash
git commit -m "fix: Bun scripts のCIを修正" \
  -m "Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

PR にはサマリー、テスト証跡（コマンドと結果）、ハードウェア前提（USB ウェブカメラ、GPU 等）を含めます。

## Subagents

サブエージェントを使える環境で、かつユーザーまたは上位指示が許可している場合だけ使います。使う場合は、担当範囲と編集対象ファイルを明確に分け、他の作業者の変更を戻さないようにします。
