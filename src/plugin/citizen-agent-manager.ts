/**
 * Manages independent citizen agents in openclaw.json agents.list.
 * Creates workspace + SOUL.md for each citizen.
 * No sub-agents — each citizen is a full independent agent.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.js";

export interface AgentChange {
  action: "create" | "disable" | "update_soul";
  citizenId: string;
  citizenName: string;
  agentId: string;
  soulContent?: string;
  specialty?: string;
  /** LLM model ref in "providerId/modelId" form; undefined = inherit global default */
  modelRef?: string;
}

export interface AgentChangeResult {
  citizenId: string;
  action: string;
  success: boolean;
  agentId?: string;
  error?: string;
}

function getOpenClawConfigPath(): string {
  return join(stateDir(), "openclaw.json");
}

function getAgentWorkspacePath(agentId: string): string {
  return join(stateDir(), `workspace-${agentId}`);
}

function loadOpenClawConfig(): any {
  const configPath = getOpenClawConfigPath();
  if (!existsSync(configPath)) throw new Error("openclaw.json not found");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function saveOpenClawConfig(cfg: any): void {
  const configPath = getOpenClawConfigPath();
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function getPluginDir(): string {
  return join(fileURLToPath(import.meta.url), "../../..");
}

function getStewardWorkspaceDir(): string {
  return join(stateDir(), "workspace-town-steward");
}

function syncSharedFiles(workspace: string): void {
  const pluginDir = getPluginDir();
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

function writeIdentity(workspace: string, name: string, specialty?: string): void {
  const lines = [
    `# ${name}`,
    "",
    `- **Name:** ${name}`,
  ];
  if (specialty) lines.push(`- **Role:** ${specialty}`);
  if (specialty) lines.push(`- Vibe: ${specialty}`);
  writeFileSync(join(workspace, "IDENTITY.md"), lines.join("\n") + "\n", "utf-8");
}

function createAgentWorkspace(agentId: string, soulContent: string, name: string, specialty?: string): void {
  const workspace = getAgentWorkspacePath(agentId);
  if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "SOUL.md"), soulContent, "utf-8");
  writeIdentity(workspace, name, specialty);
  syncSharedFiles(workspace);
}

function updateSoulFile(agentId: string, soulContent: string, name: string, specialty?: string): void {
  const workspace = getAgentWorkspacePath(agentId);
  if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "SOUL.md"), soulContent, "utf-8");
  writeIdentity(workspace, name, specialty);
  syncSharedFiles(workspace);
}

function addAgentToConfig(agentId: string, citizenName: string, _specialty?: string, modelRef?: string): void {
  const cfg = loadOpenClawConfig();
  const agents: any[] = cfg.agents?.list ?? [];
  if (agents.some((a: any) => a.id === agentId)) return;

  if (!cfg.agents) cfg.agents = {};
  if (!cfg.agents.list) cfg.agents.list = [];
  const identity: Record<string, string> = { name: citizenName };
  const entry: Record<string, any> = {
    id: agentId,
    name: citizenName,
    workspace: getAgentWorkspacePath(agentId),
    identity,
  };
  if (modelRef) entry.model = modelRef;
  cfg.agents.list.push(entry);
  saveOpenClawConfig(cfg);
  console.log(`[citizen-agent-manager] Added agent ${agentId} to openclaw.json${modelRef ? ` (model=${modelRef})` : ""}`);
}

/** Update an existing agent's model ref in openclaw.json. Exported for steward model updates. */
export function updateAgentModel(agentId: string, modelRef: string | undefined): void {
  const cfg = loadOpenClawConfig();
  const agents: any[] = cfg.agents?.list ?? [];
  const agent = agents.find((a: any) => a.id === agentId);
  if (!agent) return;
  let changed = false;
  if (modelRef) {
    if (agent.model !== modelRef) { agent.model = modelRef; changed = true; }
  } else if (agent.model) {
    delete agent.model;
    changed = true;
  }
  if (changed) {
    saveOpenClawConfig(cfg);
    console.log(`[citizen-agent-manager] Updated agent ${agentId} model to ${modelRef ?? "(default)"}`);
  }
}

/**
 * Read an agent's model ref from openclaw.json.
 * Returns undefined if the agent has no explicit model (inherits global default).
 * Exported for the before_model_resolve hook to dynamically override models per-agent.
 */
export function getAgentModelRef(agentId: string): string | undefined {
  try {
    const cfg = loadOpenClawConfig();
    const agents: any[] = cfg.agents?.list ?? [];
    const agent = agents.find((a: any) => a.id === agentId);
    if (!agent?.model) return undefined;
    return typeof agent.model === "string" ? agent.model : agent.model.primary;
  } catch {
    return undefined;
  }
}

/**
 * Read an agent's full config from openclaw.json.
 * Returns the agent object or undefined if not found.
 */
export function getAgentConfig(agentId: string): any | undefined {
  try {
    const cfg = loadOpenClawConfig();
    const agents: any[] = cfg.agents?.list ?? [];
    return agents.find((a: any) => a.id === agentId);
  } catch {
    return undefined;
  }
}

/**
 * Update an agent's config fields in openclaw.json.
 * Accepts a partial patch object and deep-merges it into the agent entry.
 * Setting a field to null deletes it from the config.
 */
export function updateAgentConfig(agentId: string, patch: Record<string, any>): void {
  const cfg = loadOpenClawConfig();
  const agents: any[] = cfg.agents?.list ?? [];
  const agent = agents.find((a: any) => a.id === agentId);
  if (!agent) return;
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (key in agent) { delete agent[key]; changed = true; }
    } else {
      // Deep merge for objects (e.g. identity, subagents, model)
      if (value && typeof value === "object" && !Array.isArray(value) && agent[key] && typeof agent[key] === "object" && !Array.isArray(agent[key])) {
        agent[key] = { ...agent[key], ...value };
      } else {
        agent[key] = value;
      }
      changed = true;
    }
  }
  if (changed) {
    saveOpenClawConfig(cfg);
    console.log(`[citizen-agent-manager] Updated agent ${agentId} config: ${Object.keys(patch).join(", ")}`);
  }
}

function removeAgentFromConfig(agentId: string): void {
  const cfg = loadOpenClawConfig();
  const agents: any[] = cfg.agents?.list ?? [];
  const before = agents.length;
  cfg.agents.list = agents.filter((a: any) => a.id !== agentId);
  if (cfg.agents.list.length < before) {
    saveOpenClawConfig(cfg);
    console.log(`[citizen-agent-manager] Removed agent ${agentId} from openclaw.json`);
  }
}

function isAgentInConfig(agentId: string): boolean {
  try {
    const cfg = loadOpenClawConfig();
    return (cfg.agents?.list ?? []).some((a: any) => a.id === agentId);
  } catch {
    return false;
  }
}

export function buildAgentId(citizenId: string): string {
  return `citizen-${citizenId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export async function applyAgentChanges(
  changes: AgentChange[],
): Promise<AgentChangeResult[]> {
  const results: AgentChangeResult[] = [];

  for (const change of changes) {
    try {
      switch (change.action) {
        case "create": {
          if (!change.soulContent) throw new Error("soulContent is required for create");
          createAgentWorkspace(change.agentId, change.soulContent, change.citizenName, change.specialty);
          addAgentToConfig(change.agentId, change.citizenName, change.specialty, change.modelRef);
          results.push({ citizenId: change.citizenId, action: "create", success: true, agentId: change.agentId });
          // Auto-join default group chat
          try {
            const { addParticipantToDefaultGroup } = await import("./group-chat.js");
            addParticipantToDefaultGroup({
              npcId: change.citizenId,
              name: change.citizenName,
              agentId: change.agentId,
              specialty: change.specialty,
              modelRef: change.modelRef,
            });
          } catch (err) {
            console.warn(`[citizen-agent-manager] Failed to add ${change.citizenName} to default group:`, (err as Error).message);
          }
          break;
        }
        case "disable": {
          removeAgentFromConfig(change.agentId);
          results.push({ citizenId: change.citizenId, action: "disable", success: true, agentId: change.agentId });
          // Auto-remove from default group chat
          try {
            const { removeParticipantFromDefaultGroup } = await import("./group-chat.js");
            removeParticipantFromDefaultGroup(change.citizenId);
          } catch (err) {
            console.warn(`[citizen-agent-manager] Failed to remove ${change.citizenId} from default group:`, (err as Error).message);
          }
          break;
        }
        case "update_soul": {
          if (!change.soulContent) throw new Error("soulContent is required for update_soul");
          updateSoulFile(change.agentId, change.soulContent, change.citizenName, change.specialty);
          if (!isAgentInConfig(change.agentId)) {
            addAgentToConfig(change.agentId, change.citizenName, undefined, change.modelRef);
          } else {
            updateAgentModel(change.agentId, change.modelRef);
          }
          results.push({ citizenId: change.citizenId, action: "update_soul", success: true, agentId: change.agentId });
          break;
        }
      }
    } catch (err: any) {
      const errMsg = err?.message ?? "Unknown error";
      console.error(`[citizen-agent-manager] Failed to ${change.action} agent for ${change.citizenName}: ${errMsg}`);
      results.push({ citizenId: change.citizenId, action: change.action, success: false, error: errMsg });
    }
  }

  return results;
}
