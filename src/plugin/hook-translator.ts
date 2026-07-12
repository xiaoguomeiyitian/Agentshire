import type { AgentEvent } from "../contracts/events.js";
import type { ContentKind } from "../contracts/media.js";
import { readFileSync, existsSync } from "node:fs";
import { estimateInputTokens, estimateOutputTokens, withEstimatedFallback } from "./token-estimate.js";

function tryReadBase64(filePath: string): string | undefined {
  try {
    if (!filePath || !existsSync(filePath)) return undefined;
    return readFileSync(filePath).toString('base64');
  } catch { return undefined; }
}

let sessionCounter = 0;

/** Cache estimated input tokens per runId, from llm_input → llm_output/agent_end */
const inputTokenEstimates = new Map<string, number>();/** Timestamp when each runId was cached, for TTL cleanup (5 min) */
const inputTokenTimestamps = new Map<string, number>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheInputEstimate(runId: string, tokens: number): void {
  inputTokenEstimates.set(runId, tokens);
  inputTokenTimestamps.set(runId, Date.now());
  // Sweep expired entries periodically
  if (inputTokenEstimates.size > 50) {
    const now = Date.now();
    for (const [id, ts] of inputTokenTimestamps) {
      if (now - ts > CACHE_TTL_MS) {
        inputTokenEstimates.delete(id);
        inputTokenTimestamps.delete(id);
      }
    }
  }
}
const MEDIA_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
  "mp4", "webm", "mov", "avi", "mkv",
  "mp3", "wav", "ogg", "m4a", "flac",
  "pdf", "zip", "tar", "gz",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);

function detectMediaKind(ext: string): ContentKind {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "file";
}

function extractMediaPath(toolName: string, params: any, result: any): string | null {
  if (toolName === "image") {
    const output = String(result ?? "");
    const match = output.match(/(?:saved|wrote|created|generated)[^"]*?["']?([^\s"']+\.(?:png|jpg|jpeg|gif|webp))/i);
    if (match) return match[1];
    const pathMatch = output.match(/\/[^\s"']+\.(?:png|jpg|jpeg|gif|webp)/i);
    if (pathMatch) return pathMatch[0];
    return params?.path ?? params?.output_path ?? null;
  }

  if (toolName === "exec" || toolName === "bash") {
    const cmd = String(params?.command ?? "");
    if (/screencapture|screenshot/i.test(cmd)) {
      const pathMatch = cmd.match(/[\w/.-]+\.(?:png|jpg|jpeg|gif)/i);
      if (pathMatch) return pathMatch[0];
    }
  }

  const output = String(result ?? "");
  const fileMatch = output.match(/\/[^\s"']+\.(\w+)/);
  if (fileMatch && MEDIA_EXTENSIONS.has(fileMatch[1].toLowerCase())) {
    return fileMatch[0];
  }

  return null;
}

export function hookToAgentEvent(
  hookName: string,
  payload: Record<string, unknown>,
): AgentEvent | AgentEvent[] | null {
  switch (hookName) {
    case "before_agent_start":
      return {
        type: "system",
        subtype: "init",
        sessionId: String(payload.sessionId ?? `oc-session-${++sessionCounter}`),
        model: String(payload.model ?? "unknown"),
        persona: payload.persona as string | undefined,
      };

    case "agent_end": {
      const events: AgentEvent[] = [];

      if (payload.success === false || payload.error) {
        events.push({
          type: "error",
          message: String(payload.error ?? "Agent run failed"),
          recoverable: false,
        });
      }

      const rawUsage = payload.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const runId = String(payload.runId ?? "");
      const estInput = runId ? (inputTokenEstimates.get(runId) ?? 0) : 0;
      const usage = withEstimatedFallback(
        rawUsage ? { input: rawUsage.inputTokens ?? 0, output: rawUsage.outputTokens ?? 0 } : undefined,
        estInput,
        0, // agent_end doesn't have assistantTexts; output already shown via llm_output
      );
      // NOTE: Do NOT delete cache here — llm_output may fire AFTER agent_end
      // (OpenClaw 2026.6.11 ordering). Cache entries are cleaned by TTL sweep.
      events.push({
        type: "turn_end",
        usage: {
          inputTokens: usage.input,
          outputTokens: usage.output,
        },
        toolCalls: (payload.toolCalls as number) ?? 0,
        durationMs: (payload.durationMs as number) ?? 0,
        ...(typeof (payload as any).compactionCount === "number" ? { compactionCount: (payload as any).compactionCount as number } : {}),
      });

      return events;
    }

    case "llm_input": {
      const delta = String(payload.thinking ?? payload.reasoning ?? payload.thought ?? "");
      // Estimate input tokens and cache for llm_output/agent_end fallback
      const runId = String(payload.runId ?? "");
      if (runId) {
        const systemPrompt = String(payload.systemPrompt ?? "");
        const prompt = String(payload.prompt ?? "");
        const historyMessages = (payload.historyMessages as Array<{ role?: string; content?: unknown }>) ?? [];
        const est = estimateInputTokens(systemPrompt, prompt, historyMessages);
        cacheInputEstimate(runId, est);
      }
      return { type: "thinking_delta", delta };
    }

    case "llm_output": {
      const texts = payload.assistantTexts as string[] | undefined;
      const text = texts?.[texts.length - 1] ?? String(payload.text ?? payload.content ?? "");
      const rawUsage = payload.usage as { input?: number; output?: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number } | undefined;
      const contextTokenBudget = typeof payload.contextTokenBudget === "number" ? payload.contextTokenBudget as number : undefined;

      // Fallback: estimate tokens when API returns 0
      const runId = String(payload.runId ?? "");
      const estInput = runId ? (inputTokenEstimates.get(runId) ?? 0) : 0;
      const estOutput = estimateOutputTokens(texts ?? (text ? [text] : []));
      const usage = withEstimatedFallback(
        rawUsage ? { input: rawUsage.input ?? 0, output: rawUsage.output ?? 0 } : undefined,
        estInput,
        estOutput,
      );
      const cacheRead = typeof rawUsage?.cacheRead === "number" ? rawUsage.cacheRead : undefined;
      const cacheWrite = typeof rawUsage?.cacheWrite === "number" ? rawUsage.cacheWrite : undefined;
      // Clean up cache after reading (llm_output is the final consumer)
      if (runId) {
        inputTokenEstimates.delete(runId);
        inputTokenTimestamps.delete(runId);
      }

      const events: AgentEvent[] = [];

      // Emit context_update with token usage + context window budget
      // Only emit when there's actual usage data (API-provided, estimated, or budget)
      const hasUsage = !!rawUsage || contextTokenBudget !== undefined || estInput > 0 || estOutput > 0;
      if (hasUsage || contextTokenBudget) {
        const inputTokens = usage.input;
        const outputTokens = usage.output;
        const limit = contextTokenBudget ?? 0;
        const used = inputTokens;
        const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
        events.push({
          type: "context_update",
          tokens: { used, limit, percent },
          usage: {
            inputTokens,
            outputTokens,
            ...(cacheRead !== undefined ? { cacheRead } : {}),
            ...(cacheWrite !== undefined ? { cacheWrite } : {}),
          },
          messagesCount: 0,
          iteration: 0,
          maxIterations: 0,
        });
      }

      if (!text) {
        return events.length > 0 ? events : null;
      }
      events.push({ type: "text", content: text });
      return events;
    }

    case "before_tool_call":
      return {
        type: "tool_use",
        toolUseId: String(payload.toolCallId ?? payload.toolUseId ?? `tool-${Date.now()}`),
        name: String(payload.toolName ?? payload.name ?? "unknown"),
        input: (payload.params ?? payload.input ?? {}) as Record<string, unknown>,
      };

    case "after_tool_call": {
      const toolName = String(payload.toolName ?? payload.name ?? "unknown");
      const events: AgentEvent[] = [
        {
          type: "tool_result",
          toolUseId: String(payload.toolCallId ?? payload.toolUseId ?? ""),
          name: toolName,
          output: String(payload.result ?? payload.output ?? ""),
          meta: payload.meta as Record<string, unknown> | undefined,
        },
      ];

      const mediaPath = extractMediaPath(toolName, payload.params, payload.result);
      if (mediaPath) {
        const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
        const mimeMap: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
          mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
        };
        events.push({
          type: "media_output",
          kind: detectMediaKind(ext),
          path: mediaPath,
          mimeType: mimeMap[ext] ?? "application/octet-stream",
          data: tryReadBase64(mediaPath),
          role: "assistant",
          meta: { filename: mediaPath.split("/").pop() },
        });
      }

      return events;
    }

    case "subagent_spawned": {
      const childKey = String(payload.childSessionKey ?? "");
      const uniqueId = childKey || String(payload.runId ?? `sub-${Date.now()}`);
      return {
        type: "sub_agent",
        subtype: "started",
        agentId: uniqueId,
        agentType: String(payload.agentType ?? "worker"),
        parentToolUseId: String(payload.parentToolUseId ?? ""),
        task: String(payload.task ?? payload.label ?? ""),
        model: String(payload.model ?? "unknown"),
        displayName: (payload.label ?? payload.displayName) as string | undefined,
      };
    }

    case "subagent_ended": {
      const targetKey = String(payload.targetSessionKey ?? "");
      const endId = targetKey || String(payload.runId ?? payload.agentId ?? "");
      const outcome = String(payload.outcome ?? "ok");
      const statusMap: Record<string, string> = {
        ok: "completed", error: "failed", timeout: "failed", killed: "killed", reset: "killed", deleted: "killed",
      };
      return {
        type: "sub_agent",
        subtype: "done",
        agentId: endId,
        result: String(payload.result ?? payload.reason ?? ""),
        toolCalls: (payload.toolCalls as number) ?? 0,
        status: (statusMap[outcome] ?? "completed") as "completed" | "failed" | "killed",
      };
    }

    case "message_sending": {
      const text = String(payload.content ?? payload.text ?? payload.body ?? "");
      if (!text) return null;
      return { type: "text", content: text };
    }

    case "session_end":
      return {
        type: "system",
        subtype: "done",
        result: "session_end",
        sessionId: String(payload.sessionId ?? ""),
      };

    default:
      return null;
  }
}
