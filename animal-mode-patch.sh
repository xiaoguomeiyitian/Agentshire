#!/usr/bin/env bash
# ============================================================
# Agentshire 动森模式补丁 — 交互式管理工具
# 用法: ./animal-mode-patch.sh
# ============================================================

set -euo pipefail

PATCH_FILE="agentshire-animal-mode.patch"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 颜色定义 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ── 显示菜单 ──
show_menu() {
  clear
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   ${BOLD}Agentshire 动森模式补丁管理工具${NC}                        ${CYAN}║${NC}"
  echo -e "${CYAN}╠══════════════════════════════════════════════════════════╣${NC}"
  echo -e "${CYAN}║${NC}                                                            ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}1)${NC}  生成补丁      ${DIM}gen${NC}     - 打包所有未提交修改        ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}2)${NC}  应用补丁      ${DIM}apply${NC}   - 在本地仓库还原补丁        ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}3)${NC}  检查补丁      ${DIM}check${NC}   - dry-run 检查能否应用      ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}4)${NC}  撤销补丁      ${DIM}unapply${NC} - reverse 撤销已应用补丁    ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}5)${NC}  查看状态      ${DIM}status${NC}  - 显示当前仓库修改状态      ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}0)${NC}  退出                                                     ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}                                                            ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # 显示补丁文件状态
  if [ -f "$PATCH_FILE" ]; then
    local patch_size
    patch_size=$(ls -lh "$PATCH_FILE" | awk '{print $5}')
    local file_count
    file_count=$(grep -c "^diff --git" "$PATCH_FILE" 2>/dev/null || echo 0)
    echo -e "  ${GREEN}●${NC} 补丁文件存在: ${BOLD}$PATCH_FILE${NC} ${DIM}($file_count 个文件, $patch_size)${NC}"
  else
    echo -e "  ${RED}○${NC} 补丁文件不存在: $PATCH_FILE"
  fi

  # 显示仓库状态摘要
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local modified
    modified=$(git status --short | wc -l | tr -d ' ')
    if [ "$modified" -gt 0 ]; then
      echo -e "  ${YELLOW}●${NC} 当前有 ${BOLD}$modified${NC} 个文件未提交修改"
    else
      echo -e "  ${GREEN}●${NC} 工作区干净，无未提交修改"
    fi
  fi
  echo ""
  echo -ne "请输入选项 ${DIM}[0-5]${NC}: "
}

# ── gen: 生成补丁 ──
cmd_gen() {
  echo ""
  echo -e "${CYAN}▶ 正在生成补丁...${NC}"
  echo ""

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${RED}✗ 当前目录不是 git 仓库${NC}"
    return 1
  fi

  if git diff --quiet HEAD && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo -e "${YELLOW}⚠ 没有未提交的修改，无需生成补丁${NC}"
    return 0
  fi

  local staged_files
  staged_files=$(git diff --cached --name-only 2>/dev/null || true)

  git add -A
  git reset -- "$PATCH_FILE" "animal-mode-patch.sh" >/dev/null 2>&1 || true
  git diff --cached --binary > "$PATCH_FILE"

  git reset --mixed HEAD >/dev/null 2>&1
  if [ -n "$staged_files" ]; then
    echo "$staged_files" | xargs -I{} git add {} 2>/dev/null || true
  fi

  local file_count
  file_count=$(grep -c "^diff --git" "$PATCH_FILE" || echo 0)
  local patch_size
  patch_size=$(ls -lh "$PATCH_FILE" | awk '{print $5}')

  echo -e "${GREEN}✓ 补丁已生成: $PATCH_FILE${NC}"
  echo -e "  ${DIM}文件数: ${BOLD}$file_count${NC}"
  echo -e "  ${DIM}大小:   ${BOLD}$patch_size${NC}"
  echo ""
  echo -e "${DIM}包含的文件:${NC}"
  grep "^diff --git" "$PATCH_FILE" | sed 's|diff --git a/||;s| b/.*||' | sort | sed 's/^/  /'
}

# ── apply: 应用补丁 ──
cmd_apply() {
  echo ""
  if [ ! -f "$PATCH_FILE" ]; then
    echo -e "${RED}✗ 补丁文件 $PATCH_FILE 不存在${NC}"
    echo -e "  ${DIM}请先执行选项 1) 生成补丁${NC}"
    return 1
  fi

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${RED}✗ 当前目录不是 git 仓库${NC}"
    return 1
  fi

  echo -e "${CYAN}▶ 正在应用补丁...${NC}"
  echo ""

  if git apply --whitespace=fix "$PATCH_FILE"; then
    echo -e "${GREEN}✓ 补丁应用成功${NC}"
    echo ""
    echo -e "${DIM}已修改的文件:${NC}"
    git status --short | sed 's/^/  /'
  else
    echo -e "${YELLOW}⚠ 普通模式应用失败，尝试 3way 合并模式...${NC}"
    if git apply --whitespace=fix --3way "$PATCH_FILE"; then
      echo -e "${GREEN}✓ 3way 模式应用成功${NC}"
    else
      echo -e "${RED}✗ 3way 模式也失败，请手动解决冲突${NC}"
      echo -e "  ${DIM}提示: 检查 git status 查看冲突文件${NC}"
      return 1
    fi
  fi
}

# ── check: 检查补丁能否应用 ──
cmd_check() {
  echo ""
  if [ ! -f "$PATCH_FILE" ]; then
    echo -e "${RED}✗ 补丁文件 $PATCH_FILE 不存在${NC}"
    return 1
  fi

  echo -e "${CYAN}▶ 正在检查补丁（dry-run）...${NC}"
  echo ""

  if git apply --check --whitespace=fix "$PATCH_FILE" 2>&1; then
    echo -e "${GREEN}✓ 补丁可以干净应用${NC}"
  else
    echo -e "${YELLOW}⚠ 普通模式无法干净应用，尝试 3way 模式...${NC}"
    if git apply --check --whitespace=fix --3way "$PATCH_FILE" 2>&1; then
      echo -e "${GREEN}✓ 3way 模式可以应用${NC}"
    else
      echo -e "${RED}✗ 3way 模式也无法应用，需要手动处理${NC}"
      return 1
    fi
  fi
}

# ── unapply: 撤销补丁 ──
cmd_unapply() {
  echo ""
  if [ ! -f "$PATCH_FILE" ]; then
    echo -e "${RED}✗ 补丁文件 $PATCH_FILE 不存在${NC}"
    return 1
  fi

  echo -e "${CYAN}▶ 正在撤销补丁...${NC}"
  echo ""

  if git apply --reverse --whitespace=fix "$PATCH_FILE"; then
    echo -e "${GREEN}✓ 补丁已撤销${NC}"
  else
    echo -e "${YELLOW}⚠ 普通模式撤销失败，尝试 3way 模式...${NC}"
    if git apply --reverse --whitespace=fix --3way "$PATCH_FILE"; then
      echo -e "${GREEN}✓ 3way 模式撤销成功${NC}"
    else
      echo -e "${RED}✗ 撤销失败，请手动处理${NC}"
      return 1
    fi
  fi
}

# ── status: 查看仓库状态 ──
cmd_status() {
  echo ""
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${RED}✗ 当前目录不是 git 仓库${NC}"
    return 1
  fi

  echo -e "${CYAN}▶ 当前仓库修改状态:${NC}"
  echo ""
  git status --short
  echo ""

  local modified
  modified=$(git status --short | wc -l | tr -d ' ')
  echo -e "共 ${BOLD}$modified${NC} 个文件有变更"

  if [ -f "$PATCH_FILE" ]; then
    local patch_size
    patch_size=$(ls -lh "$PATCH_FILE" | awk '{print $5}')
    local file_count
    file_count=$(grep -c "^diff --git" "$PATCH_FILE" || echo 0)
    echo -e "${GREEN}●${NC} 补丁文件 $PATCH_FILE 存在 ${DIM}($file_count 个文件, $patch_size)${NC}"
  else
    echo -e "${RED}○${NC} 补丁文件 $PATCH_FILE 不存在"
  fi
}

# ── 等待用户按键继续 ──
pause() {
  echo ""
  echo -ne "${DIM}按 Enter 键继续...${NC}"
  read -r
}

# ── 主循环 ──
while true; do
  show_menu
  read -r choice

  case "$choice" in
    1) cmd_gen     ; pause ;;
    2) cmd_apply   ; pause ;;
    3) cmd_check   ; pause ;;
    4) cmd_unapply ; pause ;;
    5) cmd_status  ; pause ;;
    0)
      echo ""
      echo -e "${DIM}再见 👋${NC}"
      exit 0
      ;;
    *)
      echo ""
      echo -e "${RED}✗ 无效选项: $choice${NC}"
      echo -ne "${DIM}按 Enter 键继续...${NC}"
      read -r
      ;;
  esac
done
