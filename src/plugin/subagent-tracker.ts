import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { SessionLogWatcher } from "./session-log-watcher.js";
import { broadcastAgentEvent } from "./ws-server.js";
import { stateDir } from "./paths.js";

const TOWN_AGENT_ID = "town-steward";

function getSessionsDir(): string {
  return join(stateDir(), "agents", TOWN_AGENT_ID, "sessions");
}

function resolveSessionFileId(childSessionKey: string): string | null {
  try {
    const indexPath = join(getSessionsDir(), "sessions.json");
    if (!existsSync(indexPath)) return null;
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const entry = index[childSessionKey];
    if (entry?.sessionId) return entry.sessionId;
  } catch {}
  return null;
}

interface TrackedAgent {
  childSessionKey: string;
  sessionId: string;
  label: string;
  townSessionId: string | undefined;
  watcher: SessionLogWatcher;
}

const tracked = new Map<string, TrackedAgent>();

export function onSubagentSpawned(
  event: Record<string, unknown>,
  townSessionId: string | undefined,
  onFallbackComplete?: (label: string, townSessionId: string | undefined) => void,
): void {
  const childSessionKey = event.childSessionKey as string | undefined;
  if (!childSessionKey) return;

  const sessionFileId = resolveSessionFileId(childSessionKey);
  if (!sessionFileId) {
    console.log(`[agentshire] ⚠️  Could not resolve session file for ${childSessionKey}`);
    return;
  }

  const label = String(event.label ?? event.displayName ?? sessionFileId);
  const filePath = join(getSessionsDir(), `${sessionFileId}.jsonl`);

  const watcher = new SessionLogWatcher(filePath, childSessionKey, (events) => {
    for (const ev of events) {
      broadcastAgentEvent(ev, townSessionId);
    }
  }, (reason) => {
    const entry = tracked.get(childSessionKey);
    if (entry) {
      console.log(`[agentshire] ⚠️ Watcher detected session end (${reason}) for "${entry.label}" but subagent_ended hook not received. Triggering fallback.`);
      entry.watcher.markComplete();
      entry.watcher.stop();
      tracked.delete(childSessionKey);
      onFallbackComplete?.(entry.label, entry.townSessionId);
    }
  });

  tracked.set(childSessionKey, { childSessionKey, sessionId: sessionFileId, label, townSessionId, watcher });
  watcher.start();
  console.log(`[agentshire] 📖 Session watcher started: ${label} (${sessionFileId.slice(0, 8)}…)`);
}

export function onSubagentEnded(event: Record<string, unknown>): void {
  const childKey = (event.targetSessionKey ?? event.childSessionKey) as string | undefined;
  if (!childKey) return;

  const entry = tracked.get(childKey);
  if (entry) {
    entry.watcher.markComplete();
    entry.watcher.stop();
    tracked.delete(childKey);
    console.log(`[agentshire] 📖 Session watcher stopped: ${entry.label} (${entry.sessionId.slice(0, 8)}…)`);
  }
}

export function getLabelForSession(event: Record<string, unknown>): string | undefined {
  const childKey = (event.targetSessionKey ?? event.childSessionKey) as string | undefined;
  if (!childKey) return undefined;
  return tracked.get(childKey)?.label;
}

export function stopAll(): void {
  for (const [key, entry] of tracked) {
    entry.watcher.stop();
    tracked.delete(key);
  }
}

export function getTrackedCount(): number {
  return tracked.size;
}

export function hasRunningSubagents(): boolean {
  return tracked.size > 0;
}

export function isLabelBusy(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  for (const entry of tracked.values()) {
    if (entry.label.trim().toLowerCase() === normalized) return true;
  }
  return false;
}

export interface ActivityLogEntry {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  success?: boolean;
}

export function getActivityLogForAgent(agentId: string): ActivityLogEntry[] {
  const entry = tracked.get(agentId);
  if (!entry) {
    const sessionFileId = resolveSessionFileId(agentId);
    if (!sessionFileId) return [];
    const filePath = join(getSessionsDir(), `${sessionFileId}.jsonl`);
    if (!existsSync(filePath)) return [];
    return parseActivityLog(filePath);
  }
  const filePath = join(getSessionsDir(), `${entry.sessionId}.jsonl`);
  if (!existsSync(filePath)) return [];
  return parseActivityLog(filePath);
}

function parseActivityLog(filePath: string): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const pendingTools = new Map<string, { name: string; input: Record<string, unknown> }>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record: any;
      try { record = JSON.parse(trimmed); } catch { continue; }
      if (record.type !== "message") continue;
      const msg = record.message;
      if (!msg || !Array.isArray(msg.content)) continue;

      if (msg.role === "assistant") {
        for (const [, info] of pendingTools) {
          entries.push({ name: info.name, input: info.input, output: "(abandoned)", success: false });
        }
        pendingTools.clear();
      }

      for (const block of msg.content) {
        if (block.type === "toolCall") {
          const name = block.name ?? "unknown";
          if (name === "__thinking__" || name === "__thinking_placeholder__") continue;
          const args = block.arguments ?? {};
          const toolId = block.id ?? `tool-${Date.now()}`;
          pendingTools.set(toolId, { name, input: args });
          entries.push({ name, input: args });
        }

        if (block.type === "text" && msg.role === "toolResult") {
          const resultText = block.text ?? "";
          let matchedId: string | undefined;
          let matchedInfo: { name: string; input: Record<string, unknown> } | undefined;
          for (const [id, info] of pendingTools) { matchedId = id; matchedInfo = info; break; }
          if (matchedId) pendingTools.delete(matchedId);

          if (matchedInfo) {
            let last: ActivityLogEntry | undefined;
            for (let j = entries.length - 1; j >= 0; j--) {
              if (entries[j].name === matchedInfo.name && entries[j].success === undefined) {
                last = entries[j]; break;
              }
            }
            if (last) {
              last.output = resultText.slice(0, 200);
              last.success = isToolSuccess(matchedInfo.name, resultText);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[agentshire] Failed to parse activity log:", (err as Error).message);
  }
  return entries;
}

function isToolSuccess(name: string, output: string): boolean {
  if (["read", "read_file", "grep", "glob"].includes(name)) return true;
  if (["write", "write_file", "edit", "edit_file"].includes(name)) return /^Successfully/.test(output);
  const errorPatterns = [
    /^Error:/i, /^node:/, /EADDRINUSE/, /ENOENT/, /EACCES/,
    /throw\s+er;/, /command not found/i, /permission denied/i,
    /^fatal:/i, /^SyntaxError:/, /^TypeError:/, /^ReferenceError:/,
  ];
  return !errorPatterns.some(p => p.test(output));
}
