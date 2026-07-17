# Agentshire Plugin Architecture Guide

> OpenClaw plugin: maps AI Agents as NPCs in a 3D low-poly town.
> This file is for AI assistants and developers. User docs: [README.md](README.md).

## Tech Stack

- **Runtime**: OpenClaw Plugin SDK (Node.js / ESM)
- **Frontend**: Three.js 0.185 + React 19 + vanilla TypeScript 7 (no framework for game core), Vite 8 (Rolldown engine) build, multi-page entries (game / editor / preview / citizen-editor)
- **Protocol**: WebSocket JSON (plugin ↔ frontend), `AgentEvent` / `GameEvent` discriminated unions
- **Audio**: Web Audio API procedural synthesis (zero audio files for ambient) + mp3 BGM
- **Models**: GLTF/GLB, `@gltf-transform` 4.4 optimization
- **Testing**: Vitest 4.1 (root + town-frontend each with independent config)

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            OpenClaw Runtime                              │
│                                                                          │
│   Gateway ─── Agent Sessions ─── Hook System ─── LLM Providers           │
└────────┬──────────────────────────────┬──────────────────────────────────┘
         │ channel.reply                │ 10+ hook callbacks
         ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  Plugin Layer (Node.js)                               src/plugin/        │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   channel    │  │     hook-    │  │   ws-server  │  │    tools     │  │
│  │   inbound    │  │  translator  │  │   WS:20008   │  │  14 AI tools │  │
│  │   dispatch   │  │  Hook→Event  │  │   broadcast  │  │  plan / step │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │     plan-    │  │    editor-   │  │   citizen-   │  │   llm-proxy  │  │
│  │    manager   │  │     serve    │  │  chat-router │  │  2 parallel  │  │
│  │    plan SM   │  │  HTTP:20009  │  │   msg route  │  │  LLM direct  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   subagent-  │  │   outbound-  │  │    session-  │  │  group-chat  │  │
│  │    tracker   │  │    adapter   │  │    history   │  │  +ctx+hist   │  │
│  │  JSONL watch │  │  media→card  │  │  chat reload │  │  per-agent   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                    │
│  │  model-config│  │ llm-agent-   │  │  llm-proxy   │                    │
│  │  providers/  │  │    proxy     │  │  2 parallel  │                    │
│  │  models CRUD │  │  modelRef    │  │  LLM direct  │                    │
│  └──────────────┘  └──────────────┘  └──────────────┘                    │
│                                                                          │
└───────┬───────────────────┬──────────────────────────────────────────────┘
        │                   │
        │  WS :20008        │  HTTP :20009
        │  AgentEvent(26+)  │  Editor API / Static Assets
        ▼                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  Bridge Layer (Browser Bundle)                        src/bridge/        │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────── ──┐  │
│  │                       DirectorBridge                               │  │
│  │                                                                    │  │
│  │   Phase: idle → summoning → assigning → going_to_office            │  │
│  │          → working → publishing → returning ──→ idle               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │    Event-    │  │    Route-    │  │   Citizen-   │  │   implicit-  │  │
│  │  Translator  │  │   Manager    │  │   Manager    │  │     chat     │  │
│  │   fallback   │  │   A* + ack   │  │  spawn seq   │  │  10 scenes   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │    State-    │  │   NpcEvent-  │  │   Activity-  │  │   ToolVfx-   │  │
│  │   Tracker    │  │    Queue     │  │    Stream    │  │    Mapper    │  │
│  │  id↔npc map  │  │  bubble prot │  │  500ms flush │  │  tool→anim   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐                                                        │
│  │  Reconnect-  │                                                        │
│  │   Manager    │                                                        │
│  └──────────────┘                                                        │
│                                                                          │
└───────┬───────────────────────────────────────────────────────┬──────────┘
        │                                                       │
        │  emit GameEvent (65 types)                GameAction  │
        ▼                                           (14 types)  ▲
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  Frontend Layer (Three.js + TypeScript)         town-frontend/src/       │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │   MainScene ── EventDispatcher (65 types) ── update() loop        │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ animal-mode/ │  │     npc/     │  │      ui/     │  │    audio/    │  │
│  │ AnimalModeMgr│  │  NPC 7-state │  │  ChatBubble  │  │   BGM 4-trk  │  │
│  │ AutonomyEng  │  │  CasualEncntr│  │   NpcCard    │  │   Ambient    │  │
│  │ Needs/Mood   │  │  EncounterMgr│  │  MediaView   │  │  WebAudioAPI │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │    scene/    │  │    editor/   │  │    engine/   │  │     data/    │  │
│  │ Town/Office  │  │  TownEditor  │  │    Engine    │  │ GameProtocol │  │
│  │   Museum     │  │   Workshop   │  │  World/Input │  │  TownConfig  │  │
│  │ VehicleMgr   │  │   Preview    │  │    Screen    │  │  CharModels  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                        │
│  │     app/     │  │  platform/   │  │  narrative/  │                        │
│  │ React ChatUI │  │  Bridge      │  │  8 acts      │                        │
│  │ GroupChatView│  │  iframe comm │  │              │                        │
│  └──────────────┘  └──────────────┘  └──────────────┘                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

  Shared Contracts (src/contracts/):
    AgentEvent (26+ variants) · AgentPhase · MediaContent · GroupMessage · AG-UI Protocol
```

## Directory Structure

```
agentshire/
├── index.ts                       # Plugin entry (hook registration / service startup / nudge)
├── openclaw.plugin.json           # Plugin manifest
├── package.json
│
├── src/
│   ├── plugin/                    # Node.js plugin layer (24 files, see plugin/AGENTS.md)
│   │   ├── channel.ts             # ChannelPlugin implementation
│   │   ├── hook-translator.ts     # Hook → AgentEvent translation
│   │   ├── ws-server.ts           # WebSocket server + session management
│   │   ├── tools.ts               # AI tool registration (14 tools)
│   │   ├── auto-config.ts         # Zero-config auto-create Agent + Binding
│   │   ├── plan-manager.ts        # Multi-agent plan state machine
│   │   ├── citizen-agent-manager.ts # Independent citizen Agent create/disable/update + get/updateAgentConfig
│   │   ├── citizen-chat-router.ts # User ↔ citizen Agent message routing
│   │   ├── citizen-workshop-manager.ts # Citizen workshop config persistence
│   │   ├── editor-serve.ts        # Editor HTTP API (asset CRUD / GLB optimize / publish / models API / agent-config / sessions)
│   │   ├── llm-proxy.ts           # Lightweight LLM proxy (2 concurrent, anthropic/openai)
│   │   ├── llm-agent-proxy.ts     # Per-agent LLM model routing (modelRef resolution)
│   │   ├── model-config.ts        # openclaw.json providers/models CRUD (pure functions)
│   │   ├── group-chat.ts          # Group chat system (multi-citizen conversations)
│   │   ├── group-chat-history.ts  # Group chat JSONL history persistence
│   │   ├── group-chat-context.ts  # Group chat context compression + token budget
│   │   ├── session-history.ts     # Cross-session chat history loading
│   │   ├── soul-prompt-template.ts # Soul file AI generation template
│   │   ├── outbound-adapter.ts    # Outbound message adapter (text+media → deliverable_card)
│   │   ├── subagent-tracker.ts    # Sub-agent session log real-time forwarding
│   │   ├── session-log-watcher.ts # JSONL log incremental reader
│   │   ├── custom-asset-manager.ts # Custom GLB asset management
│   │   ├── town-session.ts        # Session ID normalization
│   │   └── runtime.ts             # Runtime injection
│   │
│   ├── bridge/                    # Bridge layer (12 files, see bridge/AGENTS.md)
│   │   ├── DirectorBridge.ts      # Central orchestrator (Phase state machine)
│   │   ├── EventTranslator.ts     # AgentEvent → GameEvent fallback translation
│   │   ├── RouteManager.ts        # A* pathfinding + move acknowledgment + destination scoring
│   │   ├── CitizenManager.ts      # Citizen spawn animation sequence + persona switch detection
│   │   ├── ActivityStream.ts      # Activity log + thinking stream (500ms flush)
│   │   ├── NpcEventQueue.ts       # Dialog bubble guard period
│   │   ├── StateTracker.ts        # agentId ↔ npcId bidirectional mapping + workstation pool
│   │   ├── ToolVfxMapper.ts       # Tool → VFX/animation/emoji pure functions
│   │   ├── ReconnectManager.ts    # Exponential backoff reconnection
│   │   ├── implicit-chat.ts       # NPC implicit LLM calls (10 scene types, DI injection)
│   │   ├── index.ts               # Barrel export
│   │   └── data/route-config.ts   # Pathfinding graph data
│   │
│   ├── contracts/                 # Shared types
│   │   ├── events.ts              # AgentEvent discriminated union (22+ variants)
│   │   ├── agent-state.ts         # AgentPhase / AgentStateSnapshot
│   │   ├── media.ts               # Multimodal content types
│   │   ├── chat.ts                # Group chat types (GroupMessage / usage / contextBudget)
│   │   ├── agui.ts                # AG-UI protocol events
│   │   └── registry.ts            # Project registry
│   │
│   └── town-souls.ts              # Soul file loader (multi-level search + fuzzy matching)
│
├── town-souls/                    # Preset soul files (10: steward + 8 citizens + template)
├── town-workspace/                # Workspace template (copied to user dir on first install)
│
└── town-frontend/                 # 3D Frontend
    └── src/
        ├── main.ts                # Game entry (WS connection / implicit chat proxy)
        ├── main.tsx               # React entry (standalone)
        ├── types.ts               # Shared types (weather / time period / buildings / NPC roles / modes)
        ├── app/                   # ★ React Chat UI (App / ChatView / GroupChatView / AgentList / TopNav / TownDynamicPanel / ClawSettingsView[11 nav sections: General/System/Messaging/Tools/AI/Network/Providers/Models/Plugin/Sessions/About])
        ├── game/                  # Scene management (see game/AGENTS.md)
        │   ├── MainScene.ts       # Main scene (1600+ lines, update loop + subsystem orchestration)
        │   ├── EventDispatcher.ts # 65 GameEvent type routing
        │   ├── DialogManager.ts   # Dialog streaming display + work logs + recentlyFlushed dedup
        │   ├── GameClock.ts       # 24h cycle (6 periods, night 3x speed)
        │   ├── WeatherSystem.ts   # 12 weather types + 10 daily themes state machine
        │   ├── SceneBootstrap.ts  # Boot flow (PublishedCitizenConfig loading)
        │   ├── animal-mode/       # ★ Animal Mode autonomy system (replaces workflow/ + DailyScheduler)
        │   ├── minigame/          # ★ Banwei Buster mini-game (MinigameSlot interface)
        │   ├── scene/             # 3D scenes (Town/Office/Museum Builder)
        │   └── visual/            # VFX + camera + lighting + weather particles + asset loading
        │
        ├── npc/                   # NPC system (10 files)
        │   ├── NPC.ts             # 7-state state machine + AnimationMixer crossfade
        │   ├── NPCManager.ts      # NPC container management
        │   ├── CasualEncounter.ts # ★ Zero-LLM lightweight social (preset scripts)
        │   ├── CitizenChatManager.ts # ★ Mayor ↔ citizen real-time chat
        │   ├── DialogueScripts.ts # ★ 400+ preset dialog lines (weather/time context)
        │   ├── EncounterManager.ts # LLM deep multi-turn dialog + summary
        │   ├── TownJournal.ts     # Event stream + daily narrative summary
        │   ├── ActivityJournal.ts # Activities / dialogs / relationships / daily plan / reflections
        │   ├── PersonaStore.ts    # Persona cache + compact prompt builder
        │   └── FollowBehavior.ts  # Follow behavior
        │
        ├── ui/                    # UI panels (18 files, incl. ★ MentionPicker @-selector)
        ├── data/                  # Data layer
        │   ├── GameProtocol.ts    # GameEvent (65 types) / GameAction (14 types)
        │   ├── TownConfig.ts      # Town config (v4)
        │   ├── CitizenWorkshopConfig.ts # ★ Citizen workshop config system
        │   ├── CharacterModelRegistry.ts # ★ Three-source character model registry
        │   └── ...                # TownConfigStore / CharacterRoster / DataSource
        │
        ├── editor/                # Town editor (30+ files, 5 entry pages)
        │   ├── main.ts            # Map editor entry
        │   ├── TownEditor.ts      # Editor core (select / drag / group / align / undo)
        │   ├── EditorScene.ts     # Editor 3D scene (1816 lines)
        │   ├── preview-main.ts    # ★ Game-level preview entry
        │   ├── citizen-main.ts    # ★ Citizen workshop entry
        │   ├── model-main.ts      # ★ LLM model manager entry
        │   ├── citizen/           # ★ Citizen workshop subsystem (Workshop/Stage/ModelPicker/SoulEditor/AnimMapping)
        │   └── model/             # ★ LLM model manager (ModelManager/ModelManagerView/types)
        │
        ├── audio/                 # BGMManager + AmbientSoundManager + AudioSystem
        ├── engine/                # Engine / World / Input / Screen / Performance
        ├── narrative/             # NarrativeEngine + demo sequences (8 acts)
        ├── platform/              # ★ PlatformBridge (iframe communication + Bridge.ts)
        ├── hooks/                 # useAgents / useWebSocket
        └── utils/                 # Filters / Math / RingBuffer / command-parser
```

## Data Flow

### Main Workflow

```
┌──────┐  text   ┌──────────┐  WS   ┌──────────┐ dispatch┌──────────┐
│ User │────────▶│ InputBar │──────▶│ ws-server│────────▶│ Gateway  │
└──────┘         └──────────┘       └──────────┘         └────┬─────┘
                                                               │
                              10+ Hook callbacks               │ Agent LLM
                                    ┌──────────────────────────┘
                                    ▼
┌──────────┐ GameEvent  ┌──────────────────┐ AgentEvent  ┌──────────────┐
│MainScene │◀───────────│ DirectorBridge   │◀────────────│    hook-     │
│          │ (65 types) │  Phase SM        │ (26+ types) │  translator  │
└────┬─────┘            └──────────────────┘             └──────────────┘
     │                          ▲
     │  GameAction (14 types)   │  workflow_phase_complete
     │  workstation_released    │  npc_move_completed
     └──────────────────────────┘
```

### Phase State Machine

```
         sub_agent          3s collect         phase              phase
         .started            window           complete            complete
┌──────┐ ─────────▶ ┌───────────┐ ────▶ ┌──────────┐ ────▶ ┌──────────────┐
│ idle │            │ summoning │       │assigning │       │going_to_office│
└──┬───┘            └───────────┘       └──────────┘       └──────┬───────┘
   ▲                                                               │
   │ phase                                                phase    │
   │ complete                                            complete  │
   │                                                               ▼
┌──┴───────┐ phase   ┌────────────┐  project   ┌─────────────────────┐
│returning │◀─ ── ── │ publishing │◀─ ── ── ── │       working       │
└──────────┘complete └────────────┘  _complete │                     │
                                               │  late sub_agent     │
                                               │  → assignLateArrival│
                                               └─────────────────────┘
```

### Citizen Independent Chat

```
┌──────┐  citizen   ┌──────────┐  WS    ┌──────────────┐  reply  ┌───────────┐
│ User │──  chat  ─▶│ InputBar │───────▶│ citizen-chat-│────────▶│Independent│
└──────┘            └──────────┘        │    router    │         │  Agent    │
   ▲                                    └──────────────┘         └─────┬─────┘
   │                                                                   │
   │  pushCitizenMessages                            Agent response    │
   └───────────────────────────────────────────────────────────────────┘
```

### NPC Implicit Behavior

```
┌────────────┐  implicit_chat   ┌──────────┐  HTTP  ┌───────────────┐
│AutonomyEng │──  _request   ──▶│ ws-server│───────▶│   llm-proxy   │
│ L2 decide  │                  └──────────┘        │  2 parallel   │
└─────┬──────┘                       │              │  anthropic /  │
      ▲                              │              │  openai       │
      │  implicit_chat               │              └───────┬───────┘
      │  _response                   │                      │
      └──────────────────────────────┘◀─────────────────────┘
```

### Group Chat

```
┌──────┐  @mention   ┌──────────────┐  WS    ┌────────────┐  route  ┌───────────┐
│ User │── message ─▶│ GroupChatView│───────▶│ ws-server  │───────▶│group-chat │
└──────┘             └──────────────┘        └────────────┘         │+history   │
   ▲                                                                   │+context   │
   │  pushGroupMessages                            per-citizen reply  └─────┬─────┘
   └───────────────────────────────────────────────────────────────────┘
```

## Type Contracts

| Type | Definition | Variants | Consumers |
|------|-----------|----------|-----------|
| `AgentEvent` | `src/contracts/events.ts` | 22+ | DirectorBridge, hook-translator, ws-server |
| `GameEvent` | `town-frontend/src/data/GameProtocol.ts` | 65 | Bridge emit, EventDispatcher, MainScene |
| `GameAction` | same as above | 14 | MainScene → DataSource → Bridge |
| `GroupMessage` | `src/contracts/chat.ts` | — | group-chat, group-chat-history, GroupChatView |
| `PublishedCitizenConfig` | `town-frontend/src/data/CitizenWorkshopConfig.ts` | — | SceneBootstrap, editor-serve, CitizenWorkshop |
| `npc_query_result` | `GameProtocol.ts` (GameAction) | — | tools.ts (spatial tools) ← MainScene (NPC query) |

## Sub-Module AGENTS.md

| Module | Path | When to Read |
|--------|------|-------------|
| Plugin Layer | [src/plugin/AGENTS.md](src/plugin/AGENTS.md) | Modifying hooks / tools / plans / citizen agents / editor API |
| Bridge Layer | [src/bridge/AGENTS.md](src/bridge/AGENTS.md) | Modifying Phase state machine / event translation / pathfinding / citizen spawn |
| Town Frontend | [town-frontend/AGENTS.md](town-frontend/AGENTS.md) | Modifying any frontend UI / styles / text — **brand colors & i18n rules** |
| Frontend Game | [town-frontend/src/game/AGENTS.md](town-frontend/src/game/AGENTS.md) | Modifying scenes / workflow / mini-game / VFX / weather |

## Core Architecture Constraints

1. **Bridge emits high-level intents, not micro-ops** — Bridge only emits `workflow_*` / `npc_work_done` intent events; detailed animation choreography lives in `workflow/`
2. **NPC state machine driven** — Animations driven via `NPC.transitionTo(state)`, never call `playAnim()` directly
3. **Deferred workstation release** — Bridge does not release workstations immediately; waits for the frontend NPC to physically leave, confirmed via `workstation_released` callback
4. **Phase advances on frontend feedback** — Frontend sends `workflow_phase_complete` after finishing animations; only then does Bridge advance the state machine
5. **Citizen dual-track** — Citizens can be sub-agents (during work) or independent agents (daily chat, managed via `citizen-agent-manager`)

## Testing

```bash
# Plugin + bridge layer tests
npm test

# Frontend tests
cd town-frontend && npx vitest run
```

Test distribution:
- `src/bridge/__tests__/` — EventTranslator, RouteManager, ActivityStream, CitizenManager, NpcEventQueue
- `src/plugin/__tests__/` — hook-translator, auth, channel, model-config
- `town-frontend/src/game/__tests__/` — EventDispatcher, DialogManager, GameClock, SceneBootstrap
- `town-frontend/src/data/__tests__/` — publishedToTownView, i18n, CharacterRoster
- `town-frontend/src/audio/__tests__/` — AmbientSoundManager, BGMManager
- `town-frontend/src/app/__tests__/` — TownDynamicPanel
- `town-frontend/src/platform/__tests__/` — Bridge
- `town-frontend/src/ui/__tests__/` — SettingsPanel

## Common Change Guide

| What to Do | Where to Start |
|-----------|---------------|
| Add Hook → AgentEvent mapping | `src/plugin/hook-translator.ts` |
| Add new AI tool | `src/plugin/tools.ts` |
| Modify multi-agent plan orchestration | `src/plugin/plan-manager.ts` |
| Modify editor backend API | `src/plugin/editor-serve.ts` |
| Modify citizen agent management | `src/plugin/citizen-agent-manager.ts` |
| Add AgentEvent → GameEvent mapping | `src/bridge/EventTranslator.ts` |
| Modify Phase state machine | `src/bridge/DirectorBridge.ts` |
| Modify citizen spawn animation | `src/bridge/CitizenManager.ts` |
| Modify NPC implicit behavior scenes | `src/bridge/implicit-chat.ts` |
| Modify group chat system | `src/plugin/group-chat.ts` + `group-chat-history.ts` + `group-chat-context.ts` |
| Modify LLM model management | `src/plugin/model-config.ts` + `town-frontend/src/editor/model/` |
| Modify per-agent LLM model routing | `src/plugin/llm-agent-proxy.ts` |
| Modify per-agent model proxy UI | `town-frontend/src/app/AgentModelsPanel.tsx` |
| Modify Animal Mode (citizen autonomy) | `town-frontend/src/game/animal-mode/AnimalModeManager.ts` + `MainScene.setAnimalModeEnabled()` |
| Modify Town lazy-loading | `town-frontend/src/app/App.tsx` (`getTabFromHash`) + `app/TownView.tsx` (`loaded` state) |
| Modify citizen spatial tools | `src/plugin/tools.ts` (3 spatial tools) + `town-frontend/src/game/MainScene.ts` (NPC query handler) |
| Add frontend GameEvent handler | `town-frontend/src/game/EventDispatcher.ts` |
| Modify NPC animation / state machine | `town-frontend/src/npc/NPC.ts` — driven by `transitionTo()` |
| Modify casual social encounters | `town-frontend/src/npc/CasualEncounter.ts` + `DialogueScripts.ts` |
| Modify mini-game | `town-frontend/src/game/minigame/BanweiGame.ts` |
| Modify weather effects | `WeatherSystem.ts` (state machine) + `WeatherEffects.ts` (visual) + `AmbientSoundManager.ts` (audio) |
| Modify 3D scenes | `town-frontend/src/game/scene/TownBuilder.ts` |
| Modify editor | `town-frontend/src/editor/` |
| Modify citizen workshop | `town-frontend/src/editor/citizen/CitizenWorkshop.ts` |
| Modify character model system | `town-frontend/src/data/CharacterModelRegistry.ts` |
| Add soul file | `town-souls/*.md` |
| Modify audio | `town-frontend/src/audio/` corresponding file |
