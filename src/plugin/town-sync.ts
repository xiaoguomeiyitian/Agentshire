/**
 * Town sync & init — full town re-initialization.
 *
 * `initTown()` performs a complete reset that:
 *  1. Removes all citizen agent workspaces + agent registrations
 *  2. Clears all runtime data (sessions, memories, snapshots, clock, runtime state,
 *     economy, group-chat history, agent sqlite)
 *  3. Re-creates steward workspace from the project template
 *  4. Re-creates all citizen workspaces from `town-data/citizen-config.json` (published),
 *     copying the latest soul files from `town-souls/*.md`
 *  5. Re-registers all citizen agents in `openclaw.json`
 *
 * After this, the town is in the same state as a fresh install — all citizens have
 * the latest personality files synced from the project directory.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.js";
import {
  clearAllMemories,
  clearAllSnapshots,
  clearClockState,
} from "./animal-memory.js";
import { clearTownRuntimeState } from "./town-runtime-state.js";

// ── Path helpers ──

function getPluginDir(): string {
  // dist/src/plugin/town-sync.js → up three levels to project root
  return join(fileURLToPath(import.meta.url), "..", "..", "..");
}

function getStewardWorkspaceDir(): string {
  return join(stateDir(), "workspace-town-steward");
}

function getUtilityWorkspaceDir(): string {
  return join(stateDir(), "workspace-town-utility");
}

function getAgentWorkspacePath(agentId: string): string {
  return join(stateDir(), `workspace-${agentId}`);
}

function getOpenClawConfigPath(): string {
  return join(stateDir(), "openclaw.json");
}

function getPublishedConfigPath(): string {
  return join(getPluginDir(), "town-data", "citizen-config.json");
}

// ── Identity writer (mirrors citizen-agent-manager.writeIdentity) ──

function writeIdentity(workspace: string, name: string, specialty?: string): void {
  const lines = [
    `# ${name}`,
    "",
    `- **Name:** ${name}`,
  ];
  if (specialty) lines.push(`- **Role:** ${specialty}`);
  if (specialty) lines.push(`- **Vibe:** ${specialty}`);
  writeFileSync(join(workspace, "IDENTITY.md"), lines.join("\n") + "\n", "utf-8");
}

// ── Shared file sync (town-defaults.json + town-guide.md) ──

function syncSharedFilesToWorkspace(workspace: string, pluginDir: string): void {
  const stewardDir = getStewardWorkspaceDir();
  const sharedFiles = ["town-guide.md", "town-defaults.json"];
  for (const file of sharedFiles) {
    const dst = join(workspace, file);
    const stewardSrc = join(stewardDir, file);
    const pluginSrc = join(pluginDir, "town-workspace", file);
    const src = existsSync(stewardSrc) ? stewardSrc : pluginSrc;
    if (existsSync(src)) {
      copyFileSync(src, dst);
    }
  }
}

// ── openclaw.json helpers ──

function loadOpenClawConfig(): any {
  const configPath = getOpenClawConfigPath();
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function saveOpenClawConfig(cfg: any): void {
  const configPath = getOpenClawConfigPath();
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

// ── Step 1: Remove all citizen workspaces + agent registrations ──

export interface RemovalStats {
  workspacesRemoved: number;
  agentsRemoved: number;
}

export function removeAllCitizenAgents(): RemovalStats {
  const stats: RemovalStats = { workspacesRemoved: 0, agentsRemoved: 0 };
  const root = stateDir();
  const cfg = loadOpenClawConfig();
  const agents: any[] = cfg.agents?.list ?? [];

  // Find all citizen agent ids (citizen-*) from openclaw.json
  const citizenAgentIds = agents
    .filter((a: any) => typeof a.id === "string" && a.id.startsWith("citizen-"))
    .map((a: any) => a.id);

  // Remove citizen workspaces
  for (const agentId of citizenAgentIds) {
    const ws = getAgentWorkspacePath(agentId);
    if (existsSync(ws)) {
      try {
        rmSync(ws, { recursive: true, force: true });
        stats.workspacesRemoved++;
      } catch (err) {
        console.warn(`[town-sync] Failed to remove workspace ${ws}:`, (err as Error).message);
      }
    }
  }

  // Remove citizen agent entries from openclaw.json
  const before = agents.length;
  cfg.agents.list = agents.filter((a: any) => !a.id?.startsWith("citizen-"));
  stats.agentsRemoved = before - cfg.agents.list.length;
  if (stats.agentsRemoved > 0) {
    saveOpenClawConfig(cfg);
  }

  console.log(`[town-sync] Removed ${stats.workspacesRemoved} citizen workspaces, ${stats.agentsRemoved} agent entries`);
  return stats;
}

// ── Step 2: Clear all runtime data ──

export interface ClearStats {
  sessionsCleared: number;
  memoriesCleared: boolean;
  snapshotsCleared: boolean;
  clockCleared: boolean;
  runtimeCleared: boolean;
  economyCleared: boolean;
  groupChatsCleared: boolean;
  agentSqliteCleared: number;
  stewardWorkspaceCleared: boolean;
}

export function clearAllRuntimeData(): ClearStats {
  const stats: ClearStats = {
    sessionsCleared: 0,
    memoriesCleared: false,
    snapshotsCleared: false,
    clockCleared: false,
    runtimeCleared: false,
    economyCleared: false,
    groupChatsCleared: false,
    agentSqliteCleared: 0,
    stewardWorkspaceCleared: false,
  };
  const root = stateDir();
  const agentsDir = join(root, "agents");

  // 1) Clear ALL agent sessions (no keepSessionKey — full reset)
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentId = entry.name;
      const sessionsJsonPath = join(agentsDir, agentId, "sessions", "sessions.json");
      if (!existsSync(sessionsJsonPath)) continue;
      let sessionsMap: any;
      try {
        sessionsMap = JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
      } catch {
        continue;
      }
      if (!sessionsMap || typeof sessionsMap !== "object") continue;
      const sessionDir = join(agentsDir, agentId, "sessions");
      for (const [sessionKey, meta] of Object.entries(sessionsMap)) {
        const m = meta as any;
        const sessionId = m?.sessionId;
        if (sessionId) {
          for (const suffix of [".jsonl", ".trajectory.jsonl", ".trajectory-path.json"]) {
            const fp = join(sessionDir, sessionId + suffix);
            if (existsSync(fp)) {
              try { unlinkSync(fp); } catch { /* ignore */ }
            }
          }
        }
        stats.sessionsCleared++;
      }
      try {
        writeFileSync(sessionsJsonPath, "{}\n", "utf-8");
      } catch { /* ignore */ }
    }
  }

  // 2) Clear all citizen memories (dialogues + activities JSONL)
  clearAllMemories();
  stats.memoriesCleared = true;

  // 3) Clear all activity journal snapshots
  clearAllSnapshots();
  stats.snapshotsCleared = true;

  // 4) Clear the game clock state
  clearClockState();
  stats.clockCleared = true;

  // 5) Clear the town runtime state
  clearTownRuntimeState();
  stats.runtimeCleared = true;

  // 6) Clear the economy state (animal-economy.json)
  const economyPath = join(agentsDir, "animal-economy.json");
  if (existsSync(economyPath)) {
    try { unlinkSync(economyPath); } catch { /* ignore */ }
  }
  stats.economyCleared = true;

  // 6b) N-1: Clear the inventory state (animal-inventory.json)
  const inventoryPath = join(agentsDir, "animal-inventory.json");
  if (existsSync(inventoryPath)) {
    try { unlinkSync(inventoryPath); } catch { /* ignore */ }
  }

  // 7) Clear all group-chat history
  const groupChatsDir = join(agentsDir, "group-chats");
  if (existsSync(groupChatsDir)) {
    for (const entry of readdirSync(groupChatsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const groupDir = join(groupChatsDir, entry.name);
      const historyPath = join(groupDir, "history.jsonl");
      if (existsSync(historyPath)) {
        try { unlinkSync(historyPath); } catch { /* ignore */ }
      }
    }
  }
  stats.groupChatsCleared = true;

  // 8) Clear all agent sqlite databases (agent internal state)
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentInternalDir = join(agentsDir, entry.name, "agent");
      if (!existsSync(agentInternalDir)) continue;
      for (const file of readdirSync(agentInternalDir)) {
        if (file.endsWith(".sqlite") || file.endsWith(".sqlite-shm") || file.endsWith(".sqlite-wal")) {
          try { unlinkSync(join(agentInternalDir, file)); stats.agentSqliteCleared++; } catch { /* ignore */ }
        }
      }
    }
  }

  // 9) Remove steward workspace (will be re-created in step 3)
  const stewardWs = getStewardWorkspaceDir();
  if (existsSync(stewardWs)) {
    try {
      rmSync(stewardWs, { recursive: true, force: true });
      stats.stewardWorkspaceCleared = true;
    } catch (err) {
      console.warn(`[town-sync] Failed to remove steward workspace:`, (err as Error).message);
    }
  }

  console.log(`[town-sync] Cleared: sessions=${stats.sessionsCleared} memories+snapshots+clock+runtime+economy+groupChats+sqlite=${stats.agentSqliteCleared} stewardWs=${stats.stewardWorkspaceCleared}`);
  return stats;
}

// ── Step 3: Re-create steward workspace from template ──

export function recreateStewardWorkspace(): boolean {
  const pluginDir = getPluginDir();
  const templateDir = join(pluginDir, "town-workspace");
  const stewardWs = getStewardWorkspaceDir();

  if (!existsSync(templateDir)) {
    console.warn(`[town-sync] Template dir not found: ${templateDir}`);
    return false;
  }

  mkdirSync(stewardWs, { recursive: true });

  // Copy all template files (SOUL.md, IDENTITY.md, town-defaults.json, town-guide.md)
  for (const file of readdirSync(templateDir)) {
    const src = join(templateDir, file);
    const dst = join(stewardWs, file);
    copyFileSync(src, dst);
  }

  // Resolve personaFile paths in town-defaults.json to absolute plugin paths
  const defaultsPath = join(stewardWs, "town-defaults.json");
  if (existsSync(defaultsPath)) {
    try {
      const data = JSON.parse(readFileSync(defaultsPath, "utf-8"));
      const resolve = (p: string) => p && !p.startsWith("/") ? join(pluginDir, p) : p;
      if (data.steward) data.steward.personaFile = resolve(data.steward.personaFile ?? "");
      if (Array.isArray(data.citizens)) {
        data.citizens = data.citizens.map((c: any) => ({ ...c, personaFile: resolve(c.personaFile ?? "") }));
      }
      writeFileSync(defaultsPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[town-sync] Failed to resolve steward town-defaults:`, (err as Error).message);
    }
  }

  console.log(`[town-sync] Re-created steward workspace at ${stewardWs}`);
  return true;
}

// ── Step 4: Re-create citizen workspaces from published config ──

export interface CitizenSyncStats {
  citizensCreated: number;
  agentsRegistered: number;
}

export function recreateCitizenWorkspaces(): CitizenSyncStats {
  const pluginDir = getPluginDir();
  const stats: CitizenSyncStats = { citizensCreated: 0, agentsRegistered: 0 };
  const publishedPath = getPublishedConfigPath();

  if (!existsSync(publishedPath)) {
    console.warn(`[town-sync] Published config not found: ${publishedPath}`);
    return stats;
  }

  let published: any;
  try {
    published = JSON.parse(readFileSync(publishedPath, "utf-8"));
  } catch (err) {
    console.warn(`[town-sync] Failed to read published config:`, (err as Error).message);
    return stats;
  }

  const chars: any[] = published.characters ?? [];
  const citizens = chars.filter((c: any) => c.role === "citizen" && c.agentEnabled && c.agentId);

  // Load openclaw.json to register agents
  const cfg = loadOpenClawConfig();
  if (!cfg.agents) cfg.agents = {};
  if (!cfg.agents.list) cfg.agents.list = [];

  for (const c of citizens) {
    const agentId = c.agentId;
    const workspace = getAgentWorkspacePath(agentId);

    // Create workspace
    mkdirSync(workspace, { recursive: true });

    // Copy soul file from town-souls/<persona>.md
    const personaKey = c.persona || "";
    if (personaKey) {
      const soulSrc = join(pluginDir, "town-souls", `${personaKey}.md`);
      if (existsSync(soulSrc)) {
        writeFileSync(join(workspace, "SOUL.md"), readFileSync(soulSrc, "utf-8"), "utf-8");
      } else {
        console.warn(`[town-sync] Soul file not found for ${c.name}: ${soulSrc}`);
      }
    }

    // Write IDENTITY.md
    writeIdentity(workspace, c.name, c.specialty);

    // Sync shared files (town-defaults.json + town-guide.md) from steward workspace
    syncSharedFilesToWorkspace(workspace, pluginDir);

    stats.citizensCreated++;

    // Register agent in openclaw.json if not already present
    if (!cfg.agents.list.some((a: any) => a.id === agentId)) {
      const entry: Record<string, any> = {
        id: agentId,
        name: c.name,
        workspace,
        identity: { name: c.name },
      };
      if (c.modelRef) entry.model = c.modelRef;
      cfg.agents.list.push(entry);
      stats.agentsRegistered++;
    }
  }

  if (stats.agentsRegistered > 0) {
    saveOpenClawConfig(cfg);
  }

  console.log(`[town-sync] Re-created ${stats.citizensCreated} citizen workspaces, registered ${stats.agentsRegistered} agents`);
  return stats;
}

// ── Full init: orchestrate all steps ──

export interface InitTownResult {
  success: boolean;
  removal: RemovalStats;
  clearing: ClearStats;
  stewardRecreated: boolean;
  citizens: CitizenSyncStats;
  error?: string;
}

/**
 * Full town re-initialization.
 *
 * Removes all citizen agents + workspaces, clears all runtime data,
 * re-creates steward + citizen workspaces from project templates / published config,
 * and re-registers citizen agents in openclaw.json.
 *
 * After calling this, the caller should restart OpenClaw so the gateway picks up
 * the new openclaw.json and re-instantiates all agents.
 */
export function initTown(): InitTownResult {
  try {
    const removal = removeAllCitizenAgents();
    const clearing = clearAllRuntimeData();
    const stewardRecreated = recreateStewardWorkspace();
    const citizens = recreateCitizenWorkspaces();

    console.log(`[town-sync] initTown complete: removed=${removal.workspacesRemoved}ws cleared=${clearing.sessionsCleared}sess steward=${stewardRecreated} citizens=${citizens.citizensCreated}`);

    return {
      success: true,
      removal,
      clearing,
      stewardRecreated,
      citizens,
    };
  } catch (err: any) {
    console.error(`[town-sync] initTown failed:`, err);
    return {
      success: false,
      removal: { workspacesRemoved: 0, agentsRemoved: 0 },
      clearing: {
        sessionsCleared: 0, memoriesCleared: false, snapshotsCleared: false,
        clockCleared: false, runtimeCleared: false, economyCleared: false,
        groupChatsCleared: false, agentSqliteCleared: 0, stewardWorkspaceCleared: false,
      },
      stewardRecreated: false,
      citizens: { citizensCreated: 0, agentsRegistered: 0 },
      error: err?.message ?? "unknown error",
    };
  }
}
