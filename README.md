# Agentshire

English | [中文](README.zh-CN.md)

> **Agentshire — Let your OpenClaw/QClaw agents live in a game town you built yourself， not a ChatBox.**

Agentshire is an OpenClaw/QClaw plugin that turns AI agents into living NPCs inside a 3D town you can watch, chat with, and shape yourself. It combines a living simulation layer with UGC tools: weather, day/night cycles, social NPCs, a map editor, and a character workshop.

**Works with both OpenClaw CLI and [QClaw](https://qclaw.cn) desktop app.**

**[Vision](VISION.md)** | **[Roadmap](ROADMAP.md)**

> **Compatibility**
>
> | Platform | Version | Status |
> |---|---|---|
> | **OpenClaw CLI** | 2026.3.13 | ✅ Recommended |
> | **OpenClaw CLI** | 2026.6.11+ | ✅ Supported (migrated to `defineChannelPluginEntry`) |
> | **QClaw Desktop** | 0.2.x | ✅ Supported |
> | OpenClaw CLI | 2026.3.7 – 3.12 | ⚠️ May work |
> | OpenClaw CLI | 2026.4.x – 2026.6.10 | ❌ Channel init regression (fixed by migration) |
>
> See [Troubleshooting](#troubleshooting) for version-specific issues.

---

## See It in Action

> **📺 [Watch the full demo on YouTube](https://www.youtube.com/watch?v=R6YXvkkwo9I)**

**A town, not a chatbox.**

https://github.com/user-attachments/assets/c888d2ef-dcba-4caa-b0af-9b5f3e3b1365

**Build your characters — pick a model, give them a soul, watch them come alive.**

https://github.com/user-attachments/assets/b9697432-b3ba-4e23-85fe-4c0b5c35a1b9

**Build your town — drag, drop, preview.**

https://github.com/user-attachments/assets/3328aa6c-3432-4f71-abfd-91aea4db15df

**Every citizen has a mind of their own.**

https://github.com/user-attachments/assets/720a63fc-863c-483c-bfdf-5e07e82c6f0e

**Give them a mission. Watch them rally.**

https://github.com/user-attachments/assets/1983f60b-aaf6-4adc-b46c-5612e4ba4c83

**Work too long? Banwei Boss appears. Pop it.**

https://github.com/user-attachments/assets/9be946e0-9ecf-42de-b793-a5d7ebe55612

**Mission complete. Fireworks. Playable game delivered.**

https://github.com/user-attachments/assets/fa6563ae-e78b-49b1-ae7b-8a8a96738341

---

## Features

### Tri-Mode Interface

- **Town Mode** — Low-poly 3D town where you watch NPCs live, work, collaborate, and celebrate in real time
- **Chat Mode** — IM-style chat interface with an agent list (steward + citizens, online status), message history, multimodal support (text/image), commands (`/new` `/help` `/stop` `/clear`), group chat with @mention, and clear-session with confirmation
- **Claw Settings** — In-app panel for OpenClaw runtime config (gateway mode, subagent timeout, logging, browser, update channel) and live session/token-usage inspection; embeds the LLM Model Manager as a sub-section
- **Top Navigation** — One-click switch between Town / Chat / Claw, with a quick menu (Citizen Workshop / Town Editor / Skill Store / Settings)
- **Bilingual UI** — Full Chinese and English interface, auto-detected or manually switchable

### Core

- **Agent = NPC** — Every sub-agent automatically becomes a 3D citizen with a name, appearance, and personality
- **Cinematic Workflow** — Summon → Rally → Assign → Enter Office → Code → Celebrate → Return to Town, fully choreographed with animations
- **Real-Time Dialog Bubbles** — AI responses appear above NPC heads with a typewriter effect, streaming updates, and pagination
- **Multi-Agent Collaboration** — The steward automatically decomposes tasks into parallel steps with file boundary validation
- **Zero Configuration** — Install the plugin, start the Gateway, and the town runs automatically

### Town Life

- **Day/Night Cycle** — 24-hour clock (6 periods), real-time lighting changes, automatic street/window lights
- **12 Weather Types** — Clear / cloudy / fog / drizzle / rain / storm / snow / blizzard / sandstorm / aurora… daily random theme with smooth transitions
- **Procedural Ambient Sound** — Rain, wind, birdsong, crickets, traffic, thunder — all synthesized in real time via Web Audio API, zero audio files
- **4-Track BGM** — Day / dusk / night / work tracks, auto-switching by weather, time period, and scene with 3.5s crossfade
- **NPC Daily Behavior (Dual Mode)** — Algorithm-driven by default: state machine + 5 behavior templates + 400+ preset dialog lines, zero LLM cost. Enable Soul Mode to switch to AI-driven: AgentBrain 3-tier decisions (L1 daily plan / L2 tactical / L3 dialogue) + deep multi-turn LLM conversations + relationship graph + daily narrative summaries
- **Citizen Chat** — Click any citizen NPC to start a conversation, routed to that citizen's independent Agent session
- **Group Chat** — Multi-citizen group conversations with @mention picker, per-citizen role display, JSONL history persistence, and context token budget tracking
- **Topic Discussion** — Start a group discussion with multiple citizens on a topic, with structured turn-taking and AI-moderated dialogue
- **Banwei Buster Mini-Game** — NPCs generate "banwei orbs" while working; click to pop them! Includes combo system, boss battles, and NPC stress mechanics

### UGC Tools

- **Citizen Workshop** — Create and configure citizen characters: select/upload 3D models, edit soul personality (AI generation supported), configure animation mapping (8 slots), assign per-agent LLM model (empty = inherit global default), publish as independent Agents
- **Town Editor** — Visual drag-and-drop map editing: place buildings/roads/props/lights, with grouping, alignment, undo, and JSON export (runtime integration in progress)
- **AI Town Editing** — The steward can edit the town through natural language via 7 new tools: list assets/objects, place/move/transform/delete objects, set terrain, and expand the map — all reflected live in the 3D scene
- **Editor Preview** — One-click game-level preview window (WASD controls + full day/night + weather + vehicle animations + audio)
- **LLM Model Manager** — Manage `openclaw.json` providers/models CRUD (add/update/delete, import/export, undo/redo) directly inside the Claw Settings panel — no separate page needed
- **Soul System** — Each NPC has a Markdown personality file defining character traits, speaking style, expertise, and work approach

### Interaction & Visuals

- **Interactive 3D** — Click NPCs to view status cards (avatar / persona / work logs / thinking stream / TODO), drag to pan, scroll to zoom
- **3 Scene Types** — Town (daily life) / Office (work) / Showroom (in development), with fade transitions and NPC migration
- **Rich VFX** — Summon shockwave, completion fireworks, error lightning, persona-transform magic circle, thinking halo, search radar, confetti…
- **10-Workstation Office** — Each workstation has its own monitor (real-time code animation), full NPC enter/work/leave choreography
- **Deliverable Preview** — After project completion, deliverable cards pop up with image lightbox, video, audio preview and download; games/websites launch directly in iframe
- **AI Tool Control** — Agents can control the town via tools (broadcast messages, spawn NPCs, trigger effects, set time/weather, and now edit the map: place/move/transform/delete objects, set terrain, expand map)
- **Token Usage Tracking** — Per-turn token usage with cache read/write breakdown and compaction count; heuristic fallback estimation when the LLM API returns zero usage
- **Reconnection** — WebSocket auto-reconnect with exponential backoff and work state recovery

---

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) **2026.3.13** (recommended)
- Node.js >= 18

---

## Quick Install

### OpenClaw CLI

```bash
openclaw plugins install agentshire
```

### QClaw Desktop

Clone into the QClaw **extensions** directory (where built-in plugins like `qclaw-plugin`, `lossless-claw` are located — **not** `~/.qclaw/plugins/`), install dependencies, then restart QClaw:

```bash
# Find the extensions directory (contains qclaw-plugin, lossless-claw, etc.)
ls ~/Library/Application\ Support/QClaw/openclaw/config/extensions/  # macOS
# Clone and install
cd <extensions-directory>
git clone https://github.com/Agentshire/Agentshire.git agentshire
cd agentshire && npm install
```

The town opens automatically at `http://localhost:20009` after restarting QClaw.

> The frontend comes **pre-built** (`town-frontend/dist/`). No build step needed.

### Alternative: Link Install (for development)

```bash
git clone https://github.com/Agentshire/Agentshire.git
cd Agentshire && npm install
openclaw plugins install --link .
```

### What the plugin auto-configures on first start

1. Creates the steward workspace (`workspace-town-steward/` in your state directory)
2. Registers the `town-steward` Agent in `openclaw.json`
3. Adds a routing rule to direct town channel messages to the steward
4. Sets `subagents.runTimeoutSeconds: 600` — 10-minute timeout to prevent premature subagent termination

> The state directory is auto-detected: `~/.openclaw/` for OpenClaw CLI, `~/.qclaw/` for QClaw.

> **Important**: Do **not** add a `tools` section to `openclaw.json`. The plugin registers its own tools via `api.registerTool()`. A manual `tools.allow` list will override plugin-registered tools, making them invisible to the agent.

### Update

```bash
openclaw plugins install agentshire
```

Or for link installs: `cd Agentshire && git pull && npm install`.

Then restart the Gateway (or restart QClaw).

---

## Usage

1. Complete the [Quick Install](#quick-install) steps
2. Start (or restart) the OpenClaw Gateway:
   ```bash
   openclaw gateway
   ```
3. The town opens automatically in your browser
4. Chat in the browser — all Agent activity is automatically mapped to the town

> **Tip**: If the browser didn't open automatically, visit:
> `http://localhost:20009?ws=ws://localhost:20008`


### Citizen Workshop

Visit `http://localhost:20009/citizen-editor.html` to create and configure your NPC team.


### Town Editor

Visit `http://localhost:20009/editor.html` to open the visual map editor.


### LLM Model Manager

Open the **Claw** tab in the top navigation (or visit `http://localhost:20009/#claw`) and switch to the **Models** section to manage LLM providers and models in `openclaw.json`. The model manager is now a first-class React panel embedded in the Claw settings view — no separate page needed.


### Configuration (Optional)

Customize ports and behavior in your `openclaw.json` (`~/.openclaw/openclaw.json` for OpenClaw CLI, `~/.qclaw/openclaw.json` for QClaw):

```json
{
  "plugins": {
    "entries": {
      "agentshire": {
        "enabled": true,
        "config": {
          "wsPort": 20008,
          "townPort": 20009,
          "autoLaunch": true
        }
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `wsPort` | 20008 | WebSocket port (real-time plugin ↔ frontend communication) |
| `townPort` | 20009 | HTTP port (frontend static files + editor API) |
| `autoLaunch` | true | Auto-open town in browser on startup |

### AI Tools

| Tool | Description |
|------|-------------|
| `town_announce` | Broadcast a message in the town |
| `town_spawn_npc` | Spawn a new NPC |
| `town_effect` | Trigger visual effects (celebration / fireworks / glow, etc.) |
| `town_set_time` | Control the game clock |
| `town_set_weather` | Control weather (12 types available) |
| `town_status` | View current town status |
| `register_project` | Register a simple project (single-agent or steward-only) |
| `create_project` | Create a project directory for multi-agent work |
| `create_task` | Create a task directory for single-agent delegation |
| `create_plan` | Create a collaboration plan (parallel steps, requires `create_project` or `create_task` first) |
| `next_step` | Query plan progress and get next step instructions |
| `mission_complete` | Unified completion handler — auto-routes to celebration or partial delivery based on remaining work |
| `town_list_assets` | List available 3D assets (buildings / props / roads / characters / pets), filterable by category |
| `town_list_objects` | List objects currently placed in the town map, filterable by type |
| `town_place_object` | Place a new object (building / prop / road) on the grid with rotation, scale, and footprint |
| `town_move_object` | Move an existing object to a new grid cell |
| `town_transform_object` | Transform an object: rotation, scale, flip X/Z |
| `town_delete_object` | Delete an object from the town map |
| `town_set_terrain` | Set terrain type (grass / sand / street / plaza / sidewalk / water) for a list of cells |
| `town_expand_map` | Expand the town map to a larger grid size |

---

## Soul System

Every NPC has an independent **soul file** (Markdown) that defines personality, speaking style, expertise, and work approach.

Format: a Markdown file starting with `# Character Name`, optionally containing metadata (model ID, gender, role), core persona, detailed personality settings, and dialog examples. The content is injected as the Agent's system prompt.

**Search priority** (later overrides earlier):

1. `plugin-builtin/town-souls/` — Preset souls (8 citizens + steward)
2. `cwd/town-souls/` — Project-level souls
3. `{stateDir}/town-souls/` — User custom souls (`~/.openclaw/` or `~/.qclaw/`)
4. `town-data/souls/` — Souls published from Citizen Workshop

You can:
- **AI-generate** soul files in the Citizen Workshop
- Modify built-in soul files to adjust personalities
- Place custom souls in your state directory's `town-souls/` folder to override presets
- Create entirely new soul files for new characters

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      OpenClaw Runtime                    │
│                                                          │
│  Gateway ─── Agent Sessions ─── Hook System ─── LLM      │
└──────┬────────────────────────────┬──────────────────────┘
       │ dispatch                   │ hook callback
       ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│  Plugin Layer (Node.js)                     src/plugin/  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ channel  │  │  hook-   │  │ws-server │  │  tools   │  │
│  │ dispatch │  │translator│  │ WS:20008 │  │ 11 tools │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  plan-   │  │ editor-  │  │ citizen- │  │llm-proxy │  │
│  │ manager  │  │  serve   │  │  router  │  │ 2 concur │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────┬───────────────┬───────────────────────────────────┘
       │ WS :20008     │ HTTP :20009
       │ AgentEvent    │ Editor API
       ▼               ▼
┌──────────────────────────────────────────────────────────┐
│  Bridge Layer (Browser)                     src/bridge/  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ DirectorBridge — Phase State Machine               │  │
│  │ idle→summoning→assigning→office→working→publish→ret│  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Event-  │  │  Route-  │  │ Citizen- │  │implicit- │  │
│  │Transltor │  │ Manager  │  │ Manager  │  │  chat    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────┬────────────────────────────────────────────┬──────┘
       │ GameEvent (65)                 GameAction  │
       ▼                                (14)        ▲
┌──────────────────────────────────────────────────────────┐
│  Frontend Layer (Three.js)          town-frontend/src/   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ MainScene ── EventDispatcher ── update() loop      │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │workflow/ │  │  npc/    │  │   ui/    │  │  audio/  │  │
│  │Choreogr  │  │ NPC 7-SM │  │ChatBubbl │  │ BGM+Amb  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ scene/   │  │ editor/  │  │ engine/  │  │  data/   │  │
│  │Town/Offc │  │Workshop  │  │ Render   │  │ Protocol │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────────────────────────────────────────────────────────┘
```

> Developer architecture guide: [AGENTS.md](AGENTS.md)

---

## Development

```bash
# After cloning
cd agentshire

# Build the town frontend
cd town-frontend && npm install && npm run build

# Dev mode (hot reload)
cd town-frontend && npm run dev

# Run tests
npm test                              # Plugin + bridge layer
cd town-frontend && npx vitest run    # Frontend
```

The frontend has 4 entry pages:

| Page | URL | Description |
|------|-----|-------------|
| Town | `index.html` | 3D town + chat + Claw settings (3 tabs) |
| Town Editor | `editor.html` | Visual map editing |
| Citizen Workshop | `citizen-editor.html` | Character creation and configuration |
| Editor Preview | `preview.html` | Game-level preview window |

> The LLM Model Manager is now embedded in the **Claw** tab of the Town page (`index.html#claw`), no longer a separate page.

> Developer architecture guide: [AGENTS.md](AGENTS.md)

---

## Asset Pack (Optional)

Basic features **require no extra downloads** — built-in models (KayKit + Kenney) for the town, office, and NPCs are included in the repository.

For advanced features, download the optional asset pack:

- **Citizen Workshop Library Characters** (308 character models with multiple variants and colors)
- **Editor Cartoon City Assets** (hundreds of building, vehicle, road, and park models)

### Download

1. Download `agentshire-assets.7z` from [GitHub Releases (v0.1.0)](https://github.com/Agentshire/Agentshire/releases/tag/v0.1.0) (~164MB, expands to ~4.4GB)
2. Extract to the plugin root:
   ```bash
   cd /path/to/agentshire
   7z x agentshire-assets.7z
   ```
3. Verify the directory structure:

```
agentshire/
├── assets/
│   ├── Characters_1/    ← Library character models + shared animations
│   └── Map_1/           ← Cartoon City editor assets
├── src/
├── town-frontend/
└── ...
```

Without the asset pack: the game runs normally, editor has basic assets, and the Citizen Workshop shows only built-in and custom models.

> Asset sources and licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

---

## Troubleshooting

### Plugin tools not recognized by the agent

**Symptom**: Steward agent cannot find `create_project`, `create_plan`, or other plugin tools.

**Cause**: On OpenClaw 2026.3.13, Rollup code-splitting can create separate module instances, causing `api.registerTool()` registrations to be invisible to the agent runtime. Additionally, a manual `tools` section in `openclaw.json` overrides plugin-registered tools.

**Fix**:
1. Remove the entire `tools` section from your `openclaw.json` if present
2. Restart the Gateway

### QClaw: Plugin still runs old code after restart

**Cause**: Closing the QClaw window does not stop the background `openclaw-gateway` process.

**Fix**: Kill the gateway process before restarting QClaw: `ps aux | grep openclaw-gateway | grep -v grep | awk '{print $2}' | xargs kill`

### Channel does not start on OpenClaw 2026.4.x

**Symptom**: Plugin loads successfully but no WebSocket connection is established; the town page shows "connecting…" indefinitely.

**Cause**: OpenClaw 2026.4.x introduced a regression in external plugin channel initialization. The `defineChannelPluginEntry` lifecycle is not correctly invoked for plugins that register channels via the legacy `register(api) { api.registerChannel(...) }` path.

**Fix**: Upgrade Agentshire to a build that registers via `defineChannelPluginEntry` (the entry point now wraps `agentTownPlugin` with `defineChannelPluginEntry` from `openclaw/plugin-sdk/channel-core`). This is compatible with OpenClaw 2026.6.11+. For older OpenClaw 2026.4.x–2026.6.10, downgrade to OpenClaw 2026.3.13.

### Citizen Workshop "AI Generate" returns error 500

**Symptom**: Clicking "AI 生成" in the Citizen Workshop fails.

**Cause**: The soul generation endpoint requires a working LLM provider configured in `openclaw.json`. If no provider is configured or the API key is invalid, the request fails.

**Fix**: Ensure you have a valid `models` section in `~/.openclaw/openclaw.json`. Refer to [OpenClaw documentation](https://github.com/openclaw/openclaw) for LLM provider configuration.

---

## Why "Agentshire"?

The name comes from the Shire in *The Lord of the Rings* — not the epic battles, but the quiet, gentle, unhurried life that makes the Shire feel like home. That's the kind of world we want to build for AI agents.

Many AI products imagine a cyberpunk, high-pressure, hyper-accelerated future. Agents live in dashboards, logs, and APIs — but never in a place that feels like somewhere they actually *live*.

We imagine a different future. A quieter one. A gentler interface. A place where intelligent agents aren't just invoked, driven, and consumed — but can truly settle down.

**If AI agents are going to be part of our lives, they deserve a place that feels like home.**

---

## Vision & Roadmap

> Teams don't live in dashboards. Teams live in a town.  
> When islands connect, towns grow into a world.

| Phase | Direction | Status |
|-------|-----------|--------|
| **A Town** | 3D visualization, workflow orchestration, soul system, citizen workshop, dual-mode UI | ✅ Implemented |
| **A Stable Town** | QClaw + OpenClaw compatibility, bilingual i18n, topic discussions, npm publish | 🔥 Current Focus |
| **A Living Town** | Editor ↔ runtime integration, life simulation (clothing/food/shelter/travel/play), growth systems, mobile | 📋 Next |
| **A World** | Town federation protocol, cross-town NPC visits, skill exchange, world events | 🌍 Long-term |

See **[VISION.md](VISION.md)** and **[ROADMAP.md](ROADMAP.md)** for details.

---

## License

MIT
