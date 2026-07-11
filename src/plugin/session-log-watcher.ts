import { openSync, closeSync, fstatSync, readSync, existsSync, statSync, readFileSync } from "node:fs";
import type { AgentEvent } from "../contracts/events.js";

const POLL_MS = 300;
const MAX_BASE64_SIZE = 10 * 1024 * 1024;

type EmitFn = (events: AgentEvent[]) => void;

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  arguments?: Record<string, unknown>;
}

export function detectMediaKind(ext: string): string {
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  return "file";
}

export function tryReadBase64(filePath: string): string | undefined {
  try {
    if (!filePath || !existsSync(filePath)) return undefined;
    if (statSync(filePath).size > MAX_BASE64_SIZE) return undefined;
    return readFileSync(filePath).toString("base64");
  } catch { return undefined; }
}

export function extractMediaFromResult(toolName: string, args: Record<string, unknown>, result: string): string | null {
  if (toolName === "image" || toolName === "screencapture") {
    const m = result.match(/\/[^\s"']+\.(?:png|jpg|jpeg|gif|webp)/i);
    return m ? m[0] : (args.path ?? args.output_path) as string | null;
  }
  if ((toolName === "exec" || toolName === "bash") && /screencapture|screenshot/i.test(String(args.command ?? ""))) {
    const m = String(args.command ?? "").match(/[\w/.-]+\.(?:png|jpg|jpeg|gif)/i);
    if (m) return m[0];
  }
  const mm = result.match(/\/[^\s"']+\.(?:png|jpg|jpeg|gif|webp|mp4|webm|mov|mp3|wav)/i);
  return (mm && /(?:wrote|saved|created|generated|output)/i.test(result)) ? mm[0] : null;
}

export class SessionLogWatcher {
  private filePath: string;
  private agentId: string;
  private emit: EmitFn;
  private onSessionEnd?: (reason: string) => void;
  private offset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private pendingToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  private partial = "";
  private lastEventTime = 0;
  private idleEmitted = false;
  private lastFinalStopReason: string | null = null;
  private sessionEndTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, agentId: string, emit: EmitFn, onSessionEnd?: (reason: string) => void) {
    this.filePath = filePath;
    this.agentId = agentId;
    this.emit = emit;
    this.onSessionEnd = onSessionEnd;
  }

  start(): void {
    if (this.stopped) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.sessionEndTimer) { clearTimeout(this.sessionEndTimer); this.sessionEndTimer = null; }
  }

  markComplete(): void {
    this.lastEventTime = 0;
    this.idleEmitted = false;
    for (const [id, info] of this.pendingToolCalls) {
      this.emit([this.wrap({ type: "tool_result", toolUseId: id, name: info.name, output: "(completed)" } as AgentEvent)]);
    }
    this.pendingToolCalls.clear();
    this.emit([this.wrap({ type: "tool_use", toolUseId: "complete", name: "__thinking__", input: { content: "任务完成" } } as AgentEvent)]);
    this.emit([this.wrap({ type: "tool_result", toolUseId: "complete", name: "__thinking__", output: "任务完成" } as AgentEvent)]);
  }

  private poll(): void {
    if (this.stopped) return;
    if (!existsSync(this.filePath)) return;

    let fd: number | null = null;
    try {
      fd = openSync(this.filePath, "r");
      const size = fstatSync(fd).size;
      if (size <= this.offset) {
        closeSync(fd);
        fd = null;
        if (this.lastEventTime > 0 && !this.idleEmitted && this.pendingToolCalls.size === 0 && Date.now() - this.lastEventTime > 1500) {
          this.idleEmitted = true;
          this.emit([this.wrap({ type: "tool_use", toolUseId: `idle-${Date.now()}`, name: "__thinking_placeholder__", input: {} } as AgentEvent)]);
        }
        if (this.lastFinalStopReason && !this.sessionEndTimer && this.onSessionEnd) {
          this.sessionEndTimer = setTimeout(() => {
            if (!this.stopped && this.lastFinalStopReason && this.onSessionEnd) {
              this.onSessionEnd(this.lastFinalStopReason);
            }
          }, 3000);
        }
        return;
      }

      const len = size - this.offset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, this.offset);
      closeSync(fd);
      fd = null;
      this.offset = size;
      this.idleEmitted = false;
      this.lastEventTime = Date.now();
      if (this.sessionEndTimer) { clearTimeout(this.sessionEndTimer); this.sessionEndTimer = null; }

      const chunk = this.partial + buf.toString("utf-8");
      const lines = chunk.split("\n");
      this.partial = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { this.processEntry(JSON.parse(trimmed)); } catch (e) { console.debug('[watcher] parse:', e); }
      }
    } catch {
      if (fd !== null) try { closeSync(fd); } catch {}
    }
  }

  private wrap(innerEvent: AgentEvent): AgentEvent {
    return { type: "sub_agent", subtype: "progress", agentId: this.agentId, event: innerEvent } as AgentEvent;
  }

  private processEntry(entry: Record<string, unknown>): void {
    if (entry.type !== "message") return;
    const msg = entry.message as { role: string; content: unknown } | undefined;
    if (!msg || !Array.isArray(msg.content)) return;

    const blocks = msg.content as ContentBlock[];

    if (msg.role === "assistant") {
      for (const [id, info] of this.pendingToolCalls) {
        this.emit([this.wrap({ type: "tool_result", toolUseId: id, name: info.name, output: "(abandoned)" } as AgentEvent)]);
      }
      this.pendingToolCalls.clear();

      const stopReason = (msg as any).stopReason as string | undefined;
      const hasToolCall = blocks.some(b => b.type === "toolCall");
      if ((stopReason === "stop" || stopReason === "length" || stopReason === "aborted") && !hasToolCall) {
        this.lastFinalStopReason = stopReason;
      } else {
        this.lastFinalStopReason = null;
      }
    }

    const thinkingParts: string[] = [];
    for (const b of blocks) {
      if (b.type === "thinking" && b.thinking) thinkingParts.push(b.thinking);
    }
    if (thinkingParts.length > 0) {
      const text = thinkingParts.join("\n");
      const id = `think-${Date.now()}`;
      this.emit([this.wrap({ type: "tool_use", toolUseId: id, name: "__thinking__", input: { content: text } } as AgentEvent)]);
      this.emit([this.wrap({ type: "tool_result", toolUseId: id, name: "__thinking__", output: text } as AgentEvent)]);
    }

    const hasToolCall = blocks.some(b => b.type === "toolCall");

    for (const block of blocks) {
      if (block.type === "toolCall") {
        const name = block.name ?? "unknown";
        const args = block.arguments ?? {};
        const toolId = block.id ?? `tool-${Date.now()}`;
        this.pendingToolCalls.set(toolId, { name, args });
        this.emit([this.wrap({ type: "tool_use", toolUseId: toolId, name, input: args } as AgentEvent)]);
      }

      if (block.type === "text" && msg.role === "toolResult") {
        const resultText = block.text ?? "";
        let mId: string | undefined;
        let mInfo: { name: string; args: Record<string, unknown> } | undefined;
        for (const [id, info] of this.pendingToolCalls) { mId = id; mInfo = info; break; }
        if (mId) this.pendingToolCalls.delete(mId);

        this.emit([this.wrap({ type: "tool_result", toolUseId: mId ?? "", name: mInfo?.name ?? "unknown", output: resultText } as AgentEvent)]);

        if (mInfo) {
          const mediaPath = extractMediaFromResult(mInfo.name, mInfo.args, resultText);
          if (mediaPath) {
            const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
            const mimeMap: Record<string, string> = {
              png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
              gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
              mp3: "audio/mpeg", wav: "audio/wav",
            };
            this.emit([this.wrap({
              type: "media_output", kind: detectMediaKind(ext), path: mediaPath,
              mimeType: mimeMap[ext] ?? "application/octet-stream",
              data: tryReadBase64(mediaPath), role: "assistant",
              meta: { filename: mediaPath.split("/").pop() },
            } as AgentEvent)]);
          }
        }
      }

      if (block.type === "text" && msg.role === "assistant" && block.text) {
        this.emit([this.wrap({ type: "text", content: block.text } as AgentEvent)]);
      }
    }
  }
}
