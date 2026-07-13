/**
 * Reads steward session JSONL files and extracts user/assistant text messages.
 * Supports cross-session aggregation: reads from multiple sessions sorted by time.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";
import { estimateTokens } from "./token-estimate.js";

const TOWN_AGENT_ID = "town-steward";
const MAX_SESSIONS = 100;
const MAX_ARCHIVED_SESSIONS = 10;

/** base64url 编码文件路径，生成 media URL 路径段（避免 %2F 被 nginx 反代吞掉） */
function encodeMediaPath(filePath: string): string {
  return Buffer.from(filePath, "utf-8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  type?: "text" | "image" | "video" | "audio" | "file";
  imageData?: string;
  mimeType?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
}

export interface ChatHistoryCursor {
  sessionIdx: number;
  fileOffset: number;
}

export interface ChatHistoryResult {
  messages: ChatHistoryMessage[];
  hasMore: boolean;
  cursor: string;
}

interface SessionEntry {
  sessionId: string;
  updatedAt: number;
  filePath: string;
}

function sessionsDir(agentId: string = TOWN_AGENT_ID): string {
  return join(stateDir(), "agents", agentId, "sessions");
}

function listArchivedSessions(
  dirPath: string,
  excludeSessionIds: Set<string>,
  maxFiles: number = MAX_ARCHIVED_SESSIONS,
): SessionEntry[] {
  try {
    const files = readdirSync(dirPath);
    return files
      .filter(f => f.includes(".jsonl.reset."))
      .map(f => {
        const sessionId = f.split(".jsonl.reset.")[0];
        const resetTs = f.split(".reset.")[1] ?? "";
        return { sessionId, resetTs, path: join(dirPath, f) };
      })
      .filter(f => f.sessionId && !excludeSessionIds.has(f.sessionId))
      .sort((a, b) => b.resetTs.localeCompare(a.resetTs))
      .slice(0, maxFiles)
      .map(f => ({
        sessionId: f.sessionId,
        updatedAt: parseResetTimestamp(f.resetTs),
        filePath: f.path,
      }));
  } catch {
    return [];
  }
}

/**
 * Find unindexed session files in the sessions directory.
 * These are regular .jsonl files (not .trajectory.jsonl, not .reset. archives)
 * that are not referenced in sessions.json. The OpenClaw runtime may create
 * new sessions (e.g. on context compaction) without updating the index, so
 * we need to discover them by scanning the directory.
 *
 * Returns sessions sorted by modification time (newest first).
 */
function listUnindexedSessions(
  dirPath: string,
  excludeSessionIds: Set<string>,
  maxFiles: number = MAX_ARCHIVED_SESSIONS,
): SessionEntry[] {
  try {
    const files = readdirSync(dirPath);
    const sessions: SessionEntry[] = [];
    for (const f of files) {
      // Only regular session transcripts (exclude trajectory files and reset archives)
      if (!f.endsWith(".jsonl")) continue;
      if (f.includes(".trajectory.") || f.includes(".reset.")) continue;
      const sessionId = f.replace(/\.jsonl$/, "");
      if (excludeSessionIds.has(sessionId)) continue;
      const filePath = join(dirPath, f);
      try {
        const st = statSync(filePath);
        sessions.push({
          sessionId,
          updatedAt: st.mtimeMs,
          filePath,
        });
      } catch { /* skip */ }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions.slice(0, maxFiles);
  } catch {
    return [];
  }
}

function parseResetTimestamp(ts: string): number {
  try {
    const normalized = ts.replace(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d+)Z/, "$1T$2:$3:$4.$5Z");
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function listTownSessions(): SessionEntry[] {
  try {
    const dir = sessionsDir();
    const indexPath = join(dir, "sessions.json");
    if (!existsSync(indexPath)) return [];
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));

    const sessions: SessionEntry[] = [];
    const indexedIds = new Set<string>();
    for (const [key, value] of Object.entries(index)) {
      if (!key.startsWith("town:") && !key.startsWith("agent:town-steward:town:")) continue;
      const entry = value as any;
      if (!entry?.sessionId) continue;
      const filePath = join(dir, `${entry.sessionId}.jsonl`);
      if (!existsSync(filePath)) continue;
      indexedIds.add(entry.sessionId);
      sessions.push({
        sessionId: entry.sessionId,
        updatedAt: entry.updatedAt ?? 0,
        filePath,
      });
    }

    sessions.push(...listArchivedSessions(dir, indexedIds));
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions.slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

function stripUserMetadata(text: string): string {
  const marker = '```\n\n';
  const lastPos = text.lastIndexOf(marker);
  if (lastPos >= 0) {
    return text.slice(lastPos + marker.length).trim();
  }
  let cleaned = text.replace(/^Conversation info \(untrusted metadata\):[\s\S]*?\n\n/, "").trim();
  cleaned = cleaned.replace(/^Sender \(untrusted metadata\):[\s\S]*?\n\n/, "").trim();
  return cleaned;
}

function stripReasoningTags(text: string): string {
  const finalMatch = text.match(/<final\b[^>]*>([\s\S]*?)<\/final>/i);
  if (finalMatch) return finalMatch[1].trim();
  return text.replace(/<\/?(?:final|think(?:ing)?|thought|antthinking)\b[^<>]*>/gi, "").trim();
}

function isSystemMessage(text: string): boolean {
  if (text.startsWith("[系统通知]")) return true;
  if (text.startsWith("System:")) return true;
  if (text.startsWith("[Subagent")) return true;
  if (text.trim() === "NO_REPLY") return true;
  return false;
}

function readSubagentFinalMessage(filePath: string): ChatHistoryMessage | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    let last: ChatHistoryMessage | null = null;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
        const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : 0;

        for (const block of msg.content) {
          if (block.type !== "text" || typeof block.text !== "string") continue;
          const text = stripReasoningTags(block.text.trim());
          if (text && !isSystemMessage(text) && text !== "NO_REPLY") {
            last = { role: "assistant", text, timestamp, type: "text" };
          }
        }
      } catch { continue; }
    }
    return last;
  } catch {
    return null;
  }
}

function resolveSubagentMessages(childSessionKeys: string[]): ChatHistoryMessage[] {
  if (childSessionKeys.length === 0) return [];
  const results: ChatHistoryMessage[] = [];
  try {
    const dir = sessionsDir();
    const indexPath = join(dir, "sessions.json");
    if (!existsSync(indexPath)) return [];
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));

    for (const childKey of childSessionKeys) {
      const entry = (index as Record<string, any>)[childKey];
      if (!entry?.sessionId) continue;
      const childPath = join(dir, `${entry.sessionId}.jsonl`);
      if (!existsSync(childPath)) continue;
      const msg = readSubagentFinalMessage(childPath);
      if (msg) results.push(msg);
    }
  } catch { /* ignore */ }
  return results;
}

function readSessionMessages(filePath: string): ChatHistoryMessage[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const messages: ChatHistoryMessage[] = [];
    const childSessionKeys: string[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!msg) continue;
        // Normalize content: user messages may be a plain string (citizen sessions)
        if (Array.isArray(msg.content)) {
          // already blocks
        } else if (typeof msg.content === "string") {
          msg.content = [{ type: "text", text: msg.content }];
        } else {
          continue;
        }

        const role = msg.role;
        if (role === "toolResult" && msg.toolName === "sessions_spawn") {
          for (const block of msg.content) {
            if (block.type === "text" && typeof block.text === "string") {
              try {
                const parsed = JSON.parse(block.text);
                if (typeof parsed.childSessionKey === "string") {
                  childSessionKeys.push(parsed.childSessionKey);
                }
              } catch { /* not JSON */ }
            }
          }
        }

        if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
        const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : 0;

        for (const block of msg.content) {
          if (block.type === "image" && block.data) {
            messages.push({
              role: "assistant",
              text: "",
              timestamp,
              type: "image",
              imageData: block.data,
              mimeType: block.mimeType ?? "image/png",
            });
          } else if (block.type === "text" && typeof block.text === "string") {
            const raw = block.text.trim();
            if (!raw) continue;

            const mediaMatch = raw.match(/^MEDIA:(.+)$/);
            if (mediaMatch) {
              const mediaPath = mediaMatch[1].trim();
              const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
              const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
              const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
              const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac"];
              const fileName = mediaPath.split("/").pop() ?? "file";
              const mediaUrl = `/citizen-workshop/_api/media/${encodeMediaPath(mediaPath)}`;

              if (imageExts.includes(ext)) {
                messages.push({
                  role: "assistant", text: "", timestamp,
                  type: "image", fileUrl: mediaUrl,
                  mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
                });
              } else if (videoExts.includes(ext)) {
                messages.push({
                  role: "assistant", text: fileName, timestamp,
                  type: "video", fileUrl: mediaUrl, fileName,
                  mimeType: `video/${ext === "mov" ? "quicktime" : ext}`,
                });
              } else if (audioExts.includes(ext)) {
                messages.push({
                  role: "assistant", text: fileName, timestamp,
                  type: "audio", fileUrl: mediaUrl, fileName,
                  mimeType: `audio/${ext === "m4a" ? "mp4" : ext}`,
                });
              } else {
                messages.push({
                  role: "assistant", text: fileName, timestamp,
                  type: "file", fileUrl: mediaUrl, fileName,
                });
              }
              continue;
            }

            if (role === "toolResult") {
              try {
                const parsed = JSON.parse(raw);
                const urls: string[] = parsed.mediaUrls ?? (parsed.mediaUrl ? [parsed.mediaUrl] : []);
                for (const mediaPath of urls) {
                  if (!mediaPath || typeof mediaPath !== "string") continue;
                  const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
                  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
                  const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
                  const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac"];
                  const fileName = mediaPath.split("/").pop() ?? "file";
                  const fileUrl = `/citizen-workshop/_api/media/${encodeMediaPath(mediaPath)}`;

                  if (imageExts.includes(ext)) {
                    messages.push({ role: "assistant", text: "", timestamp, type: "image", fileUrl, mimeType: `image/${ext === "jpg" ? "jpeg" : ext}` });
                  } else if (videoExts.includes(ext)) {
                    messages.push({ role: "assistant", text: fileName, timestamp, type: "video", fileUrl, fileName, mimeType: `video/${ext === "mov" ? "quicktime" : ext}` });
                  } else if (audioExts.includes(ext)) {
                    messages.push({ role: "assistant", text: fileName, timestamp, type: "audio", fileUrl, fileName, mimeType: `audio/${ext === "m4a" ? "mp4" : ext}` });
                  } else if (ext) {
                    messages.push({ role: "assistant", text: fileName, timestamp, type: "file", fileUrl, fileName });
                  }
                }
              } catch { /* not JSON */ }
              continue;
            }
            if (role !== "user" && role !== "assistant") continue;

            const mediaAttachMatch = raw.match(/\[media attached: (.+?) \(([^)]+)\)\]/);
            const text = role === "user" ? stripUserMetadata(raw) : stripReasoningTags(raw);
            if (!text && !mediaAttachMatch) continue;
            if (text && isSystemMessage(text)) { if (!mediaAttachMatch) continue; }

            if (mediaAttachMatch) {
              const mediaPath = mediaAttachMatch[1];
              const mime = mediaAttachMatch[2];
              const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
              const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
              const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
              const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac"];
              const fileName = mediaPath.split("/").pop() ?? "file";
              const fileUrl = `/citizen-workshop/_api/media/${encodeMediaPath(mediaPath)}`;
              let fileSize: number | undefined;
              try { fileSize = statSync(mediaPath).size; } catch {}

              const remainText = text.replace(/\[media attached: .+? \([^)]+\)\]/, "").trim();
              const caption = remainText.replace(/^To send an image back[\s\S]*$/, "").trim();
              const captionText = (caption && !isSystemMessage(caption)) ? caption : "";

              if (imageExts.includes(ext)) {
                messages.push({ role: role as "user" | "assistant", text: captionText, timestamp, type: "image", fileUrl, mimeType: mime, fileSize });
              } else if (videoExts.includes(ext)) {
                messages.push({ role: role as "user" | "assistant", text: captionText || fileName, timestamp, type: "video", fileUrl, fileName, mimeType: mime, fileSize });
              } else if (audioExts.includes(ext)) {
                messages.push({ role: role as "user" | "assistant", text: captionText || fileName, timestamp, type: "audio", fileUrl, fileName, mimeType: mime, fileSize });
              } else {
                messages.push({ role: role as "user" | "assistant", text: captionText || fileName, timestamp, type: "file", fileUrl, fileName, fileSize });
              }
              continue;
            }

            messages.push({ role: role as "user" | "assistant", text, timestamp, type: "text" });
          }
        }
      } catch { continue; }
    }

    const subMessages = resolveSubagentMessages(childSessionKeys);
    if (subMessages.length > 0) messages.push(...subMessages);

    return messages;
  } catch {
    return [];
  }
}

export function loadSubagentFinalMessage(childSessionKey: string): ChatHistoryMessage | null {
  try {
    const dir = sessionsDir();
    const indexPath = join(dir, "sessions.json");
    if (!existsSync(indexPath)) return null;
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const entry = (index as Record<string, any>)[childSessionKey];
    if (!entry?.sessionId) return null;
    const filePath = join(dir, `${entry.sessionId}.jsonl`);
    if (!existsSync(filePath)) return null;
    return readSubagentFinalMessage(filePath);
  } catch {
    return null;
  }
}

let cachedSessions: SessionEntry[] | null = null;
let cachedSessionsTime = 0;
const CACHE_TTL = 5000;

function getSessions(): SessionEntry[] {
  const now = Date.now();
  if (cachedSessions && now - cachedSessionsTime < CACHE_TTL) return cachedSessions;
  cachedSessions = listTownSessions();
  cachedSessionsTime = now;
  return cachedSessions;
}

export function invalidateSessionCache(): void {
  cachedSessions = null;
}

export function loadChatHistory(
  limit: number = 50,
  cursorStr?: string,
): ChatHistoryResult {
  const sessions = getSessions();
  if (sessions.length === 0) {
    return { messages: [], hasMore: false, cursor: "" };
  }

  let startSessionIdx = 0;
  if (cursorStr) {
    try {
      const c: ChatHistoryCursor = JSON.parse(cursorStr);
      startSessionIdx = c.sessionIdx;
    } catch {}
  }

  const allMessages: ChatHistoryMessage[] = [];
  let lastSessionIdx = startSessionIdx;

  for (let i = startSessionIdx; i < sessions.length && allMessages.length < limit + 10; i++) {
    const msgs = readSessionMessages(sessions[i].filePath);
    allMessages.push(...msgs);
    lastSessionIdx = i;
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp);

  if (cursorStr) {
    const latest = allMessages.slice(-limit);
    const hasMore = allMessages.length > limit || lastSessionIdx + 1 < sessions.length;
    const cursor: ChatHistoryCursor = { sessionIdx: lastSessionIdx + 1, fileOffset: 0 };
    return { messages: latest, hasMore, cursor: JSON.stringify(cursor) };
  }

  const latest = allMessages.slice(-limit);
  const hasMore = allMessages.length > limit || sessions.length > 1;
  const cursor: ChatHistoryCursor = { sessionIdx: Math.min(1, sessions.length), fileOffset: 0 };
  return { messages: latest, hasMore, cursor: JSON.stringify(cursor) };
}

export function loadNewMessages(
  currentSessionId?: string,
): ChatHistoryMessage[] {
  invalidateSessionCache();
  const sessions = getSessions();
  if (sessions.length === 0) return [];

  const target = currentSessionId
    ? sessions.find(s => s.sessionId === currentSessionId) ?? sessions[0]
    : sessions[0];

  return readSessionMessages(target.filePath);
}

export function getCurrentSessionId(): string | null {
  const sessions = getSessions();
  return sessions.length > 0 ? sessions[0].sessionId : null;
}

export function loadCitizenHistory(
  agentId: string,
  limit: number = 50,
): ChatHistoryResult {
  const sessDir = sessionsDir(agentId);

  if (!existsSync(sessDir)) {
    return { messages: [], hasMore: false, cursor: "" };
  }

  try {
    const allMessages: ChatHistoryMessage[] = [];
    const indexedIds = new Set<string>();
    const prefix = `agent:${agentId}:`;

    const indexPath = join(sessDir, "sessions.json");
    if (existsSync(indexPath)) {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      for (const [key, value] of Object.entries(index)) {
        if (!key.startsWith(prefix)) continue;
        // Skip group chat sessions to keep single-chat context isolated
        if (key.includes(":group:")) continue;
        const entry = value as any;
        if (!entry?.sessionId) continue;
        const filePath = join(sessDir, `${entry.sessionId}.jsonl`);
        if (!existsSync(filePath)) continue;
        indexedIds.add(entry.sessionId);
        allMessages.push(...readSessionMessages(filePath));
      }
    }

    const archived = listArchivedSessions(sessDir, indexedIds);
    for (const arc of archived) {
      allMessages.push(...readSessionMessages(arc.filePath));
    }

    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    const latest = allMessages.slice(-limit);
    return { messages: latest, hasMore: allMessages.length > limit, cursor: "" };
  } catch {
    return { messages: [], hasMore: false, cursor: "" };
  }
}

// ────────────────────────────────────────────────────────────────
// ChatItem-based session parser (Phase 1 — session-first chat)
// Existing ChatHistoryMessage functions are kept untouched above.
// ────────────────────────────────────────────────────────────────

import type { ChatItem, ChatItemHistoryResult } from "../contracts/chat.js";
import { resolveAsset } from "./chat-asset-resolver.js";

function stripUserMeta(text: string): string {
  const marker = '```\n\n';
  const lastPos = text.lastIndexOf(marker);
  if (lastPos >= 0) return text.slice(lastPos + marker.length).trim();
  let cleaned = text.replace(/^Conversation info \(untrusted metadata\):[\s\S]*?\n\n/, "").trim();
  cleaned = cleaned.replace(/^Sender \(untrusted metadata\):[\s\S]*?\n\n/, "").trim();
  return cleaned;
}

function stripReasoning(text: string): string {
  const finalMatch = text.match(/<final\b[^>]*>([\s\S]*?)<\/final>/i);
  if (finalMatch) return finalMatch[1].trim();
  return text.replace(/<\/?(?:final|think(?:ing)?|thought|antthinking)\b[^<>]*>/gi, "").trim();
}

/** Extract reasoning/thinking text from assistant message content.
 * Returns the reasoning text (without tags), or undefined if no reasoning tags found.
 * Also returns the cleaned final text. */
function extractReasoning(text: string): { reasoning?: string; final: string } {
  // Check for <final> tag — reasoning is everything outside <final>
  const finalMatch = text.match(/<final\b[^>]*>([\s\S]*?)<\/final>/i);
  if (finalMatch) {
    const finalText = finalMatch[1].trim();
    // Extract reasoning from before <final> tag
    const beforeFinal = text.slice(0, text.indexOf("<final"));
    const reasoningTags = beforeFinal.match(/<think(?:ing)?\b[^>]*>([\s\S]*?)<\/think(?:ing)?>/gi);
    if (reasoningTags) {
      const reasoning = reasoningTags
        .map(t => t.replace(/<\/?think(?:ing)?\b[^>]*>/gi, "").trim())
        .filter(t => t.length > 0)
        .join("\n\n");
      if (reasoning) return { reasoning, final: finalText };
    }
    // Check for <thought> tags
    const thoughtTags = beforeFinal.match(/<thought\b[^>]*>([\s\S]*?)<\/thought>/gi);
    if (thoughtTags) {
      const reasoning = thoughtTags
        .map(t => t.replace(/<\/?thought\b[^>]*>/gi, "").trim())
        .filter(t => t.length > 0)
        .join("\n\n");
      if (reasoning) return { reasoning, final: finalText };
    }
    return { final: finalText };
  }

  // No <final> tag — check for <thinking>/<thought> tags
  const thinkMatch = text.match(/<think(?:ing)?\b[^>]*>([\s\S]*?)<\/think(?:ing)?>/i);
  if (thinkMatch) {
    const reasoning = thinkMatch[1].trim();
    const final = text.replace(/<\/?think(?:ing)?\b[^>]*>/gi, "").trim();
    if (reasoning) return { reasoning, final };
  }

  const thoughtMatch = text.match(/<thought\b[^>]*>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) {
    const reasoning = thoughtMatch[1].trim();
    const final = text.replace(/<\/?thought\b[^>]*>/gi, "").trim();
    if (reasoning) return { reasoning, final };
  }

  return { final: stripReasoning(text) };
}

function isSysText(text: string): boolean {
  if (text.startsWith("[系统通知]")) return true;
  if (text.startsWith("System:")) return true;
  if (text.startsWith("[Subagent")) return true;
  if (text.trim() === "NO_REPLY") return true;
  return false;
}

function extractAttachedMediaPaths(text: string): string[] {
  const results: string[] = [];
  for (const match of text.matchAll(/\[media attached: (.+?) \(([^)]+)\)\]/g)) {
    const mediaPath = match[1]?.trim();
    if (mediaPath) results.push(mediaPath);
  }
  return results;
}

function stripUserAttachmentHints(text: string): string {
  return text
    .replace(/\[media attached: .+? \([^)]+\)\]\n?/g, "")
    .replace(/^To send an image back,.*$/gm, "")
    .trim();
}

/**
 * Shared parser state — pass between calls when processing entries incrementally.
 */
export interface TranscriptParserState {
  pendingToolCalls: Map<string, { name: string; args: Record<string, unknown> }>;
  /** Tracks the last user message text for input token estimation fallback. */
  lastUserText?: string;
}

export function createParserState(): TranscriptParserState {
  return { pendingToolCalls: new Map() };
}

/**
 * Parse a single transcript entry into ChatItem[].
 * Shared by both full-file history restore and realtime delta.
 */
export function parseTranscriptEntry(
  entry: Record<string, unknown>,
  agentId: string,
  state: TranscriptParserState,
): ChatItem[] {
  const items: ChatItem[] = [];

  if (entry.type === "custom_message") {
    const ct = entry.customType as string | undefined;
    if (ct === "openclaw.sessions_yield") {
      items.push({
        id: `status:${(entry as any).id ?? ""}:yielded`,
        agentId,
        timestamp: typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : 0,
        kind: "status",
        status: "yielded",
        text: String((entry as any).details?.message ?? "Turn yielded."),
      });
    }
    return items;
  }

  if (entry.type !== "message") return items;
  const msg = (entry as any).message as Record<string, any> | undefined;
  if (!msg) return items;

  // Normalize content: OpenClaw stores assistant content as an array of blocks,
  // but user content may be a plain string (especially for citizen sessions).
  // Coerce string content into a single text block so the parser is uniform.
  let blocks: any[];
  if (Array.isArray(msg.content)) {
    blocks = msg.content;
  } else if (typeof msg.content === "string") {
    blocks = [{ type: "text", text: msg.content }];
  } else {
    return items;
  }

  const entryId = String((entry as any).id ?? "");
  const role = String(msg.role ?? "");
  const ts = typeof msg.timestamp === "number" ? msg.timestamp : (typeof entry.timestamp === "string" ? Date.parse(entry.timestamp as string) : 0);

  if (role === "user") {
    let blockIdx = 0;
    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string") {
        const rawText = b.text.trim();
        const mediaPaths = extractAttachedMediaPaths(rawText);
        for (const mediaPath of mediaPaths) {
          const asset = resolveAsset(mediaPath);
          items.push({
            id: `msg:${entryId}:media:${blockIdx}:${mediaPath}`,
            agentId, timestamp: ts, kind: "media", role: "user",
            ...asset,
          });
        }
        const text = stripUserAttachmentHints(stripUserMeta(rawText));
        if (text) {
          state.lastUserText = text;
          items.push({ id: `msg:${entryId}:text:${blockIdx}`, agentId, timestamp: ts, kind: "text", role: "user", text, source: "user_input" });
        }
      } else if (b.type === "image" && b.data) {
        items.push({
          id: `msg:${entryId}:media:${blockIdx}`,
          agentId, timestamp: ts, kind: "media", role: "user",
          mediaType: "image", fileUrl: "", fileName: "image",
          mimeType: b.mimeType ?? "image/png", imageData: b.data,
        });
      }
      blockIdx++;
    }
    return items;
  }

  if (role === "assistant") {
    let blockIdx = 0;
    for (const b of blocks) {
      if (b.type === "toolCall") {
        const toolId = String(b.id ?? `tool-${ts}-${blockIdx}`);
        const toolName = String(b.name ?? "unknown");
        const args = (b.arguments ?? {}) as Record<string, unknown>;
        state.pendingToolCalls.set(toolId, { name: toolName, args });
        items.push({
          id: `tool:${toolId}:start`,
          agentId, timestamp: ts, kind: "tool", phase: "start",
          toolUseId: toolId, toolName, input: args,
        });
      } else if (b.type === "text" && typeof b.text === "string") {
        const { reasoning, final } = extractReasoning(b.text.trim());
        if (final && !isSysText(final)) {
          // Extract token usage from assistant message (if present)
          const rawUsage = msg.usage as { input?: number; output?: number; totalTokens?: number; reasoningTokens?: number; cacheRead?: number; cacheWrite?: number } | undefined;
          // Extract model id from assistant message (if present)
          const rawModel = typeof msg.model === "string" ? msg.model : undefined;
          // Fallback: estimate tokens when API returned 0
          const apiInput = rawUsage?.input ?? 0;
          const apiOutput = rawUsage?.output ?? 0;
          const needsEstimate = apiInput === 0 && apiOutput === 0;
          const estInput = needsEstimate ? estimateTokens(state.lastUserText ?? "") : apiInput;
          const estOutput = needsEstimate ? estimateTokens(final) : apiOutput;
          const hasUsage = !!rawUsage || needsEstimate;
          items.push({
            id: `msg:${entryId}:text:${blockIdx}`, agentId, timestamp: ts,
            kind: "text", role: "assistant", text: final, source: "llm",
            ...(hasUsage ? { usage: {
              input: estInput,
              output: estOutput,
              totalTokens: rawUsage?.totalTokens,
              reasoningTokens: rawUsage?.reasoningTokens,
              ...(typeof rawUsage?.cacheRead === "number" ? { cacheRead: rawUsage.cacheRead } : {}),
              ...(typeof rawUsage?.cacheWrite === "number" ? { cacheWrite: rawUsage.cacheWrite } : {}),
            } } : {}),
            ...(rawModel ? { model: rawModel } : {}),
            ...(reasoning ? { reasoning } : {}),
          });
        }
      } else if (b.type === "image" && b.data) {
        items.push({
          id: `msg:${entryId}:media:${blockIdx}`,
          agentId, timestamp: ts, kind: "media", role: "assistant",
          mediaType: "image", fileUrl: "", fileName: "image",
          mimeType: b.mimeType ?? "image/png", imageData: b.data,
        });
      }
      blockIdx++;
    }
    return items;
  }

  if (role === "toolResult") {
    const toolCallId = String(msg.toolCallId ?? "");
    const toolName = String(msg.toolName ?? "unknown");
    const pending = state.pendingToolCalls.get(toolCallId);
    if (pending) state.pendingToolCalls.delete(toolCallId);

    let resultText = "";
    for (const b of blocks) {
      if (b.type !== "text" || typeof b.text !== "string") continue;
      resultText = b.text.trim();
    }

    items.push({
      id: `tool:${toolCallId || entryId}:end`,
      agentId, timestamp: ts, kind: "tool", phase: "end",
      toolUseId: toolCallId, toolName,
      outputText: resultText.slice(0, 500),
      isError: msg.isError === true,
    });

    if (toolName === "message" && resultText) {
      try {
        const parsed = JSON.parse(resultText);
        const urls: string[] = parsed.mediaUrls ?? (parsed.mediaUrl ? [parsed.mediaUrl] : []);
        for (const mediaPath of urls) {
          if (!mediaPath || typeof mediaPath !== "string") continue;
          const asset = resolveAsset(mediaPath);
          items.push({
            id: `msg:${entryId}:media:${mediaPath}`,
            agentId, timestamp: ts, kind: "media", role: "assistant",
            ...asset, caption: parsed.caption ?? parsed.summary ?? "",
          });
        }
      } catch {}
    } else if (resultText) {
      try {
        const parsed = JSON.parse(resultText);
        const urls: string[] = parsed.mediaUrls ?? (parsed.mediaUrl ? [parsed.mediaUrl] : []);
        for (const mediaPath of urls) {
          if (!mediaPath || typeof mediaPath !== "string") continue;
          const asset = resolveAsset(mediaPath);
          items.push({
            id: `msg:${entryId}:media:${mediaPath}`,
            agentId, timestamp: ts, kind: "media", role: "assistant",
            ...asset,
          });
        }
      } catch {
        const mediaMatch = resultText.match(/^MEDIA:(.+)$/);
        if (mediaMatch) {
          const asset = resolveAsset(mediaMatch[1].trim());
          items.push({
            id: `msg:${entryId}:media:${mediaMatch[1].trim()}`,
            agentId, timestamp: ts, kind: "media", role: "assistant",
            ...asset,
          });
        }
      }
    }

    const attachMatch = resultText.match(/\[media attached: (.+?) \(([^)]+)\)\]/);
    if (attachMatch) {
      const mediaPath = attachMatch[1];
      const asset = resolveAsset(mediaPath);
      items.push({
        id: `msg:${entryId}:media:${mediaPath}`,
        agentId, timestamp: ts, kind: "media", role: "assistant",
        ...asset,
      });
    }
  }

  return items;
}

/**
 * Parse a full session transcript file into ChatItem[].
 * Uses parseTranscriptEntry() internally.
 */
export function readSessionItems(filePath: string, agentId: string): ChatItem[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const items: ChatItem[] = [];
    const state = createParserState();

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        items.push(...parseTranscriptEntry(entry, agentId, state));
      } catch { continue; }
    }

    return items;
  } catch {
    return [];
  }
}

export function loadChatItemHistory(
  limit: number = 50,
  cursorStr?: string,
): ChatItemHistoryResult {
  invalidateSessionCache();
  const sessions = getSessions();
  if (sessions.length === 0) return { items: [], hasMore: false, cursor: "" };

  let startIdx = 0;
  if (cursorStr) {
    try { startIdx = JSON.parse(cursorStr).sessionIdx ?? 0; } catch {}
  }

  const allItems: ChatItem[] = [];
  let lastIdx = startIdx;
  const countVisible = () => allItems.filter(it => it.kind === "text" || it.kind === "media" || it.kind === "tool" || it.kind === "status").length;

  for (let i = startIdx; i < sessions.length && countVisible() < limit + 10; i++) {
    allItems.push(...readSessionItems(sessions[i].filePath, "steward"));
    lastIdx = i;
  }

  allItems.sort((a, b) => a.timestamp - b.timestamp);
  const visibleItems = allItems.filter(it => it.kind === "text" || it.kind === "media" || it.kind === "tool" || it.kind === "status");
  const latest = visibleItems.slice(-limit);
  const hasMore = visibleItems.length > limit || lastIdx + 1 < sessions.length;
  const cursor = JSON.stringify({ sessionIdx: cursorStr ? lastIdx + 1 : Math.min(1, sessions.length) });
  return { items: latest, hasMore, cursor };
}

export function loadCitizenItemHistory(
  agentId: string,
  limit: number = 50,
): ChatItemHistoryResult {
  const sessDir = sessionsDir(agentId);

  if (!existsSync(sessDir)) return { items: [], hasMore: false, cursor: "" };

  try {
    const allItems: ChatItem[] = [];
    const indexedIds = new Set<string>();
    const prefix = `agent:${agentId}:`;

    const indexPath = join(sessDir, "sessions.json");
    if (existsSync(indexPath)) {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      for (const [key, value] of Object.entries(index)) {
        if (!key.startsWith(prefix)) continue;
        // Skip group chat sessions to keep single-chat context isolated
        if (key.includes(":group:")) continue;
        const entry = value as any;
        if (!entry?.sessionId) continue;
        const fp = join(sessDir, `${entry.sessionId}.jsonl`);
        if (!existsSync(fp)) continue;
        indexedIds.add(entry.sessionId);
        allItems.push(...readSessionItems(fp, agentId));
      }
    }

    const archived = listArchivedSessions(sessDir, indexedIds);
    for (const arc of archived) {
      allItems.push(...readSessionItems(arc.filePath, agentId));
    }

    // Also include unindexed sessions (created by runtime without updating sessions.json)
    const unindexed = listUnindexedSessions(sessDir, indexedIds);
    for (const u of unindexed) {
      allItems.push(...readSessionItems(u.filePath, agentId));
    }

    allItems.sort((a, b) => a.timestamp - b.timestamp);
    const visibleItems = allItems.filter(it => it.kind === "text" || it.kind === "media" || it.kind === "tool" || it.kind === "status");
    const latest = visibleItems.slice(-limit);
    return { items: latest, hasMore: visibleItems.length > limit, cursor: "" };
  } catch {
    return { items: [], hasMore: false, cursor: "" };
  }
}

// ────────────────────────────────────────────────────────────────
// Legacy functions below — kept for backward compatibility
// ────────────────────────────────────────────────────────────────

export function loadCitizenNewMessages(agentId: string): ChatHistoryMessage[] {
  const sessDir = sessionsDir(agentId);
  const indexPath = join(sessDir, "sessions.json");

  if (!existsSync(indexPath)) return [];

  try {
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const prefix = `agent:${agentId}:`;
    let latest: any = null;
    const indexedIds = new Set<string>();
    for (const [key, value] of Object.entries(index)) {
      if (!key.startsWith(prefix)) continue;
      // Skip group chat sessions to keep single-chat context isolated
      if (key.includes(":group:")) continue;
      const entry = value as any;
      if (!entry?.sessionId) continue;
      indexedIds.add(entry.sessionId);
      if (!latest || (entry.updatedAt ?? 0) > (latest.updatedAt ?? 0)) {
        latest = entry;
      }
    }

    // Also check unindexed sessions (runtime may create new sessions without updating index)
    const unindexed = listUnindexedSessions(sessDir, indexedIds);
    if (unindexed.length > 0) {
      // Compare the newest unindexed session with the latest indexed one
      const newestUnindexed = unindexed[0];
      if (!latest || newestUnindexed.updatedAt > (latest.updatedAt ?? 0)) {
        if (existsSync(newestUnindexed.filePath)) {
          return readSessionMessages(newestUnindexed.filePath);
        }
      }
    }

    if (!latest) return [];
    const filePath = join(sessDir, `${latest.sessionId}.jsonl`);
    if (!existsSync(filePath)) return [];
    return readSessionMessages(filePath);
  } catch {
    return [];
  }
}
