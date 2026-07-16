import { getLocale } from '../i18n'

export interface ParsedCommand {
  type: 'frontend' | 'gateway'
  command: string
  args: string
  raw: string
}

/** A command definition for autocomplete suggestions. */
export interface CommandSuggestion {
  /** Command name without the leading slash, e.g. "new", "reset". */
  name: string
  /** Short description shown in the autocomplete popup. */
  description: string
  /** Usage hint for the argument portion, e.g. "[model]", "[off|tokens|full]". Empty string if no args. */
  argsHint: string
  /** Whether this command is handled entirely by the frontend (vs forwarded to Gateway). */
  frontend: boolean
}

/** All known commands for autocomplete. Ordered by importance.
 *
 * Gateway commands mirror the OpenClaw slash-command catalog
 * (see openclaw docs/tools/slash-commands.md). The frontend only
 * intercepts /new, /clear and /help; everything else is forwarded
 * to the Gateway, which decides validity.
 */
const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  // ── Frontend-only ──
  { name: 'new', description: '创建新会话', argsHint: '[model]', frontend: true },
  { name: 'clear', description: '清理当前会话消息', argsHint: '', frontend: true },
  { name: 'help', description: '显示帮助', argsHint: '', frontend: true },
  // ── Sessions and runs ──
  { name: 'reset', description: '原地重置会话（保留会话 ID）', argsHint: '[soft [message]]', frontend: false },
  { name: 'compact', description: '压缩上下文', argsHint: '[instructions]', frontend: false },
  { name: 'stop', description: '中止当前运行', argsHint: '', frontend: false },
  { name: 'name', description: '命名/重命名当前会话', argsHint: '<title>', frontend: false },
  { name: 'export-session', description: '导出当前会话为 HTML', argsHint: '[path]', frontend: false },
  { name: 'export-trajectory', description: '导出 JSONL 轨迹', argsHint: '[path]', frontend: false },
  // ── Model and run controls ──
  { name: 'model', description: '查看/切换模型', argsHint: '[name|#|status]', frontend: false },
  { name: 'models', description: '列出可用模型', argsHint: '[provider] [page]', frontend: false },
  { name: 'think', description: '设置思考深度', argsHint: '<level|default>', frontend: false },
  { name: 'reasoning', description: '切换推理可见性', argsHint: '[on|off|stream]', frontend: false },
  { name: 'fast', description: '快速模式', argsHint: '[status|auto|on|off|default]', frontend: false },
  { name: 'verbose', description: '详细模式', argsHint: 'on|off|full', frontend: false },
  { name: 'trace', description: '切换插件追踪输出', argsHint: 'on|off', frontend: false },
  { name: 'elevated', description: '切换提权模式', argsHint: '[on|off|ask|full]', frontend: false },
  { name: 'queue', description: '管理运行队列行为', argsHint: '<mode>', frontend: false },
  { name: 'steer', description: '向当前运行注入指导', argsHint: '<message>', frontend: false },
  // ── Discovery and status ──
  { name: 'commands', description: '列出所有命令', argsHint: '', frontend: false },
  { name: 'tools', description: '查看可用工具', argsHint: '[compact|verbose]', frontend: false },
  { name: 'status', description: '查看执行/运行时状态', argsHint: '', frontend: false },
  { name: 'context', description: '查看上下文组装信息', argsHint: '[list|detail|map|json]', frontend: false },
  { name: 'usage', description: '设置用量显示模式', argsHint: '[off|tokens|full|reset|cost]', frontend: false },
  { name: 'whoami', description: '显示你的发送者 ID', argsHint: '', frontend: false },
  { name: 'tasks', description: '列出后台任务', argsHint: '', frontend: false },
  { name: 'goal', description: '管理当前会话目标', argsHint: '[status|start|edit|clear] ...', frontend: false },
  // ── Skills, allowlists, approvals ──
  { name: 'skill', description: '运行指定技能', argsHint: '<name> [input]', frontend: false },
  { name: 'learn', description: '从对话中草拟技能', argsHint: '[request]', frontend: false },
  { name: 'btw', description: '顺便提问（不改变上下文）', argsHint: '<question>', frontend: false },
  { name: 'approve', description: '解决审批提示', argsHint: '<id> <decision>', frontend: false },
  // ── Subagents and ACP ──
  { name: 'subagents', description: '查看子代理运行', argsHint: 'list|log|info', frontend: false },
  { name: 'agents', description: '列出会话绑定的代理', argsHint: '', frontend: false },
  // ── Owner-only admin ──
  { name: 'config', description: '读写 openclaw.json 配置', argsHint: 'show|get|set|unset', frontend: false },
  { name: 'mcp', description: '管理 MCP 服务器配置', argsHint: 'show|get|set|unset', frontend: false },
  { name: 'plugins', description: '管理插件', argsHint: 'list|inspect|enable|disable', frontend: false },
  { name: 'debug', description: '运行时配置覆盖', argsHint: 'show|set|unset|reset', frontend: false },
  { name: 'restart', description: '重启 OpenClaw', argsHint: '', frontend: false },
  // ── Voice, TTS, channel ──
  { name: 'tts', description: '控制 TTS 语音', argsHint: 'on|off|status|help', frontend: false },
  { name: 'bash', description: '运行主机 shell 命令', argsHint: '<command>', frontend: false },
]

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

  if (FRONTEND_COMMANDS.has(command)) {
    return { type: 'frontend', command, args, raw: text }
  }

  return { type: 'gateway', command, args, raw: text }
}

export const HELP_TEXT = [
  '可用指令：',
  '',
  '  /new [model]           创建新会话（可选模型参数）',
  '  /clear                 清理当前会话消息',
  '  /reset [soft [msg]]    原地重置会话（soft 保留记录）',
  '  /compact [instr]       压缩上下文（可选压缩指导）',
  '  /stop                  中止当前运行',
  '  /name <title>          命名/重命名当前会话',
  '  /model [name]          查看/切换模型',
  '  /models [provider]     列出可用模型',
  '  /think <level>         设置思考深度',
  '  /reasoning [on|off|stream]  切换推理可见性',
  '  /fast [on|off|auto]    快速模式',
  '  /verbose on|off|full   详细模式',
  '  /trace on|off          插件追踪',
  '  /usage [off|tokens|full|cost]  用量显示',
  '  /tools [compact]       查看可用工具',
  '  /status                查看运行时状态',
  '  /context [list|json]   查看上下文信息',
  '  /whoami                显示发送者 ID',
  '  /tasks                 列出后台任务',
  '  /goal [status|clear]   管理会话目标',
  '  /skill <name>          运行技能',
  '  /learn [request]       草拟技能',
  '  /btw <question>        顺便提问',
  '  /subagents list        查看子代理',
  '  /agents                列出绑定代理',
  '  /help                  显示此帮助',
  '  /commands              列出所有命令',
  '',
  '管理员：/config, /mcp, /plugins, /debug, /restart',
  '语音：/tts, /bash <command>',
].join('\n')

const HELP_TEXT_EN = `Available commands:
  /new [model]           New session (optional model)
  /clear                 Clear current chat messages
  /reset [soft [msg]]    Reset session in place (soft keeps transcript)
  /compact [instr]       Compact context (optional instructions)
  /stop                  Abort current run
  /name <title>          Name or rename the session
  /model [name]          View/switch model
  /models [provider]     List available models
  /think <level>         Set thinking depth
  /reasoning [on|off|stream]  Toggle reasoning visibility
  /fast [on|off|auto]    Fast mode
  /verbose on|off|full   Verbose mode
  /trace on|off          Plugin trace
  /usage [off|tokens|full|cost]  Usage footer
  /tools [compact]       List tools
  /status                Runtime status
  /context [list|json]   Context info
  /whoami                Show sender id
  /tasks                 List background tasks
  /goal [status|clear]   Manage session goal
  /skill <name>          Run a skill
  /learn [request]       Draft a skill
  /btw <question>        Side question
  /subagents list        Inspect sub-agents
  /agents                List bound agents
  /help                  Show this help
  /commands              List all commands

Admin: /config, /mcp, /plugins, /debug, /restart
Voice: /tts, /bash <command>`

export function getHelpText(): string {
  return getLocale() === 'en' ? HELP_TEXT_EN : HELP_TEXT
}

/**
 * Filter command suggestions based on the current input.
 * Returns all commands when input is just "/" (no command name typed yet).
 * Returns matching commands (by name prefix) when a partial command name is typed.
 * Returns an empty array when the input is not a command (doesn't start with "/")
 * or when a full command name followed by a space has been entered (user is now
 * typing arguments, not the command name).
 */
export function getCommandSuggestions(input: string): CommandSuggestion[] {
  // Must start with "/"
  if (!input.startsWith('/')) return []
  // Extract the command name portion (everything after "/" up to the first space or end)
  const match = input.match(/^\/([a-zA-Z][\w-]*)/)
  if (!match) {
    // "/" followed by non-letter — show all commands
    return [...COMMAND_SUGGESTIONS]
  }
  const partial = match[1].toLowerCase()
  // If there's a space after the command name, the user is typing args — no suggestions
  if (input.length > match[0].length && input[match[0].length] === ' ') return []
  // Filter by prefix match
  const matches = COMMAND_SUGGESTIONS.filter(c => c.name.startsWith(partial))
  // If only one match and it exactly equals the input, the user has typed the full
  // command — don't show the popup so Enter can submit normally.
  if (matches.length === 1 && matches[0].name === partial) return []
  return matches
}
