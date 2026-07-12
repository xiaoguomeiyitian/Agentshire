/**
 * ChatItem — Chat 视图的统一消息模型。
 *
 * 设计原则：
 *   1. 唯一事实源是 OpenClaw session transcript（.jsonl）。
 *   2. 历史恢复和实时增量共用同一套模型。
 *   3. 不依赖 Town 的 AgentEvent 语义。
 *   4. 每个 item 有稳定 id，支持跨 history/delta/reload 去重。
 */

export type ChatMediaType = "image" | "video" | "audio" | "file";

export type ChatItemKind = "text" | "media" | "tool" | "status";

export interface ChatItemBase {
  id: string;
  agentId: string;
  timestamp: number;
}

export interface ChatTextItem extends ChatItemBase {
  kind: "text";
  role: "user" | "assistant";
  text: string;
  source?: "user_input" | "llm" | "system";
  /** LLM token usage for this assistant message (if available from transcript). */
  usage?: { input: number; output: number; totalTokens?: number; reasoningTokens?: number; cacheRead?: number; cacheWrite?: number };
  /** Model id used for this assistant response (e.g. "deepseek-v4-flash") */
  model?: string;
  /** Reasoning/thinking text extracted from the assistant message (if present). */
  reasoning?: string;
}

export interface ChatMediaItem extends ChatItemBase {
  kind: "media";
  role: "user" | "assistant";
  mediaType: ChatMediaType;
  filePath?: string;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
  imageData?: string;
}

export interface ChatToolItem extends ChatItemBase {
  kind: "tool";
  phase: "start" | "end";
  toolUseId: string;
  toolName: string;
  input?: Record<string, unknown>;
  outputText?: string;
  isError?: boolean;
}

export interface ChatStatusItem extends ChatItemBase {
  kind: "status";
  status: "yielded" | "error" | "system";
  text: string;
}

export type ChatItem =
  | ChatTextItem
  | ChatMediaItem
  | ChatToolItem
  | ChatStatusItem;

export interface ChatItemHistoryResult {
  items: ChatItem[];
  hasMore: boolean;
  cursor: string;
}
