import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.js";

const AGENT_ID = "town-steward";
const UTILITY_AGENT_ID = "town-utility";
const CHANNEL_ID = "agentshire";
const TEMPLATE_DIR = "town-workspace";

function getPluginDir(): string {
  return join(fileURLToPath(import.meta.url), "../../..");
}

function ensureTownWorkspace(): string {
  const agentDir = join(stateDir(), `workspace-${AGENT_ID}`);
  const templateDir = join(getPluginDir(), TEMPLATE_DIR);
  if (!existsSync(templateDir)) {
    console.warn(
      `[agentshire] Template workspace not found at ${templateDir}`,
    );
    return agentDir;
  }

  mkdirSync(agentDir, { recursive: true });

  const pluginDir = getPluginDir();
  const SDK_DEFAULT_MARKERS = [
    "# SOUL.md - Who You Are",
    "# IDENTITY.md - Who Am I?",
  ];
  for (const file of readdirSync(templateDir)) {
    const src = join(templateDir, file);
    const dst = join(agentDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
    } else {
      const existing = readFileSync(dst, "utf-8");
      if (SDK_DEFAULT_MARKERS.some((m) => existing.startsWith(m))) {
        copyFileSync(src, dst);
      }
    }
  }

  const defaultsPath = join(agentDir, "town-defaults.json");
  if (existsSync(defaultsPath)) {
    try {
      const data = JSON.parse(readFileSync(defaultsPath, "utf-8"));
      const resolve = (p: string) => p && !p.startsWith("/") ? join(pluginDir, p) : p;
      if (data.steward) data.steward.personaFile = resolve(data.steward.personaFile ?? "");
      if (Array.isArray(data.citizens)) {
        data.citizens = data.citizens.map((c: any) => ({ ...c, personaFile: resolve(c.personaFile ?? "") }));
      }
      writeFileSync(defaultsPath, JSON.stringify(data, null, 2), "utf-8");
    } catch {}
  }

  console.log(`[agentshire] Initialized workspace at ${agentDir}`);
  return agentDir;
}

export async function ensureTownAgentConfig(): Promise<void> {
  try {
    const configPath = join(stateDir(), "openclaw.json");
    if (!existsSync(configPath)) return;

    const raw = readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);

    const agents: any[] = cfg.agents?.list ?? [];
    const hasAgent = agents.some((a: any) => a.id === AGENT_ID);

    const bindings: any[] = cfg.bindings ?? [];
    const hasBinding = bindings.some(
      (b: any) => b.match?.channel === CHANNEL_ID && b.agentId === AGENT_ID,
    );

    let dirty = false;
    const workspaceDir = ensureTownWorkspace();

    if (!hasAgent) {
      cfg.agents = cfg.agents ?? {};
      cfg.agents.list = cfg.agents.list ?? [];
      cfg.agents.list.push({
        id: AGENT_ID,
        name: "shire",
        workspace: workspaceDir,
        identity: { name: "shire", emoji: "🏘️" },
      });
      dirty = true;
    }

    // Ensure the utility agent exists (for summary/soul generation via
    // OpenClaw runtime, inheriting the global default model + fallbacks).
    const hasUtilityAgent = agents.some((a: any) => a.id === UTILITY_AGENT_ID);
    if (!hasUtilityAgent) {
      const utilityWorkspace = join(stateDir(), `workspace-${UTILITY_AGENT_ID}`);
      mkdirSync(utilityWorkspace, { recursive: true });
      // Minimal SOUL.md so the agent has a persona
      if (!existsSync(join(utilityWorkspace, "SOUL.md"))) {
        writeFileSync(
          join(utilityWorkspace, "SOUL.md"),
          "# Utility Agent\n\n你是一个工具型助手，负责摘要生成、灵魂文件生成等后台任务。请直接完成任务，不要寒暄。\n",
          "utf-8",
        );
      }
      cfg.agents = cfg.agents ?? {};
      cfg.agents.list = cfg.agents.list ?? [];
      cfg.agents.list.push({
        id: UTILITY_AGENT_ID,
        name: "utility",
        workspace: utilityWorkspace,
        identity: { name: "utility", emoji: "🔧" },
      });
      dirty = true;
      console.log(`[agentshire] Auto-configured ${UTILITY_AGENT_ID} agent for background LLM tasks`);
    }

    if (!hasBinding) {
      cfg.bindings = cfg.bindings ?? [];
      cfg.bindings.push({
        type: "route",
        agentId: AGENT_ID,
        comment: "Route agentshire channel to dedicated steward agent",
        match: { channel: CHANNEL_ID },
      });
      dirty = true;
    }

    const DEFAULT_TIMEOUT = 600;
    const subagents = cfg.agents?.defaults?.subagents ?? {};
    if (!subagents.runTimeoutSeconds || subagents.runTimeoutSeconds < DEFAULT_TIMEOUT) {
      cfg.agents = cfg.agents ?? {};
      cfg.agents.defaults = cfg.agents.defaults ?? {};
      cfg.agents.defaults.subagents = {
        ...subagents,
        runTimeoutSeconds: Math.max(subagents.runTimeoutSeconds ?? 0, DEFAULT_TIMEOUT),
      };
      dirty = true;
    }

    if (!dirty) return;

    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    console.log(
      `[agentshire] Auto-configured ${AGENT_ID} agent + binding in openclaw.json`,
    );
  } catch (err) {
    console.error("[agentshire] Failed to auto-configure agent:", err);
  }
}
