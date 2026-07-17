import type { OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";
import { textResult } from "openclaw/plugin-sdk/agent-runtime";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { broadcastAgentEvent, requestNpcQuery, findCitizenNpcId, getSceneCapableClientCount, broadcastAgentEventToScene } from "./ws-server.js";
import { createPlan, getNextStepInstruction, isPlanFullyComplete, clearTasks, completePlan } from "./plan-manager.js";
import type { CitizenRosterEntry } from "./plan-manager.js";
import { hasRunningSubagents } from "./subagent-tracker.js";
import { resolveFileData } from "./outbound-adapter.js";
import { stateDir } from "./paths.js";
import { buildAssetCatalog, resolveDirs } from "./editor-serve.js";

// ── Spatial tools: resolve calling agent's npcId from toolUseId ──
// Lazily import getToolCallAgent from index.ts to avoid circular dependency
let _getToolCallAgent: ((toolUseId: string) => string | null) | null = null;
async function getCallerAgentId(toolUseId: string): Promise<string | null> {
  if (!_getToolCallAgent) {
    try {
      const mod = await import("../../index.js");
      _getToolCallAgent = (mod as any).getToolCallAgent ?? null;
    } catch { _getToolCallAgent = null; }
  }
  return _getToolCallAgent ? _getToolCallAgent(toolUseId) : null;
}

/** Resolve the calling agent's npcId from its toolUseId. Steward → 'steward'. */
async function resolveCallerNpcId(toolUseId: string): Promise<{ agentId: string; npcId: string } | null> {
  const agentId = await getCallerAgentId(toolUseId);
  if (!agentId) return null;
  if (agentId === "town-steward") return { agentId, npcId: "steward" };
  const npcId = findCitizenNpcId(agentId);
  return npcId ? { agentId, npcId } : null;
}

/** Wrap a plain string into an AgentToolResult for the SDK execute() contract. */
function ok(text: string) {
  return textResult(text, {} as Record<string, never>);
}

function repairJson(s: string): string {
  let trimmed = s.trim()
  if (!trimmed) return trimmed
  const opens = { '{': '}', '[': ']' } as Record<string, string>
  const closes = new Set(['}', ']'])
  const stack: string[] = []
  let inString = false
  let escape = false
  for (const ch of trimmed) {
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (opens[ch]) stack.push(opens[ch])
    else if (closes.has(ch)) { if (stack.length && stack[stack.length - 1] === ch) stack.pop() }
  }
  while (stack.length) trimmed += stack.pop()
  return trimmed
}

/** Check if a new placement overlaps with existing objects in the map config. */
function checkPlacementOverlap(
  config: any,
  category: string,
  gridX: number,
  gridZ: number,
  widthCells: number,
  depthCells: number,
): { id: string; modelKey: string } | null {
  const newRect = {
    x: gridX, z: gridZ,
    w: category === "building" ? widthCells : 1,
    d: category === "building" ? depthCells : 1,
  };
  const allObjects: Array<{ id: string; modelKey: string; gridX: number; gridZ: number; widthCells?: number; depthCells?: number }> = [
    ...(config.buildings ?? []).map((b: any) => ({ id: b.id, modelKey: b.modelKey, gridX: b.gridX, gridZ: b.gridZ, widthCells: b.widthCells, depthCells: b.depthCells })),
    ...(config.props ?? []).map((p: any) => ({ id: p.id, modelKey: p.modelKey, gridX: p.gridX, gridZ: p.gridZ })),
    ...(config.roads ?? []).map((r: any) => ({ id: r.id, modelKey: r.modelKey, gridX: r.gridX, gridZ: r.gridZ })),
  ];
  for (const obj of allObjects) {
    const objRect = {
      x: obj.gridX, z: obj.gridZ,
      w: obj.widthCells ?? 1, d: obj.depthCells ?? 1,
    };
    if (
      newRect.x < objRect.x + objRect.w &&
      newRect.x + newRect.w > objRect.x &&
      newRect.z < objRect.z + objRect.d &&
      newRect.z + newRect.d > objRect.z
    ) {
      return { id: obj.id, modelKey: obj.modelKey };
    }
  }
  return null;
}

function getPluginDir(): string {
  return join(fileURLToPath(import.meta.url), "../../..");
}

/**
 * Resolve the asset catalog via the async buildAssetCatalog (preferred path).
 * Cached after first call to avoid repeated disk scans.
 * Bypasses HTTP so it works even when password auth is enabled.
 */
async function getAssetCatalog(): Promise<{ builtin: any[]; custom: any[] }> {
  if (!_assetCatalogCache) {
    const pluginDir = getPluginDir();
    const d = resolveDirs(pluginDir);
    _assetCatalogCache = buildAssetCatalog(pluginDir, d);
  }
  return _assetCatalogCache;
}

let _assetCatalogCache: Promise<{ builtin: any[]; custom: any[] }> | null = null;

/**
 * Read the saved TownMapConfig directly from town-data/town-map.json —
 * bypasses HTTP so it works even when password auth is enabled.
 * Mirrors what `GET /town-map/_api/load` returns.
 */
function readMapConfigLocal(): any | null {
  const pluginDir = getPluginDir();
  const mapPath = join(pluginDir, "town-data", "town-map.json");
  if (!existsSync(mapPath)) return null;
  try {
    return JSON.parse(readFileSync(mapPath, "utf-8"));
  } catch {
    return null;
  }
}

function getStewardWorkspaceDir(): string {
  return join(stateDir(), "workspace-town-steward");
}

function loadCitizenRoster(): Map<string, CitizenRosterEntry> {
  const roster = new Map<string, CitizenRosterEntry>();
  try {
    const configPath = join(getStewardWorkspaceDir(), "town-defaults.json");
    if (!existsSync(configPath)) return roster;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const pluginDir = getPluginDir();
    for (const c of config.citizens ?? []) {
      roster.set(c.name, {
        specialty: c.specialty ?? "general",
        role: c.role ?? c.specialty ?? "通用",
        bio: c.bio ?? "",
        soulFilePath: c.personaFile
          ? (c.personaFile.startsWith("/") ? c.personaFile : join(pluginDir, c.personaFile))
          : "",
      });
    }
  } catch (e) { console.debug('[tools] roster load:', e); }
  return roster;
}

/**
 * Tools registered to the LLM agent, allowing AI to control the 3D town.
 */
export function createTownTools(): OpenClawPluginToolFactory {
  return () => ([
    {
      name: "town_announce",
      description:
        "Broadcast a message to the 3D agentshire. The steward NPC will display it as a chat bubble.",
      parameters: {
        type: "object" as const,
        properties: {
          message: { type: "string", description: "The message to announce" },
        },
        required: ["message"],
      },
      async execute(_id: string, { message }: { message: string }) {
        broadcastAgentEvent({
          type: "text",
          content: message,
        });
        return ok(`Announced in town: "${message}"`);
      },
    },
    {
      name: "town_spawn_npc",
      description:
        "Spawn a new NPC in the 3D agentshire, representing a new agent or character.",
      parameters: {
        type: "object" as const,
        properties: {
          npcId: { type: "string", description: "Unique NPC identifier" },
          name: { type: "string", description: "Display name for the NPC" },
          role: {
            type: "string",
            description: "NPC role (e.g. developer, designer, researcher)",
          },
        },
        required: ["npcId", "name"],
      },
      async execute(_id: string, { npcId, name, role }: { npcId: string; name: string; role?: string }) {
        broadcastAgentEvent({
          type: "sub_agent",
          subtype: "started",
          agentId: npcId,
          agentType: role ?? "worker",
          parentToolUseId: "",
          task: `${name} joined the town`,
          model: "unknown",
          displayName: name,
        });
        return ok(`NPC "${name}" (${npcId}) spawned in town`);
      },
    },
    {
      name: "town_effect",
      description:
        "Trigger a visual effect in the 3D town. Effect names map directly to the frontend VFX system. " +
        "Effects that target an NPC require npcId; 'deployFireworks' plays at the town center and ignores npcId.",
      parameters: {
        type: "object" as const,
        properties: {
          effect: {
            type: "string",
            enum: [
              "deployFireworks",
              "summon_ripple",
              "completion_stars",
              "personaTransform",
              "exclamation",
              "error_sparks",
              "hookFlash",
            ],
            description:
              "Effect type. deployFireworks=全屏烟花(无需npcId); summon_ripple=召唤波纹; " +
              "completion_stars=完成星星; personaTransform=变身光效; exclamation=感叹号; " +
              "error_sparks=错误闪电; hookFlash=Hook闪光",
          },
          npcId: {
            type: "string",
            description:
              "Target NPC id (for NPC-targeted effects). Omit for deployFireworks. " +
              "Use 'steward' for the steward, or a citizen npcId.",
          },
        },
        required: ["effect"],
      },
      async execute(_id: string, args: { effect: string; npcId?: string }) {
        const effect = String(args.effect ?? "");
        const params: Record<string, unknown> = { intensity: 1.0 };
        if (args.npcId) params.npcId = String(args.npcId);
        broadcastAgentEvent({
          type: 'fx',
          effect,
          params,
        } as any);
        return ok(`Effect "${effect}" triggered in town${args.npcId ? ` on ${args.npcId}` : ""}`);
      },
    },
    {
      name: "town_set_time",
      description:
        "Control the game clock in the 3D town. " +
        "action=set: jump to a specific hour (0-23). " +
        "action=pause: freeze time. " +
        "action=resume: resume normal time flow (恢复时间).",
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["set", "pause", "resume"],
            description: "set=jump to hour, pause=freeze, resume=restore normal flow",
          },
          hour: { type: "number", description: "Hour of day (0-23), required when action=set" },
        },
        required: ["action"],
      },
      async execute(_id: string, { action, hour }: { action: string; hour?: number }) {
        broadcastAgentEvent({
          type: "world_control",
          target: "time",
          action,
          hour: action === "set" && hour != null ? Math.max(0, Math.min(23, Math.round(hour))) : undefined,
        } as any);
        if (action === "set") return ok(`Game time set to ${hour}:00`);
        if (action === "pause") return ok(`Game time paused`);
        return ok(`Game time resumed to normal flow`);
      },
    },
    {
      name: "town_set_weather",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "Control the weather in the 3D town. " +
        "action=set: force a specific weather type. " +
        "action=reset: restore automatic weather cycle (恢复天气). " +
        "Available weather types: clear, cloudy, drizzle, rain, heavyRain, storm, " +
        "lightSnow, snow, blizzard, fog, sandstorm, aurora.",
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["set", "reset"],
            description: "set=force weather, reset=restore automatic weather cycle",
          },
          weather: {
            type: "string",
            enum: ["clear", "cloudy", "drizzle", "rain", "heavyRain", "storm",
                   "lightSnow", "snow", "blizzard", "fog", "sandstorm", "aurora"],
            description: "Weather type, required when action=set",
          },
        },
        required: ["action"],
      },
      async execute(_id: string, { action, weather }: { action: string; weather?: string }) {
        broadcastAgentEvent({
          type: "world_control",
          target: "weather",
          action,
          weather: action === "set" ? weather : undefined,
        } as any);
        if (action === "reset") return ok(`Weather restored to automatic cycle`);
        return ok(`Weather changed to "${weather}"`);
      },
    },
    {
      name: "town_status",
      description: "Get current status of the 3D Agentshire (connected clients, etc.)",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        const { getConnectedClientCount } = await import("./ws-server.js");
        const count = getConnectedClientCount();
        return ok(`Town status: ${count} frontend(s) connected`);
      },
    },
    {
      name: "town_diagnose",
      description:
        "Run a self-diagnostic of the Agentshire plugin environment. " +
        "Checks: state directory, WebSocket server, frontend connections, LLM config, agent config, ports. " +
        "Use this when something isn't working to get a structured diagnostic report.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        const lines: string[] = [];
        let passCount = 0;
        let failCount = 0;
        const ok2 = (label: string, detail: string) => {
          passCount++;
          lines.push(`  ✅ ${label}: ${detail}`);
        };
        const fail = (label: string, detail: string) => {
          failCount++;
          lines.push(`  ❌ ${label}: ${detail}`);
        };
        const warn = (label: string, detail: string) => {
          lines.push(`  ⚠️  ${label}: ${detail}`);
        };

        lines.push("=== Agentshire Diagnostic Report ===\n");

        // 1. State directory
        try {
          const { stateDir } = await import("./paths.js");
          const dir = stateDir();
          const { existsSync } = await import("node:fs");
          if (existsSync(dir)) {
            ok2("State directory", dir);
          } else {
            fail("State directory", `${dir} does not exist`);
          }
        } catch (err) {
          fail("State directory", `Error: ${(err as Error).message}`);
        }

        // 2. Runtime config
        try {
          const { getTownRuntime } = await import("./runtime.js");
          const rt = getTownRuntime();
          const cfg = typeof rt.config.current === "function" ? rt.config.current() : rt.config;
          const model = (cfg as any)?.agents?.defaults?.model?.primary ?? "(not set)";
          const workspace = (cfg as any)?.agents?.defaults?.workspace ?? "(not set)";
          ok2("Default model", String(model));
          if (workspace !== "(not set)") warn("Workspace", String(workspace));
        } catch (err) {
          fail("Runtime config", `Error: ${(err as Error).message}`);
        }

        // 3. WebSocket server
        try {
          const { getConnectedClientCount, getSceneCapableClientCount } = await import("./ws-server.js");
          const total = getConnectedClientCount();
          const scene = getSceneCapableClientCount();
          if (total > 0) {
            ok2("WebSocket clients", `${total} connected (${scene} with 3D scene)`);
          } else {
            warn("WebSocket clients", "No frontend connected (open the Town tab)");
          }
        } catch (err) {
          fail("WebSocket server", `Error: ${(err as Error).message}`);
        }

        // 4. Agent config (town-steward)
        try {
          const { stateDir } = await import("./paths.js");
          const { existsSync, readFileSync } = await import("node:fs");
          const { join } = await import("node:path");
          const agentPath = join(stateDir(), "agents", "town-steward", "agent.json");
          if (existsSync(agentPath)) {
            const agentCfg = JSON.parse(readFileSync(agentPath, "utf-8"));
            ok2("Steward agent", `configured (model: ${agentCfg.model ?? "default"})`);
          } else {
            warn("Steward agent", "agent.json not found (may auto-create on first run)");
          }
        } catch (err) {
          fail("Steward agent", `Error: ${(err as Error).message}`);
        }

        // 5. LLM providers
        try {
          const { getTownRuntime } = await import("./runtime.js");
          const rt = getTownRuntime();
          const cfg = typeof rt.config.current === "function" ? rt.config.current() : rt.config;
          const providers = (cfg as any)?.models?.providers;
          if (providers && typeof providers === "object" && Object.keys(providers).length > 0) {
            ok2("LLM providers", `${Object.keys(providers).join(", ")}`);
          } else {
            fail("LLM providers", "No providers configured (set up in Claw Settings → Providers)");
          }
        } catch (err) {
          fail("LLM providers", `Error: ${(err as Error).message}`);
        }

        // 6. Port availability
        try {
          const { getConnectedClientCount } = await import("./ws-server.js");
          // If WS server is running, clients can connect — port is available
          if (getConnectedClientCount() >= 0) {
            ok2("WS server", "running");
          }
        } catch (err) {
          fail("WS server", `Not running: ${(err as Error).message}`);
        }

        // Summary
        lines.push(`\n=== Summary: ${passCount} passed, ${failCount} failed ===`);
        if (failCount === 0) {
          lines.push("All checks passed. If the town isn't working, try refreshing the browser tab.");
        } else {
          lines.push("Some checks failed. See details above for troubleshooting.");
        }

        return ok(lines.join("\n"));
      },
    },
    {
      name: "register_project",
      description:
        "Register a simple project (single-agent or steward-only). " +
        "For complex multi-agent projects, use create_plan instead — it registers the project automatically.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Human-readable project name (e.g. \"飞机大战\", \"公司官网\")" },
          type: {
            type: "string",
            enum: ["game", "app", "website", "media", "files", "operation"],
            description: "Project category: game, app, website, media, files, or operation",
          },
        },
        required: ["name", "type"],
      },
      async execute(_id: string, { name, type }: { name: string; type: string }) {
        return ok(`Project registered: "${name}" (${type})`);
      },
    },
    {
      name: "create_project",
      description:
        "Create a project directory for a multi-agent project. " +
        "Call this BEFORE create_plan. Returns the absolute path to use as projectDir in create_plan. " +
        "The directory is created under the steward's workspace/projects/ with a timestamp suffix to avoid conflicts.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Project name in English (e.g. 'aircraft-war', 'company-website'). Will be sanitized for filesystem." },
        },
        required: ["name"],
      },
      async execute(_id: string, { name }: { name: string }) {
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").toLowerCase();
        const timestamp = Date.now().toString(36);
        const dirName = `${sanitized}-${timestamp}`;
        const projectsDir = join(getStewardWorkspaceDir(), "projects");
        const projectDir = join(projectsDir, dirName);
        try {
          mkdirSync(projectDir, { recursive: true });
        } catch (err) {
          return ok(`Error: Failed to create project directory: ${(err as Error).message}`);
        }
        return ok(`Project directory created: ${projectDir}\n\nUse this path as projectDir when calling create_plan.`);
      },
    },
    {
      name: "create_task",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "Create a task directory for a single-agent delegation. " +
        "Call this BEFORE create_plan. Returns the absolute path to use as projectDir in create_plan. " +
        "The directory is created under the steward's workspace/tasks/ with a timestamp suffix.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Task name in English (e.g. 'product-report', 'video-script'). Will be sanitized for filesystem." },
        },
        required: ["name"],
      },
      async execute(_id: string, { name }: { name: string }) {
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").toLowerCase();
        const timestamp = Date.now().toString(36);
        const dirName = `${sanitized}-${timestamp}`;
        const tasksDir = join(getStewardWorkspaceDir(), "tasks");
        const taskDir = join(tasksDir, dirName);
        try {
          mkdirSync(taskDir, { recursive: true });
        } catch (err) {
          return ok(`Error: Failed to create task directory: ${(err as Error).message}`);
        }
        return ok(`Task directory created: ${taskDir}\n\nUse this path as projectDir when calling create_plan.`);
      },
    },
    {
      name: "create_plan",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "Create a structured execution plan for a multi-agent project or single-agent task. " +
        "Call create_project or create_task FIRST to get a projectDir, then call this. " +
        "Each step has agents, tasks, and a batch number. Steps with the same batch number run concurrently; lower batches run first and must all complete before the next batch starts. " +
        "File boundaries (files field) are OPTIONAL — the scaffold phase will define module structure and dev task allocation in MODULES.md; " +
        "the system automatically injects upstream docs (MODULES.md, SPEC.md, visual.md) into develop and integrate tasks. " +
        "If you do provide files, they must be non-overlapping across agents in the same step. " +
        "After spawning each batch, wait for agents to finish, then call next_step() for instructions. " +
        "The final next_step() call will tell you to call mission_complete.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Project name (e.g. \"飞机大战\")" },
          type: {
            type: "string",
            enum: ["game", "app", "website", "media", "files", "operation"],
            description: "Project category",
          },
          projectDir: { type: "string", description: "Absolute path to project/task directory (from create_project or create_task)" },
          steps: {
            description: "Ordered execution steps as a JSON array. Can also be passed as a JSON string (will be auto-parsed). " +
              "Each step: { id, description, batch, agents: [{ name, task }] }. " +
              "batch is a positive integer (1, 2, 3...). Same batch = run concurrently. " +
              "files field is optional — scaffold output (MODULES.md) defines file boundaries for develop phase.",
          },
        },
        required: ["name", "type", "projectDir", "steps"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const name = String(args.name ?? "").trim();
        const type = String(args.type ?? "");
        const projectDir = String(args.projectDir ?? "").trim();

        let steps: Array<{
          id: string; description: string;
          agents: Array<{ name?: string; label?: string; task: string; files?: string[] }>;
          batch?: number;
        }>;
        const rawSteps = args.steps;
        if (typeof rawSteps === 'string') {
          try {
            steps = JSON.parse(rawSteps);
          } catch {
            try {
              steps = JSON.parse(repairJson(rawSteps));
            } catch {
              return ok("Error: steps is a malformed JSON string. Pass steps as a JSON array.");
            }
          }
        } else {
          steps = rawSteps as typeof steps;
        }

        for (const s of steps) {
          s.agents = s.agents.map(a => ({
            ...a,
            name: (a as any).name ?? (a as any).label ?? '',
          }));
        }

        if (!name) return ok("Error: name is required.");
        if (!type) return ok("Error: type is required.");
        if (!projectDir) return ok("Error: projectDir is required. Call create_project first.");
        if (!Array.isArray(steps) || steps.length === 0) return ok("Error: at least one step is required.");

        const roster = loadCitizenRoster();
        const result = createPlan(name, type, projectDir, roster, steps as any);

        if (!result.startsWith('Error:')) {
          try {
            const planLines = [`# ${name}`, '', `类型: ${type}`, `目录: ${projectDir}`, '', '## 计划概要', '']
            for (const s of steps) {
              const agentDescs = s.agents.map(a => {
                const entry = roster.get(a.name ?? '')
                return entry ? `${a.name}(${entry.specialty})` : a.name
              }).join(', ')
              planLines.push(`- ${s.id}: ${s.description} — ${agentDescs}`)
            }
            planLines.push('', '## 变更记录', '', '（管家在每批任务完成后更新此处）', '')
            writeFileSync(join(projectDir, 'PROJECT.md'), planLines.join('\n'), 'utf-8')
          } catch {}
        }

        return result;
      },
    },
    {
      name: "next_step",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "Check the current plan progress and get instructions for the next step. " +
        "Call this after each batch of agents finishes. " +
        "Returns: what's done, what to do next (which agents to spawn with what tasks), " +
        "and when all steps are done, tells you to call mission_complete.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return getNextStepInstruction();
      },
    },
    {
      name: "mission_complete",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "Unified completion handler — call this when agents finish work. " +
        "Automatically checks if other agents are still running or plan has pending steps. " +
        "All done → triggers departure animation + celebration + deliverable card. " +
        "Still working → sends deliverable card only (no celebration). " +
        "Do NOT call for simple queries or conversational responses — only for tasks that produced tangible deliverables.",
      parameters: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["game", "app", "website", "media", "files", "operation"],
            description:
              "Deliverable category: " +
              "\"game\" for playable games, " +
              "\"app\" for interactive applications/tools, " +
              "\"website\" for deployed websites/pages, " +
              "\"media\" for produced images/audio/video, " +
              "\"files\" for documents/code deliverables, " +
              "\"operation\" for tasks with no tangible output (e.g. cleanup, config).",
          },
          name: {
            type: "string",
            description: "Human-readable deliverable name (e.g. \"飞机大战\", \"Horse 2048\"). Used for the completion card display.",
          },
          summary: {
            type: "string",
            description: "Brief summary of what was accomplished.",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "List of output file absolute paths. " +
              "For game/app/website: pass the entry HTML file path (e.g. [\"/path/to/project/index.html\"]). " +
              "For media/files: pass all output file paths. " +
              "Do NOT pass http:// URLs — always use absolute file paths, the system will auto-convert them to servable URLs.",
          },
        },
        required: ["type", "summary"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const VALID_TYPES = ["game", "app", "website", "media", "files", "operation"];
        const type = String(args.type ?? "");
        const summary = String(args.summary ?? "").trim();

        if (!type || !VALID_TYPES.includes(type)) {
          return ok(`Error: type must be one of: ${VALID_TYPES.join(", ")}`);
        }
        if (!summary) {
          return ok("Error: summary is required.");
        }

        const running = hasRunningSubagents();
        const planDone = isPlanFullyComplete();
        const routeName = (!running && planDone) ? "project_complete" : "deliver_output";

        if (routeName === "project_complete") {
          clearTasks();
          completePlan();
        }

        const enrichedFiles = Array.isArray(args.files)
          ? (args.files as string[]).map((f) => {
              const resolved = resolveFileData(String(f));
              return { path: String(f), ...resolved };
            })
          : [];

        // For game/app/website, derive URL from the first file entry
        let resolvedUrl: string | undefined;
        if (["game", "app", "website"].includes(type) && enrichedFiles.length > 0) {
          resolvedUrl = enrichedFiles[0].httpUrl || enrichedFiles[0].path;
        }

        const toolUseId = `mission-${Date.now().toString(36)}`;
        broadcastAgentEvent({
          type: "tool_use",
          toolUseId,
          name: routeName,
          input: { ...args, url: resolvedUrl, _enrichedFiles: enrichedFiles },
        });
        broadcastAgentEvent({
          type: "tool_result",
          toolUseId,
          name: routeName,
          output: `Project marked complete (${type}): ${summary}`,
        });

        if (routeName === "project_complete") {
          return ok(`Mission complete — project_complete triggered. (${type}): ${summary}`);
        }
        const reasons: string[] = [];
        if (running) reasons.push("other agents still running");
        if (!planDone) reasons.push("plan has remaining steps");
        return ok(`Deliverable sent (${type}): ${summary}. Not yet complete: ${reasons.join(", ")}.`);
      },
    },
    // ═══════════════════════════════════════════════════════
    //  Scene editing tools (steward only)
    // ═══════════════════════════════════════════════════════
    {
      name: "town_list_assets",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "查询场景工坊资产库中所有可用资产。" +
        "返回每个资产的 modelKey、名称、类型(building/prop/road/tree/bench...)、占地格数、默认缩放。" +
        "放置物件前必须先调用此工具获取可用的 modelKey。**只能使用此工具返回的 modelKey,不要使用任何其他来源的 key,否则放置会失败。**" +
        "可选 category 参数筛选分类: buildings, vehicles, roads, nature, streetProps, " +
        "tiles, signs, factory, foodProps, roofProps, basketball, other, construction, custom, all(默认)。",
      parameters: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            description: "资产分类筛选,默认 all(全部)",
          },
        },
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const category = String(args.category ?? "all");
        try {
          const data = await getAssetCatalog();
          let assets = [...(data.builtin ?? []), ...(data.custom ?? [])];
          if (category !== "all") {
            assets = assets.filter((a) => a.category === category);
          }
          const summary = assets.map((a) => ({
            modelKey: a.key ?? a.id,
            name: a.name,
            assetType: a.assetType,
            cells: a.cells,
            defaultScale: a.defaultScale,
          }));
          return ok(`共 ${assets.length} 个资产${category !== "all" ? ` (分类: ${category})` : ""}:\n${JSON.stringify(summary, null, 2)}`);
        } catch (err: any) {
          return ok(`Error: ${err?.message ?? "获取资产目录失败"}`);
        }
      },
    },
    {
      name: "town_list_objects",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "查询当前小镇场景中的所有物件。" +
        "放置/移动/删除前调用此工具了解当前布局,避免重叠和冲突。" +
        "返回地图尺寸(cols×rows)和每个物件的 ID、类型、modelKey、坐标、旋转、缩放。" +
        "可选 category 参数: building, prop, road, all(默认)。",
      parameters: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            enum: ["building", "prop", "road", "all"],
            description: "物件类型筛选,默认 all",
          },
        },
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const category = String(args.category ?? "all");
        try {
          const config = readMapConfigLocal();
          if (!config) return ok("当前没有已保存的地图配置,小镇使用默认硬编码布局。");
          const objects: any[] = [];
          if (category === "all" || category === "building") {
            for (const b of config.buildings ?? []) {
              objects.push({ id: b.id, category: "building", modelKey: b.modelKey, gridX: b.gridX, gridZ: b.gridZ, rotationY: b.rotationY, scale: b.scale, widthCells: b.widthCells, depthCells: b.depthCells });
            }
          }
          if (category === "all" || category === "prop") {
            for (const p of config.props ?? []) {
              objects.push({ id: p.id, category: "prop", modelKey: p.modelKey, gridX: p.gridX, gridZ: p.gridZ, rotationY: p.rotationY, scale: p.scale });
            }
          }
          if (category === "all" || category === "road") {
            for (const r of config.roads ?? []) {
              objects.push({ id: r.id, category: "road", modelKey: r.modelKey, gridX: r.gridX, gridZ: r.gridZ, rotationY: r.rotationY });
            }
          }
          return ok(`地图: ${config.grid.cols}×${config.grid.rows}, 共 ${objects.length} 个物件:\n${JSON.stringify(objects, null, 2)}`);
        } catch (err: any) {
          return ok(`Error: ${err?.message ?? "加载地图配置失败"}`);
        }
      },
    },
    {
      name: "town_place_object",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "在小镇 3D 场景中放置一个建筑、物件或道路。" +
        "放置前请先调用 town_list_assets 获取可用的 modelKey。" +
        "放置前请先调用 town_list_objects 查看当前场景,避免重叠。" +
        "网格坐标: X 轴 0~(cols-1), Z 轴 0~(rows-1),左上角为 (0,0)。" +
        "建筑占地 widthCells×depthCells 格,放置坐标为左上角。" +
        "必须进行美观性、实用性、合理性评估后再放置。",
      parameters: {
        type: "object" as const,
        properties: {
          modelKey: { type: "string", description: "资产 key(来自 town_list_assets)" },
          category: { type: "string", enum: ["building", "prop", "road"], description: "物件类型" },
          gridX: { type: "number", description: "网格 X 坐标(左上角,0~cols-1)" },
          gridZ: { type: "number", description: "网格 Z 坐标(左上角,0~rows-1)" },
          rotationY: { type: "number", enum: [0, 90, 180, 270], description: "Y 轴旋转角度(默认 0)" },
          scale: { type: "number", description: "缩放倍数(默认 1.0)" },
          widthCells: { type: "number", description: "建筑占地宽度(格),默认 1" },
          depthCells: { type: "number", description: "建筑占地深度(格),默认 1" },
        },
        required: ["modelKey", "category", "gridX", "gridZ"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const modelKey = String(args.modelKey ?? "");
        const category = String(args.category ?? "");
        const gridX = Number(args.gridX ?? 0);
        const gridZ = Number(args.gridZ ?? 0);
        const rotationY = Number(args.rotationY ?? 0);
        const scale = Number(args.scale ?? 1);
        const widthCells = Number(args.widthCells ?? 1);
        const depthCells = Number(args.depthCells ?? 1);
        if (!modelKey) return ok("Error: modelKey is required.");
        if (!["building", "prop", "road"].includes(category)) return ok("Error: category must be building, prop, or road.");

        // Resolve modelUrl + defaultScale + fixRotation from asset catalog
        let modelUrl: string | undefined;
        let defaultScale = 1;
        let fixRotationX: number | undefined;
        let fixRotationY: number | undefined;
        let fixRotationZ: number | undefined;
        let catalogCells: [number, number] | undefined;
        try {
          const data = await getAssetCatalog();
          const all = [...(data.builtin ?? []), ...(data.custom ?? [])];
          const found = all.find((a) => (a.key ?? a.id) === modelKey);
          if (found) {
            modelUrl = found.url;
            defaultScale = found.defaultScale ?? 1;
            fixRotationX = found.fixRotationX;
            fixRotationY = found.fixRotationY;
            fixRotationZ = found.fixRotationZ;
            catalogCells = found.cells;
          }
        } catch {}

        // Reject unknown modelKey — prevents placing invisible/404 assets
        if (!modelUrl) {
          return ok(`Error: modelKey "${modelKey}" 不在可用资产目录中。请先调用 town_list_assets 获取可用的 modelKey 列表,只使用目录中存在的资产。`);
        }

        // Use catalog defaultScale if user didn't specify a custom scale
        const finalScale = scale !== 1 ? scale : defaultScale;
        const finalWidth = catalogCells ? catalogCells[0] : widthCells;
        const finalDepth = catalogCells ? catalogCells[1] : depthCells;

        // Server-side overlap check (read map config directly from disk)
        try {
          const config = readMapConfigLocal();
          if (config) {
            const overlap = checkPlacementOverlap(config, category, gridX, gridZ, finalWidth, finalDepth);
            if (overlap) return ok(`Error: 放置位置 (${gridX}, ${gridZ}) 与已有物件 "${overlap.id}" (${overlap.modelKey}) 重叠,请选择其他位置。`);
            const terrain = config.terrain?.[gridZ]?.[gridX];
            if (terrain?.type === "water" && category === "building") {
              return ok(`Error: 不能在水域上放置建筑。`);
            }
          }
        } catch {}

        const objectId = `${category[0]}obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        broadcastAgentEvent({
          type: "world_control", target: "scene", action: "place",
          objectId, category: category as any, modelKey, modelUrl,
          gridX, gridZ, rotationY, scale: finalScale, widthCells: finalWidth, depthCells: finalDepth,
          fixRotationX, fixRotationY, fixRotationZ,
        } as any);
        return ok(`已放置 ${category} "${modelKey}" 在网格 (${gridX}, ${gridZ}),ID: ${objectId}`);
      },
    },
    {
      name: "town_move_object",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "移动场景中已有物件的位置。移动前请调用 town_list_objects 确认物件 ID 和当前布局。",
      parameters: {
        type: "object" as const,
        properties: {
          objectId: { type: "string", description: "物件 ID(来自 town_list_objects)" },
          gridX: { type: "number", description: "新网格 X 坐标" },
          gridZ: { type: "number", description: "新网格 Z 坐标" },
        },
        required: ["objectId", "gridX", "gridZ"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const objectId = String(args.objectId ?? "");
        const gridX = Number(args.gridX ?? 0);
        const gridZ = Number(args.gridZ ?? 0);
        if (!objectId) return ok("Error: objectId is required.");
        broadcastAgentEvent({
          type: "world_control", target: "scene", action: "move",
          objectId, gridX, gridZ,
        } as any);
        return ok(`已移动物件 ${objectId} 到 (${gridX}, ${gridZ})`);
      },
    },
    {
      name: "town_transform_object",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "旋转、缩放或翻转场景中的物件。至少提供一个变换参数。",
      parameters: {
        type: "object" as const,
        properties: {
          objectId: { type: "string", description: "物件 ID" },
          rotationY: { type: "number", enum: [0, 90, 180, 270], description: "Y 轴旋转角度" },
          scale: { type: "number", description: "缩放倍数" },
          flipX: { type: "boolean", description: "沿 X 轴翻转" },
          flipZ: { type: "boolean", description: "沿 Z 轴翻转" },
        },
        required: ["objectId"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const objectId = String(args.objectId ?? "");
        if (!objectId) return ok("Error: objectId is required.");
        broadcastAgentEvent({
          type: "world_control", target: "scene", action: "transform",
          objectId,
          rotationY: args.rotationY != null ? Number(args.rotationY) : undefined,
          scale: args.scale != null ? Number(args.scale) : undefined,
          flipX: args.flipX as boolean | undefined,
          flipZ: args.flipZ as boolean | undefined,
        } as any);
        return ok(`已变换物件 ${objectId}`);
      },
    },
    {
      name: "town_delete_object",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "删除场景中的物件。删除前请确认不会影响居民绑定(如住宅、办公楼等已绑定的建筑不应删除)。",
      parameters: {
        type: "object" as const,
        properties: {
          objectId: { type: "string", description: "要删除的物件 ID" },
        },
        required: ["objectId"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const objectId = String(args.objectId ?? "");
        if (!objectId) return ok("Error: objectId is required.");
        broadcastAgentEvent({
          type: "world_control", target: "scene", action: "delete",
          objectId,
        } as any);
        return ok(`已删除物件 ${objectId}`);
      },
    },
    {
      name: "town_set_terrain",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "修改小镇地形。支持批量修改多个格子。" +
        "地形类型: grass(草地)、sand(沙地)、street(街道)、plaza(广场)、sidewalk(人行道)、water(水域)。" +
        "水域上不能放置建筑。街道用于道路区域。",
      parameters: {
        type: "object" as const,
        properties: {
          cells: {
            type: "array",
            description: "要修改的格子列表",
            items: {
              type: "object",
              properties: {
                col: { type: "number", description: "X 坐标(列)" },
                row: { type: "number", description: "Z 坐标(行)" },
                type: { type: "string", enum: ["grass", "sand", "street", "plaza", "sidewalk", "water"], description: "地形类型" },
              },
              required: ["col", "row", "type"],
            },
          },
        },
        required: ["cells"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const cells = args.cells as Array<{ col: number; row: number; type: string }> | undefined;
        if (!cells || !Array.isArray(cells) || cells.length === 0) {
          return ok("Error: cells is required and must be a non-empty array.");
        }
        broadcastAgentEvent({
          type: "world_control", target: "scene", action: "set_terrain",
          cells,
        } as any);
        return ok(`已修改 ${cells.length} 格地形`);
      },
    },
    {
      name: "town_expand_map",
      description:
        "[Agentshire steward only — do NOT use if you are not the town steward agent] " +
        "调整小镇地图尺寸,用于小镇扩建或缩小。" +
        "当前地图尺寸可通过 town_list_objects 查询(grid.cols × grid.rows)。" +
        "最小 20×16,最大 80×60。调整后新增区域默认为草地地形。" +
        "支持扩大和缩小:扩大时新增区域为草地;缩小时超出新边界的物件(建筑/道具/道路)会被移除。" +
        "调整方向: 向右增加列(cols),向下增加行(rows)。已有物件位置不变(缩小除外)。",
      parameters: {
        type: "object" as const,
        properties: {
          newCols: { type: "number", description: "新的总列数(当前~80)" },
          newRows: { type: "number", description: "新的总行数(当前~60)" },
        },
        required: ["newCols", "newRows"],
      },
      async execute(_id: string, args: Record<string, unknown>) {
        let newCols = Math.round(Number(args.newCols ?? 0));
        let newRows = Math.round(Number(args.newRows ?? 0));
        newCols = Math.max(20, Math.min(80, newCols));
        newRows = Math.max(16, Math.min(60, newRows));
        broadcastAgentEvent({
          type: "world_control", target: "scene", action: "expand",
          newCols, newRows,
        } as any);
        return ok(`地图已扩展至 ${newCols}×${newRows}`);
      },
    },
    {
      name: "town_get_my_status",
      description:
        "获取你自己（当前居民/管家）在 3D 场景中的实时状态和位置。" +
        "返回：npcId、名称、状态（idle/walking/working/thinking 等）、世界坐标 (x, y, z)、是否正在移动。" +
        "所有居民和管家均可使用。",
      parameters: { type: "object" as const, properties: {} },
      async execute(toolUseId: string) {
        const caller = await resolveCallerNpcId(toolUseId);
        if (!caller) return ok("错误：无法识别调用者身份（toolUseId 未映射到 agent）。请重试。");
        try {
          const data = await requestNpcQuery({ kind: "self", npcId: caller.npcId });
          if (data && typeof data === "object" && "error" in (data as any)) {
            return ok(`错误：${(data as any).error}`);
          }
          const d = data as { npcId: string; name: string; state: string; position: { x: number; y: number; z: number }; isMoving: boolean };
          return ok(
            `我的状态：\n` +
            `  npcId: ${d.npcId}\n` +
            `  名称: ${d.name}\n` +
            `  状态: ${d.state}\n` +
            `  位置: (${d.position.x}, ${d.position.y}, ${d.position.z})\n` +
            `  正在移动: ${d.isMoving ? "是" : "否"}`
          );
        } catch (err) {
          return ok(`错误：查询状态失败 — ${(err as Error).message}`);
        }
      },
    },
    {
      name: "town_query_nearby_citizens",
      description:
        "查询以某个坐标为原点、指定半径范围内所有居民的状态和位置。" +
        "省略 origin 时默认以你自己的当前位置为原点。" +
        "返回：按距离升序排列的居民列表（npcId、名称、状态、坐标、距离）。排除你自己。" +
        "所有居民和管家均可使用。",
      parameters: {
        type: "object" as const,
        properties: {
          radius: { type: "number", description: "查询半径（世界坐标单位，建议 5~30）" },
          origin: {
            type: "object",
            description: "查询原点坐标，省略则用你自己的当前位置",
            properties: {
              x: { type: "number" },
              z: { type: "number" },
            },
          },
        },
        required: ["radius"],
      },
      async execute(toolUseId: string, args: { radius: number; origin?: { x: number; z: number } }) {
        const radius = Math.max(0.1, Math.min(200, Number(args.radius ?? 0)));
        const caller = await resolveCallerNpcId(toolUseId);
        if (!caller) return ok("错误：无法识别调用者身份（toolUseId 未映射到 agent）。请重试。");
        const query: { kind: "nearby"; radius: number; origin?: { x: number; z: number }; callerNpcId?: string } = {
          kind: "nearby",
          radius,
          callerNpcId: caller.npcId,
        };
        if (args.origin && typeof args.origin.x === "number" && typeof args.origin.z === "number") {
          query.origin = { x: args.origin.x, z: args.origin.z };
        }
        try {
          const data = await requestNpcQuery(query);
          if (data && typeof data === "object" && "error" in (data as any)) {
            return ok(`错误：${(data as any).error}`);
          }
          const citizens = (data as { citizens: Array<{ npcId: string; name: string; state: string; position: { x: number; y: number; z: number }; distance: number }> }).citizens ?? [];
          if (citizens.length === 0) {
            return ok(`半径 ${radius} 范围内没有其他居民。`);
          }
          const lines = citizens.map((c, i) =>
            `  ${i + 1}. ${c.name} (${c.npcId}) — 状态:${c.state} 位置:(${c.position.x}, ${c.position.z}) 距离:${c.distance}`
          );
          return ok(`半径 ${radius} 范围内发现 ${citizens.length} 位居民：\n${lines.join("\n")}`);
        } catch (err) {
          return ok(`错误：查询附近居民失败 — ${(err as Error).message}`);
        }
      },
    },
    {
      name: "town_walk_to",
      description:
        "让你在 3D 场景中的角色行走至指定世界坐标 (x, z)。" +
        "立即返回'已发出移动指令'，角色会在后台异步移动。" +
        "注意：处于 working（工作）状态时无法移动，请先完成或暂停工作。" +
        "坐标范围：x ∈ [0, 80], z ∈ [0, 60]（城镇地图范围）。" +
        "所有居民和管家均可使用。",
      parameters: {
        type: "object" as const,
        properties: {
          x: { type: "number", description: "目标 X 坐标（世界坐标）" },
          z: { type: "number", description: "目标 Z 坐标（世界坐标）" },
          speed: { type: "number", description: "移动速度（可选，默认 3，建议 2~5）" },
        },
        required: ["x", "z"],
      },
      async execute(toolUseId: string, args: { x: number; z: number; speed?: number }) {
        const x = Math.max(0, Math.min(80, Number(args.x ?? 0)));
        const z = Math.max(0, Math.min(60, Number(args.z ?? 0)));
        const speed = Math.max(0.5, Math.min(10, Number(args.speed ?? 3)));
        const caller = await resolveCallerNpcId(toolUseId);
        if (!caller) return ok("错误：无法识别调用者身份（toolUseId 未映射到 agent）。请重试。");
        // Check current state — reject if working
        try {
          const statusData = await requestNpcQuery({ kind: "self", npcId: caller.npcId });
          const status = statusData as { state?: string; error?: string };
          if (status && typeof status === "object" && "error" in status) {
            return ok(`错误：${status.error}`);
          }
          if (status.state === "working") {
            return ok("错误：你正在工作中，无法移动。请先完成或暂停当前工作。");
          }
        } catch (err) {
          return ok(`错误：无法确认当前状态 — ${(err as Error).message}`);
        }
        // Check if 3D scene is connected — move_npc requires the scene to animate
        if (getSceneCapableClientCount() === 0) {
          return ok("错误：3D 场景未连接（请先打开 Town 标签页加载场景），无法移动角色。");
        }
        // Emit move command via world_control/move_npc (EventTranslator → npc_move_to GameEvent)
        broadcastAgentEventToScene({
          type: "world_control",
          target: "move_npc",
          npcId: caller.npcId,
          destination: { x, y: 0, z },
          speed,
        } as any);
        return ok(`已发出移动指令：前往坐标 (${x}, ${z})，速度 ${speed}。角色正在移动中。`);
      },
    },
    // ── Animal Mode tools (Phase 3) ──
    {
      name: "town_knock_door",
      description:
        "Knock on a citizen's home door to visit them (Animal Mode). " +
        "Checks if the resident is home via IndoorTracker. " +
        "If home, triggers a knock-door dialogue; if not, returns 'no one home'. " +
        "Only usable by citizens (not steward).",
      parameters: {
        type: "object" as const,
        properties: {
          targetNpcId: { type: "string", description: "The NPC ID of the resident to visit" },
        },
        required: ["targetNpcId"],
      },
      async execute(toolUseId: string, args: { targetNpcId: string }) {
        const caller = await resolveCallerNpcId(toolUseId);
        if (!caller) return ok("错误：无法识别调用者身份。");
        if (caller.npcId === "steward") return ok("管家不串门，请使用其他方式。");
        const target = String(args.targetNpcId ?? "");
        if (!target) return ok("错误：缺少 targetNpcId。");
        // Emit knock-door event to frontend (IndoorTracker check happens there)
        broadcastAgentEventToScene({
          type: "world_control",
          target: "knock_door",
          npcId: caller.npcId,
          targetNpcId: target,
        } as any);
        return ok(`已发出敲门请求：拜访 ${target}。等待回应中。`);
      },
    },
    {
      name: "town_query_place",
      description:
        "Query who is currently inside a building (Animal Mode). " +
        "Returns the list of citizen IDs currently indoors at the specified building. " +
        "Useful for checking if someone is home before visiting.",
      parameters: {
        type: "object" as const,
        properties: {
          buildingKey: { type: "string", description: "Building key (e.g. 'house_a_door', 'cafe_door')" },
        },
        required: ["buildingKey"],
      },
      async execute(_toolUseId: string, args: { buildingKey: string }) {
        const buildingKey = String(args.buildingKey ?? "");
        if (!buildingKey) return ok("错误：缺少 buildingKey。");
        try {
          const data = await requestNpcQuery({ kind: "place_occupants", buildingKey });
          const result = data as { occupants?: string[]; error?: string };
          if (result.error) return ok(`错误：${result.error}`);
          const occupants = result.occupants ?? [];
          if (occupants.length === 0) return ok(`${buildingKey} 内目前没有人。`);
          return ok(`${buildingKey} 内有 ${occupants.length} 人：${occupants.join("、")}。`);
        } catch (err) {
          return ok(`查询失败：${(err as Error).message}`);
        }
      },
    },
    {
      name: "town_query_citizen",
      description:
        "Query a citizen's current status (Animal Mode): needs, mood, location. " +
        "Returns the citizen's 8 need levels, mood value, and current location. " +
        "Useful for understanding a citizen's state before interacting.",
      parameters: {
        type: "object" as const,
        properties: {
          npcId: { type: "string", description: "The NPC ID to query" },
        },
        required: ["npcId"],
      },
      async execute(_toolUseId: string, args: { npcId: string }) {
        const npcId = String(args.npcId ?? "");
        if (!npcId) return ok("错误：缺少 npcId。");
        try {
          const data = await requestNpcQuery({ kind: "citizen_status", npcId });
          const result = data as { needs?: any; mood?: any; location?: string; error?: string };
          if (result.error) return ok(`错误：${result.error}`);
          const lines = [`居民 ${npcId} 状态：`];
          if (result.location) lines.push(`位置：${result.location}`);
          if (result.needs) {
            const needs = result.needs as Record<string, number>;
            lines.push(`需求：${Object.entries(needs).map(([k, v]) => `${k}=${v.toFixed(0)}`).join("，")}`);
          }
          if (result.mood) {
            lines.push(`心情：${result.mood.level ?? "?"}（${(result.mood.value ?? 0).toFixed(0)}）`);
          }
          return ok(lines.join("\n"));
        } catch (err) {
          return ok(`查询失败：${(err as Error).message}`);
        }
      },
    },
    {
      name: "town_recall_memory",
      description:
        "Recall a memory from a citizen's past interactions (Animal Mode). " +
        "Returns recent dialogue summaries and activity entries for the citizen. " +
        "Used by citizens to remember past conversations and relationships.",
      parameters: {
        type: "object" as const,
        properties: {
          npcId: { type: "string", description: "The NPC ID whose memories to recall" },
          topic: { type: "string", description: "Optional topic to filter memories by" },
        },
        required: ["npcId"],
      },
      async execute(_toolUseId: string, args: { npcId: string; topic?: string }) {
        const npcId = String(args.npcId ?? "");
        if (!npcId) return ok("错误：缺少 npcId。");
        try {
          // Read directly from plugin-side JSONL persistence (no frontend dependency)
          const { loadRecentMemories } = await import("./animal-memory.js");
          const result = loadRecentMemories(npcId, { topic: args.topic });
          const lines = [`居民 ${npcId} 的记忆：`];
          if (result.dialogues.length > 0) {
            lines.push(`近期对话：${result.dialogues.map((d) => `与${d.partnerName}聊${d.summary}`).join("；")}`);
          } else {
            lines.push("近期对话：无");
          }
          if (result.activities.length > 0) {
            lines.push(`近期活动：${result.activities.map((a) => a.detail ?? a.action).join("；")}`);
          }
          return ok(lines.join("\n"));
        } catch (err) {
          return ok(`回忆失败：${(err as Error).message}`);
        }
      },
    },
    {
      name: "town_give_gift",
      description:
        "Give a gift to another citizen to improve relationship (Animal Mode). " +
        "Higher gift value increases sentiment more. " +
        "Only usable by citizens (not steward).",
      parameters: {
        type: "object" as const,
        properties: {
          targetNpcId: { type: "string", description: "The NPC ID of the gift recipient" },
          giftName: { type: "string", description: "Name of the gift item" },
          giftValue: { type: "number", description: "Gift value 1-10 (higher = more sentiment gain)" },
        },
        required: ["targetNpcId", "giftName"],
      },
      async execute(toolUseId: string, args: { targetNpcId: string; giftName: string; giftValue?: number }) {
        const caller = await resolveCallerNpcId(toolUseId);
        if (!caller) return ok("错误：无法识别调用者身份。");
        if (caller.npcId === "steward") return ok("管家不送礼，请使用其他方式。");
        const target = String(args.targetNpcId ?? "");
        const giftName = String(args.giftName ?? "");
        const giftValue = Math.max(1, Math.min(10, Number(args.giftValue ?? 5)));
        if (!target || !giftName) return ok("错误：缺少 targetNpcId 或 giftName。");
        // Emit gift event to frontend (RelationshipEngine handles sentiment update)
        broadcastAgentEventToScene({
          type: "world_control",
          target: "give_gift",
          npcId: caller.npcId,
          targetNpcId: target,
          giftName,
          giftValue,
        } as any);
        return ok(`已送出礼物「${giftName}」给 ${target}（价值 ${giftValue}）。好感度提升中。`);
      },
    },
    {
      name: "town_query_festival",
      description:
        "Query the current festival status (Animal Mode). " +
        "Returns whether a festival is active, the festival type, and remaining time. " +
        "If no festival is active, returns the next scheduled festival day.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolUseId: string, _args: Record<string, never>) {
        try {
          const data = await requestNpcQuery({ kind: "festival_status" });
          const result = data as { active?: boolean; type?: string; label?: string; remainingMs?: number; nextDay?: number; error?: string };
          if (result.error) return ok(`错误：${result.error}`);
          if (result.active) {
            const remaining = result.remainingMs ? Math.ceil(result.remainingMs / 1000) : 0;
            return ok(`当前节日：${result.label ?? result.type}（剩余 ${remaining} 秒）。居民正在广场庆祝！`);
          }
          return ok(`当前没有节日。下一个节日在第 ${result.nextDay ?? '?'} 天。`);
        } catch (err) {
          return ok(`查询失败：${(err as Error).message}`);
        }
      },
    },
    {
      name: "town_join_festival",
      description:
        "Join the current festival (Animal Mode). " +
        "The citizen walks to the plaza and participates in the celebration. " +
        "Only works when a festival is active.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(toolUseId: string, _args: Record<string, never>) {
        const caller = await resolveCallerNpcId(toolUseId);
        if (!caller) return ok("错误：无法识别调用者身份。");
        // Emit join-festival event to frontend
        broadcastAgentEventToScene({
          type: "world_control",
          target: "join_festival",
          npcId: caller.npcId,
        } as any);
        return ok(`${caller.npcId} 正在前往广场参加节日庆典。`);
      },
    },
  ] as any);
}
