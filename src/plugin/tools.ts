import type { OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { broadcastAgentEvent } from "./ws-server.js";
import { createPlan, getNextStepInstruction, getActivePlan, isPlanFullyComplete, hasActiveTasks, clearTasks, completePlan } from "./plan-manager.js";
import type { CitizenRosterEntry } from "./plan-manager.js";
import { hasRunningSubagents } from "./subagent-tracker.js";
import { resolveFileData } from "./outbound-adapter.js";
import { stateDir } from "./paths.js";

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

function getPluginDir(): string {
  return join(fileURLToPath(import.meta.url), "../../..");
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
  return () => [
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
        return `Announced in town: "${message}"`;
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
        return `NPC "${name}" (${npcId}) spawned in town`;
      },
    },
    {
      name: "town_effect",
      description:
        "Trigger a visual effect in the 3D Agentshire (celebration, ripple, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          effect: {
            type: "string",
            enum: ["celebration", "ripple", "fireworks", "glow"],
            description: "Effect type",
          },
        },
        required: ["effect"],
      },
      async execute(_id: string, { effect }: { effect: string }) {
        broadcastAgentEvent({
          type: 'fx',
          effect,
          params: { intensity: 1.0 },
        } as any);
        return `Effect "${effect}" triggered in town`;
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
        if (action === "set") return `Game time set to ${hour}:00`;
        if (action === "pause") return `Game time paused`;
        return `Game time resumed to normal flow`;
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
        if (action === "reset") return `Weather restored to automatic cycle`;
        return `Weather changed to "${weather}"`;
      },
    },
    {
      name: "town_status",
      description: "Get current status of the 3D Agentshire (connected clients, etc.)",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        const { getConnectedClientCount } = await import("./ws-server.js");
        const count = getConnectedClientCount();
        return `Town status: ${count} frontend(s) connected`;
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
        return `Project registered: "${name}" (${type})`;
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
          return `Error: Failed to create project directory: ${(err as Error).message}`;
        }
        return `Project directory created: ${projectDir}\n\nUse this path as projectDir when calling create_plan.`;
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
          return `Error: Failed to create task directory: ${(err as Error).message}`;
        }
        return `Task directory created: ${taskDir}\n\nUse this path as projectDir when calling create_plan.`;
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
              return "Error: steps is a malformed JSON string. Pass steps as a JSON array.";
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

        if (!name) return "Error: name is required.";
        if (!type) return "Error: type is required.";
        if (!projectDir) return "Error: projectDir is required. Call create_project first.";
        if (!Array.isArray(steps) || steps.length === 0) return "Error: at least one step is required.";

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
          return `Error: type must be one of: ${VALID_TYPES.join(", ")}`;
        }
        if (!summary) {
          return "Error: summary is required.";
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
          return `Mission complete — project_complete triggered. (${type}): ${summary}`;
        }
        const reasons: string[] = [];
        if (running) reasons.push("other agents still running");
        if (!planDone) reasons.push("plan has remaining steps");
        return `Deliverable sent (${type}): ${summary}. Not yet complete: ${reasons.join(", ")}.`;
      },
    },
  ];
}
