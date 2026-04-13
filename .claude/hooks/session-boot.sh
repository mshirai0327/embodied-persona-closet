#!/bin/bash
# session-boot.sh — セッション開始時の身支度フック
# SessionStart(startup|resume) で発火する
# SOUL.md / BODY.md / STATUS.md / state.md をコンテキストに注入し、BOOT_SHUTDOWN.md の身支度手順を案内する
# stdout の内容がコンテキストに追加される

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

inject_context_file() {
  local path="$1"
  local label="$2"

  if [ -f "$path" ]; then
    echo "--- ${label} ---"
    cat "$path"
    echo ""
    echo "--- end ${label} ---"
    echo ""
  fi
}

# --- matcher を JSON stdin から取得 ---
INPUT=$(cat)
MATCHER=$(echo "$INPUT" | grep -o '"matcher":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null)

echo "[session-boot] type=${MATCHER:-unknown}"
echo ""

# --- SOUL.md / BODY.md / STATUS.md 注入 ---
if [ -f "$PROJECT_DIR/SOUL.md" ]; then
  inject_context_file "$PROJECT_DIR/SOUL.md" "SOUL.md"
  inject_context_file "$PROJECT_DIR/BODY.md" "BODY.md"
  inject_context_file "$PROJECT_DIR/STATUS.md" "STATUS.md"
else
  echo "[SOUL.md が見つかりません。/wd-setup を実行してください]"
  echo ""
fi

# --- state.md 注入 ---
if [ -f "$PROJECT_DIR/state.md" ]; then
  echo "--- state.md ---"
  cat "$PROJECT_DIR/state.md"
  echo ""
  echo "--- end state.md ---"
  echo ""
fi

# --- USB webcam アタッチ（WSL2） ---
if grep -qi "microsoft" /proc/version 2>/dev/null; then
  BUSID=$(powershell.exe -NonInteractive -NoProfile -Command "usbipd list" 2>/dev/null \
    | grep -i "Camera" | grep -i "Shared" | awk '{print $1}' | head -1)
  if [ -n "$BUSID" ]; then
    powershell.exe -NonInteractive -NoProfile -Command "usbipd attach --wsl --busid $BUSID" > /dev/null 2>&1
    echo "[session-boot] webcam attached: busid=$BUSID"
  fi
fi

# --- 身支度の案内 ---
echo "SOUL.md / BODY.md / STATUS.md / state.md は自動注入済み。BOOT_SHUTDOWN.md の身支度手順に従い、残りを実行してください。"
