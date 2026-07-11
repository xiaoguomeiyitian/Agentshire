import { getLocale } from '../i18n'

export interface ParsedCommand {
  type: 'frontend' | 'gateway'
  command: string
  args: string
  raw: string
}

const FRONTEND_COMMANDS = new Set(['new', 'clear', 'help'])

/**
 * Parse a chat input into a structured command (if it starts with `/`).
 * Returns null when the input is not a command.
 *
 * - `frontend`: handled entirely by the UI (e.g. /new, /help)
 * - `gateway`: forwarded to OpenClaw Gateway — the Gateway decides
 *   whether the command is valid; unrecognised ones are treated as
 *   normal chat by the Gateway itself, so we never need to maintain
 *   a command list here.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const match = text.match(/^\/([a-z][\w-]*)\s*([\s\S]*)$/i)
  if (!match) return null

  const command = match[1].toLowerCase()
  const args = match[2].trim()

  if (command === 'reset') {
    return { type: 'frontend', command: 'new', args, raw: text }
  }
  if (FRONTEND_COMMANDS.has(command)) {
    return { type: 'frontend', command, args, raw: text }
  }

  return { type: 'gateway', command, args, raw: text }
}

export const HELP_TEXT = [
  '可用指令：',
  '',
  '  /new [model]     创建新会话（可选模型参数）',
  '  /clear           清理当前会话消息',
  '  /stop            中止当前运行',
  '  /status          查看当前状态',
  '  /model [name]    查看/切换模型',
  '  /think <level>   设置思考深度',
  '  /tools           查看可用工具',
  '  /help            显示此帮助',
  '',
  '更多指令：/fast, /verbose, /reasoning, /btw, /usage, /context, /commands',
].join('\n')

const HELP_TEXT_EN = `Available commands:
  /new [model]     New session (optional model)
  /stop            Abort current run
  /status          View current status
  /model [name]    View/switch model
  /think <level>   Set thinking depth
  /tools           List tools
  /help            Show this help

More: /fast, /verbose, /reasoning, /btw, /usage, /context, /commands`

export function getHelpText(): string {
  return getLocale() === 'en' ? HELP_TEXT_EN : HELP_TEXT
}
