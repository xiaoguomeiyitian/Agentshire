# Changelog

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
