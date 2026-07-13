// @desc AgentEvent union type — the canonical event contract for all consumers
//
// 来源: OpenClaw 的 agentLoop() 通过 onEvent 回调发射这些事件
// 消费者: CLI (TerminalRenderer / App.tsx), Server (ws-handler 透传), Frontend (stream-display)
//
// 迁移注意:
//   - src/core/types.ts 的 AgentEvent 已改为从本文件 re-export
//   - 旧的 audio_delta / asr_result 已重命名为 media_delta / media_result
//   - state_snapshot 是新增事件, OpenClaw 核心尚未发射, 预留给状态推送
//   - tool_use.input 从 Record<string, any> 收紧为 Record<string, unknown>

import type { AudioContent, VideoContent, ContentKind } from './media.js';
import type { AgentStateSnapshot } from './agent-state.js';

// ── Shared sub-types ──

export interface MediaOutputMeta {
  width?: number;
  height?: number;
  durationMs?: number;
  filename?: string;
  sizeBytes?: number;
  alt?: string;
  format?: string;
  [key: string]: unknown;
}

export interface AgentStats {
  tokensIn: number;
  tokensOut: number;
  contextPercent: number;
  toolCalls: number;
  agentSpawns: number;
  skillCalls: number;
  workflowCalls: number;
  durationMs: number;
}

export interface ToolResultMeta {
  pid?: number;
  exitCode?: number;
  durationMs?: number;
  filePath?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ASRSegment {
  text: string;
  start: number;
  end: number;
}

// ── AgentEvent ──

export type AgentEvent =
  // System lifecycle
  | { type: 'system'; subtype: 'init'; sessionId: string; model: string; persona?: string }
  | { type: 'system'; subtype: 'done'; result: string; sessionId: string }
  | { type: 'system'; subtype: 'heartbeat'; elapsedSec: number; waiting: boolean }
  | { type: 'system'; subtype: 'compacting'; reason: 'auto' | 'manual' | 'micro' }
  | { type: 'system'; subtype: 'hot_reload_requested'; reason?: string }

  // Text stream
  | { type: 'text_delta'; delta: string }
  | { type: 'text'; content: string }

  // Tool calls
  | { type: 'tool_input_delta'; toolUseId: string; name: string; delta: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; name: string; output: string;
      displayOutput?: string; meta?: ToolResultMeta }

  // Context & turn
  | { type: 'context_update'; tokens: { used: number; limit: number; percent: number };
      usage?: TokenUsage; messagesCount: number; iteration: number; maxIterations: number }
  | { type: 'turn_end'; usage: TokenUsage; toolCalls: number; durationMs: number; compactionCount?: number }

  // Sub-agents
  | { type: 'sub_agent'; subtype: 'started'; agentId: string; agentType: string;
      parentToolUseId: string; task: string; model: string; displayName?: string }
  | { type: 'sub_agent'; subtype: 'progress'; agentId: string; event: AgentEvent }
  | { type: 'sub_agent'; subtype: 'done'; agentId: string;
      result: string; toolCalls: number; status: 'completed' | 'failed' | 'killed';
      stats?: AgentStats }

  // State snapshot
  | { type: 'state_snapshot'; state: AgentStateSnapshot }

  // Multimodal media
  | { type: 'media_delta'; streamId: string; content: AudioContent | VideoContent; final?: boolean }
  | { type: 'media_result'; kind: 'asr'; text: string; confidence?: number; segments?: ASRSegment[] }
  | { type: 'media_status'; stage: 'asr' | 'tts' | 'vlm';
      status: 'processing' | 'done' | 'error'; detail?: string }

  // Thinking / reasoning stream (parallel to text_delta)
  | { type: 'thinking_delta'; delta: string }

  // LLM call lifecycle
  | { type: 'llm_call'; subtype: 'start';
      model: string; iteration: number; maxIterations: number;
      messagesCount: number; toolCount: number;
      systemPromptPreview?: string }
  | { type: 'llm_call'; subtype: 'end';
      iteration: number; durationMs: number;
      stopReason: string; retryCount: number;
      usage: TokenUsage }

  // Agent-to-agent messaging
  | { type: 'bus_message'; from: string; to: string;
      summary: string; contentPreview: string; timestamp: number }
  | { type: 'bus_drain'; agentName: string;
      messageCount: number; summaries: string[] }

  // Hook execution
  | { type: 'hook'; hookType: 'pre_tool' | 'post_tool';
      toolName: string; toolUseId: string;
      action: 'allow' | 'block' | 'modify';
      reason?: string }
  | { type: 'hook'; hookType: 'stop' | 'pre_compact' | 'session_start' | 'session_end';
      action: 'executed';
      reason?: string }

  // Hook activity state (for UI rendering)
  | { type: 'hook_activity';
      event: string;
      status: 'running' | 'success' | 'error' | 'blocked';
      icon: string;
      toolName?: string;
      detail?: string;
      durationMs?: number }

  // Context compaction detail (follows system.compacting)
  | { type: 'compaction_detail';
      reason: 'auto' | 'manual' | 'micro';
      tokensBefore: number; tokensAfter: number;
      messagesRemoved: number;
      transcriptPath?: string }

  // Debug catch-all
  | { type: 'debug'; category: string; message: string;
      data?: Record<string, unknown> }

  // Token usage (streaming)
  | { type: 'streaming_usage'; usage: TokenUsage }

  // Media output (unified: images, audio, video, files)
  | { type: 'media_output';
      kind: ContentKind;
      mimeType: string;
      path: string;
      data?: string;
      role: 'assistant' | 'user';
      source?: string;
      meta?: MediaOutputMeta }

  // Frontend tool awaiting result (AG-UI frontend-defined tools)
  | { type: 'awaiting_frontend_tool'; toolCallId: string; toolName: string;
      args: Record<string, unknown> }

  // World control (time & weather)
  | { type: 'world_control'; target: 'time'; action: 'set' | 'pause' | 'resume'; hour?: number }
  | { type: 'world_control'; target: 'weather'; action: 'set' | 'reset'; weather?: string }
  // World control (scene editing — steward only)
  | { type: 'world_control'; target: 'scene'; action: 'place';
      objectId: string; category: 'building' | 'prop' | 'road';
      modelKey: string; modelUrl?: string; gridX: number; gridZ: number;
      rotationY: number; scale: number;
      widthCells?: number; depthCells?: number;
      fixRotationX?: number; fixRotationY?: number; fixRotationZ?: number }
  | { type: 'world_control'; target: 'scene'; action: 'move';
      objectId: string; gridX: number; gridZ: number }
  | { type: 'world_control'; target: 'scene'; action: 'transform';
      objectId: string; rotationY?: number; scale?: number;
      flipX?: boolean; flipZ?: boolean }
  | { type: 'world_control'; target: 'scene'; action: 'delete';
      objectId: string }
  | { type: 'world_control'; target: 'scene'; action: 'set_terrain';
      cells: Array<{ col: number; row: number; type: string }> }
  | { type: 'world_control'; target: 'scene'; action: 'expand';
      newCols: number; newRows: number }
  // World control (NPC spatial query — plugin tools → frontend)
  | { type: 'world_control'; target: 'query_npc';
      requestId: string;
      query:
        | { kind: 'self'; npcId: string }
        | { kind: 'nearby'; radius: number; origin?: { x: number; z: number }; callerNpcId?: string } }

  // Error
  | { type: 'error'; message: string; recoverable: boolean };
