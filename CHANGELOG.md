# Changelog

## 2026.7.12

### New Features
- **AI Town Editing (7 tools)** — The steward can now edit the 3D town through natural language via 7 new AI tools: `town_list_assets` (browse buildings/props/roads/characters/pets by category), `town_list_objects` (list placed objects), `town_place_object` (place on grid with rotation/scale/footprint + overlap check), `town_move_object`, `town_transform_object` (rotate/scale/flip), `town_delete_object`, `town_set_terrain` (grass/sand/street/plaza/sidewalk/water), and `town_expand_map`. Changes flow through the new `world_control` scene events and `scene_edit` GameEvent, reflected live in the 3D scene.
- **Claw Settings Panel** — New in-app `ClawSettingsView` React component as a third top-level tab (`#claw`): manage OpenClaw runtime config (gateway mode, subagent timeout, plugin enabled, auto-launch, logging level/style/redaction, browser headless/no-sandbox/CDP, update channel, session max-history) and inspect live session summaries with per-session token usage and cost totals.
- **Token Usage Enhancements** — `TokenUsage` now carries `cacheRead` / `cacheWrite`; `turn_end` reports `compactionCount`; chat messages expose `model` and `reasoning` fields. Group chat responses propagate model/cache/compaction info per citizen.
- **Heuristic Token Estimation Fallback** — New `src/plugin/token-estimate.ts`: when an LLM API returns `usage = 0`, estimate tokens via CJK (~1.5 tok/char) + Latin (~0.25 tok/char) heuristic, cached per `runId` with 5-min TTL sweep. Keeps the token-usage panel meaningful for providers that don't report usage.
- **Unified Asset Catalog** — `editor-serve` now builds a single asset catalog aggregating three sources: preloaded game assets (`public/assets/models/`), Megapack assets (if present on disk), and custom GLB assets (`town-data/custom-assets/`), with existence verification and URL normalization for characters/pets subdirectories.
- **Preset Asset Pack** — Added 40+ preloaded GLB models: flowers, grass, park grass hill, pebbles, capybara, 12 character models (female/male a–f), and 24 pet models (beaver, bee, bunny, cat, caterpillar, chick, cow, crab, deer, dog, elephant, fish, fox, giraffe, hog, koala, lion, monkey, panda, parrot, penguin, pig, polar, tiger).

### Improvements
- **Model Manager Merged into Claw Panel** — Removed the standalone `model-manager.html` page and its iframe-based `editor/model/*` modules; the LLM Model Manager is now a first-class `ModelPanel` React component embedded in the Claw Settings view. Vite no longer builds the `model-manager` entry.
- **Tri-Mode Top Navigation** — Top nav now switches between Town / Chat / Claw (previously Town / Chat). The quick-menu no longer opens a separate model-manager window.
- **Backend Build Step** — `npm run build` now compiles the TypeScript backend (`tsc`) and copies `town-souls/` + `town-workspace/` into `dist/` via `copy-assets` before building the frontend. Added `build:backend` script for backend-only builds.
- **Tool Result Wrapping** — All AI tool `execute()` handlers now return `textResult()` via a shared `ok()` helper instead of raw strings, conforming to the SDK `AgentToolResult` contract.

### Chores
- Updated `openclaw.plugin.json` tool allow-list with the 7 new town-editing tools.
- Removed `readdirSync` import from `plan-manager` (unused after refactor).

## 2026.7.11

### New Features
- **Group Chat System** — Multi-citizen group conversations with @mention picker (keyboard navigation + auto-scroll), per-citizen role display (e.g. "岩（架构设计）"), JSONL history persistence, and clear-session with confirmation
- **LLM Model Management UI** — Standalone `model-manager.html` page for `openclaw.json` providers/models CRUD (add/update/delete/import/export), 11 OpenClaw-supported API types, undo/redo history
- **Per-Agent LLM Model Assignment** — Each steward/citizen can specify a dedicated LLM model (`providerId/modelId`) from the Citizen Workshop; empty = inherit global default
- **Town Dynamic Panel** — New panel showing real-time town activity and context token usage
- **Context Token Budget Tracking** — Group chat tracks per-citizen token usage with `context_update` events; compression thresholds significantly increased (RECENT_WINDOW 15→240, MAX_CONTEXT_TOKENS 4000→96000)
- **Platform Bridge** — Enhanced iframe communication layer (`platform/Bridge.ts`)

### Improvements
- **Brand Color Unification** — Replaced legacy accent colors (`#64ffda` / `#38bdf8` / `#45E796` / `#667eea`) with brand color `#D4A574` across 13+ style files
- **Refresh Persistence** — Selected citizen/group-chat mode persisted in `localStorage`; survives page refresh
- **Clear Session** — Single-chat and group-chat clear with timestamp filtering (`clearedAgentsRef` / `groupClearedAtRef`) to prevent stale message reload
- **OpenClaw 2026.6.11 SDK Adaptation** — Soul injection migrated from `subagent_spawning` to `before_prompt_build` (60s TTL cache); SDK subpath imports (`plugin-sdk/core`, `runtime-store`); `config.current()` preferred over `loadConfig()`
- **Default Ports Changed** — `wsPort` 55211→20008, `townPort` 55210→20009

### Bug Fixes
- Fixed stale messages reappearing after switching citizens and switching back

### Tests
- Added unit tests for auth (36 cases), channel config (7 cases), i18n (12 cases), CharacterRoster (8 cases), model-config (20 cases)
- Added tests for AmbientSoundManager, BGMManager, SettingsPanel, Bridge, TownDynamicPanel
- Coverage: `auth.ts` 0%→87.5%, i18n 33%→100%, CharacterRoster 27%→~80%

### Chores
- Removed tracked `dist/` build artifacts (311 files), added `dist` to `.gitignore`

## 2026.4.12

### New Features
- **QClaw compatibility**: Auto-detects state directory (`~/.qclaw/` or `~/.openclaw/`), works seamlessly on both OpenClaw CLI and QClaw desktop
- **Bilingual UI**: Full Chinese and English interface with auto-detection and manual language switch via Settings panel
- **Topic discussions**: Start multi-citizen group discussions with structured turn-taking and AI-moderated dialogue
- **Dynamic model display**: Shows actual model name from runtime config instead of hardcoded value

### Bug Fixes
- **Agent routing**: Messages now correctly route to `town-steward` via explicit SessionKey format, regardless of `agents.list` order
- **Session history**: Fixed variable shadowing that silently broke chat history loading
- **Hardcoded paths**: All `~/.openclaw/` references replaced with centralized `stateDir()` resolution
- **Archived sessions**: Fixed path construction in `listArchivedSessions` that referenced a function instead of a string

### Documentation
- Updated README (EN + CN) with QClaw install guide, compatibility table, and new features
- Updated ROADMAP with QClaw compatibility milestones
- Added GitHub issue/PR templates

## 2026.4.6 — Initial Release

First public release of Agentshire.

- 3D low-poly town with day/night cycle, 12 weather types, procedural ambient sound, and 4-track dynamic BGM
- Agent = NPC mapping with cinematic workflow (summon → assign → code → celebrate → return)
- Dual-mode UI: 3D Town + IM Chat with agent list and multimodal support
- Citizen Workshop: create characters with 3D models, AI-generated soul files, and animation mapping
- Town Editor: visual drag-and-drop map editing with grouping, alignment, undo, and preview
- Soul system: Markdown personality files with multi-level search and fuzzy matching
- NPC daily behavior (algorithm-driven + optional Soul Mode with AI brain)
- Zero-LLM casual encounters with 400+ preset dialogue lines
- Banwei Buster mini-game
- Zero configuration: auto-creates steward agent and routing on first startup
- 11 AI tools for town control and multi-agent project orchestration
