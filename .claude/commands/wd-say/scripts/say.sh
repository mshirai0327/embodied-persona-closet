#!/usr/bin/env bash
# say.sh — TTS CLI wrapper (fire-and-forget)
# Usage: say.sh "テキスト" [--speaker camera|local|both]
set -euo pipefail

# ${CLAUDE_SKILL_DIR} が設定されていればそこから wardrobe ルートを算出、
# なければスクリプト自身の場所から2段上（.claude/scripts/ -> .claude/ -> wardrobe/）を使う
if [ -n "${CLAUDE_SKILL_DIR:-}" ]; then
  # CLAUDE_SKILL_DIR = .claude/commands/wd-say → 3段上がプロジェクトルート
  WARDROBE_ROOT="$(dirname "$(dirname "$(dirname "$CLAUDE_SKILL_DIR")")")"
else
  # SCRIPT_DIR = .claude/commands/wd-say/scripts → 4段上がプロジェクトルート
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  WARDROBE_ROOT="$(dirname "$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")")"
fi

TTS_DIR="${WARDROBE_ROOT}/.claude/mcps/tts-mcp"
export MCP_BEHAVIOR_TOML="${WARDROBE_ROOT}/mcpBehavior.toml"

LOG_FILE="${WARDROBE_ROOT}/logs/tts-say.log"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
echo "[$TIMESTAMP] say: $*" >> "$LOG_FILE"
uv run --directory "$TTS_DIR" python -m tts_mcp.cli "$@" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
echo "[$TIMESTAMP] exit: $EXIT_CODE" >> "$LOG_FILE"
exit $EXIT_CODE
