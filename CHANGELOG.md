# Changelog

## 2026.7.18 — Town UX Polish & Topic Mode Fixes

### NPC Stuck at Buildings (Issue 1)

Citizens frequently got stuck spinning in place around building perimeters. Root cause: door markers sit 0.5 cells outside the building footprint, but `obstacleQuery` with `PROBE_RADIUS=0.5` blocked NPCs from reaching the door. Fixed by:
- Adding a **door zone exemption** in `obstacleQuery` — positions within 1.8 units of a door marker are never treated as obstacles.
- Changing `handleTap` door detection from first-match (< 5) to **nearest-match (< 3)**, preventing wrong-building selection when tapping near overlapping door zones.
- Increasing the `walkToDoor` arrival threshold from 2.0 to 2.5 so NPCs stop earlier and don't overshoot into walls.

### Unique Building Names (Issue 2)

All buildings in the town now have unique names. Previously the first building of each type had no number suffix (e.g. "住宅" vs "住宅2"), causing ambiguity. Now every building appends its occurrence index within its role group (e.g. "住宅1", "住宅2", "办公室1"). Applied in both `updateWaypointsFromMapConfig` (types.ts) and `addBuildingLabel` (TownBuilder.ts).

### Topic Panel No Longer Covered (Issue 3)

The "发起话题" (Start Topic) setup panel was partially obscured by the bottom input bar. Fixed by raising the panel `z-index` from 70 to 1200 (above the bottom panel's 1100) and adding `margin-bottom: 80px` so the card content clears the input bar.

### Popup Overlap Fixes (Issue 4)

Audited all overlay/popup z-indexes to prevent stacking issues:
- `.town-confirm-backdrop` (confirm dialog): 60 → 1200
- `#town-skill-overlay` (skill learn card): 500 → 1200
- `#town-topic-overlay` (topic setup): 70 → 1200

### Mayor Follow During Topic (Issue 5)

When citizens are gathered around the mayor for a topic and the mayor moves, all participants now follow. Added `topicMayorPos` tracking and a 0.5s interval check in the update loop — if the mayor moves more than 1.5 units, citizens re-gather at the mayor's new position.

### Quick Action Bar (Issue 6)

The "发起话题", "居民详情", "群发消息" (and "话题详情" when a topic is active) buttons are now **always visible as a horizontal button bar above the input bar**, instead of being hidden behind the "更多 ▾" dropdown. The "更多" button is now hidden by default. The quick action bar re-renders automatically when topic state changes (start/end topic, broadcast mode toggle).

### Autonomous Decisions Paused During Topic (Issue 7)

When citizens are gathered for a topic, their autonomous behavior is now fully suspended:
- **L2 LLM decisions** — already paused via `pauseL2Decisions()` (refcounted) when the topic setup panel opens.
- **Casual encounters & deep dialogues** — now skipped in the update loop when `topicNpcIds.length > 0`, so citizens don't wander off or generate chat bubbles while the topic is in progress.

Both resume automatically when the topic ends (`dismissTopic`).

## 2026.7.17 — Animal Mode Activation & NPC Card Rework

### Citizens Visible & Autonomous

Fixed the core issue where citizens were invisible after spawn. Citizens now spawn visible at their home locations (`startHidden = false` in `MainScene.onNpcSpawn`), and are automatically registered into the Animal Mode `NeedsEngine` on spawn so the L2 decision loop has citizens to act on.

### NPC Card 5-Tab Layout

Reworked the NPC detail card from a 4-tab layout (activities/logs/chat/sessions) to a 5-tab layout with 2-character tab names to prevent wrapping on mobile:
- **状态** (status) — mood & needs grid + relationships (moved from the card body into this tab)
- **活动** (activities) — recent activities
- **日志** (logs) — work logs
- **聊天** (chat) — chat history with usage footer (tokens, cache %, reasoning tokens, context info) aligned with the React ChatView format
- **会话** (sessions) — agent sessions

### Duplicate Reply Fix

Fixed `DialogManager.flushStream` being called multiple times causing duplicate chat entries. Added a `recentlyFlushed` dedup map (10s window) so the 5s stream-timeout flush and the final `text` event don't both add a message.

### Settings: autoWalk Removed

Removed the "居民自动行走" (autoWalk) toggle from the settings panel — Animal Mode is now the sole citizen behavior driver. Settings now has: language, music, soul mode, animal mode.

### Specialty in Avatar/Name Area

The chat target indicator (avatar + name area above the input bar) now shows the citizen's specialty (occupation) for both citizens and the steward (e.g. "shire · 管家", "橙子 · 产品经理").

### NPC Card Move-Up Behavior

When the input textarea grows tall, the NPC card now moves up via `transform: translateY()` instead of shrinking its height. When the textarea shrinks back (after sending), the card returns to its original position. The card height stays constant throughout.

### Responsive Design

Added media queries for mobile (≤640px), tablet (≤1024px), and small phones (≤380px) to adapt NPC card padding, bottom panel margins, and tab bar height. Added a short-height landscape query for phones in landscape mode.

### LLM Timeout 120s

Increased the implicit chat (Animal Mode L2 decision) timeout from 30s to 120s to accommodate slower LLM providers.

## 2026.7.16 — Chat UX Polish

### Chat Header Refactor & Command Sync

Four user-facing improvements to the Chat view, focused on cleaner header UX and full parity with OpenClaw's slash-command surface.

#### 1. Header Button Cleanup

Removed three header buttons that duplicated slash-command functionality and added visual clutter:
- **压缩会话** (compact) — replaced by `/compact` command
- **原地重置** (reset) — replaced by `/reset` command
- **清空会话** (clear) — replaced by `/clear` command

Also removed the three associated confirmation dialogs, their handlers (`handleClearChat`, `confirmClearChat`, `handleResetChat`, `confirmResetChat`, `doCompact`, `handleCompactChat`, `handleCompactWithInstr`, `confirmCompactWithInstr`), state variables (`showClearConfirm`, `showResetConfirm`, `showCompactInstr`, `compactInstr`), and unused icon imports (`Trash2`, `Archive`, `RotateCcw`, `AlertTriangle`). The underlying `performClearChat` and `sendCommand('reset')` helpers are retained because they are still used by the command handler.

#### 2. Thinking & Reasoning Inline Dropdowns

Replaced the popup panel (triggered by a Brain button with `thinkingMenuOpen` state + outside-click handler) with two inline native `<select>` dropdowns directly in the chat header:
- **思考级别** (Think) — options: off / minimal / low / medium / high / xhigh / adaptive / max (empty = inherit)
- **推理可见性** (Reason) — options: on / off / stream (empty = inherit)

This removes the `thinkingMenuOpen` state, `thinkingMenuRef`, and the outside-click `useEffect`, simplifying the component and improving mobile UX (native selects handle focus/blur correctly on iOS).

#### 3. Slash Command Autocomplete — Full OpenClaw Parity

Expanded the command suggestion list from 17 to 40+ entries, matching the full OpenClaw slash-command surface documented at `openclaw/docs/tools/slash-commands.md`:

| Category | Commands |
|---|---|
| Frontend-only | `/new`, `/clear`, `/help` |
| Sessions | `/reset`, `/compact`, `/stop`, `/name`, `/export-session`, `/export-trajectory` |
| Model controls | `/model`, `/models`, `/think`, `/reasoning`, `/fast`, `/verbose`, `/trace`, `/elevated`, `/queue`, `/steer` |
| Discovery | `/commands`, `/tools`, `/status`, `/context`, `/usage`, `/whoami`, `/tasks`, `/goal` |
| Skills | `/skill`, `/learn`, `/btw`, `/approve` |
| Subagents | `/subagents`, `/agents` |
| Admin | `/config`, `/mcp`, `/plugins`, `/debug`, `/restart` |
| Voice | `/tts`, `/bash` |

`HELP_TEXT` and `HELP_TEXT_EN` updated with the full listing.

#### 4. Group Chat Command Routing Fix

**Problem**: When running slash commands inside a group chat, status/system messages (e.g. "会话已重置") were routed to the steward's `routingKey` instead of the active group's message list — so the user saw no feedback.

**Fix**: Added `groupChatActiveRef` and `groupInfoRef` refs that mirror the `groupChatActive` / `groupInfo` state. Introduced `addCmdSystemMessage` / `addCmdStatusMessage` helpers in `handleCommand` that check `groupChatActiveRef.current` and route the message to the group list (with the correct `groupId`) when in a group chat, falling back to the steward routingKey otherwise.

### Files Changed

| File | Change |
|------|--------|
| `town-frontend/src/app/ChatView.tsx` | Header button removal, thinking/reasoning inline dropdowns, group-chat command routing refs + helpers |
| `town-frontend/src/utils/command-parser.ts` | Expanded command suggestions (17 → 40+), updated help text |
| `town-frontend/src/i18n/zh-CN.ts` | Added `claw.am_thinking_short`, `claw.am_reasoning_short` |
| `town-frontend/src/i18n/en.ts` | Added `claw.am_thinking_short`, `claw.am_reasoning_short` |

### Tests

- Backend: 179 passed (13 files)
- Frontend: 244 passed (21 files)

## 2026.7.15 (rev 3) — Plugin Stability

### Plugin Stability (ROADMAP #3)

Four stability improvements landed, addressing the highest-priority items from the roadmap.

#### 1. ActivityStream Out-of-Order `tool_result` Fix

**Problem**: When multiple tools ran concurrently, `tool_result` events could arrive out of order. The old code marked the *most recent undefined-status activity* for an NPC, which was often the wrong tool — causing "step forever in progress" in the activity panel.

**Fix**: Introduced `toolUseId`-based pairing in `ActivityStream`:
- `emitActivity()` now accepts an optional `toolUseId` parameter, registering the activity index in a `pendingToolActivities` map.
- `emitActivityStatus()` first tries to match by `toolUseId` (precise), then falls back to the old "most recent undefined" heuristic.
- A 30-second timeout (`TOOL_RESULT_TIMEOUT_MS`) auto-cleans stale pending entries so they don't block future matching.
- All 4 call sites in `DirectorBridge.ts` (steward, citizen, sub-agent) now pass `event.toolUseId`.

**Tests**: Added 4 new test cases in `ActivityStream.test.ts` covering: concurrent out-of-order pairing, fallback for unknown IDs, fallback for no ID, and timeout auto-cleanup. Total: 13 tests pass.

#### 2. WebSocket Reconnect + State Recovery

**Problem**: The Town frontend's WebSocket (`main.ts`) had **no reconnection logic** — on disconnect, it showed an error banner and stayed dead. The backend had `ReconnectManager` and `sendWorkSnapshot` but they were never triggered on reconnect.

**Fix**:
- **Frontend** (`main.ts`): Refactored WS connection into `connectWs()` + `attachWsHandlers()` with exponential backoff reconnection (3s initial, 1.5× growth, 30s cap, 20 max attempts). On reconnect, re-sends `town_session_init` which triggers backend `sendWorkSnapshot`.
- **Backend** (`ws-server.ts`): Added `sync_request` message handler — frontend can explicitly request state resync after reconnect, which re-sends the work snapshot (phase + agents + activity logs).
- **Chat WS** (`useWebSocket.ts`): Already had reconnection; no changes needed.

#### 3. ChatSessionWatcher Cold-Start Retry Improvement

**Problem**: `scheduleChatWatcherRetry()` retried only once after 400ms. If the transcript file took longer than 400ms to appear (common in cold-start scenarios), the watcher never started and chat messages were silently lost.

**Fix**: Replaced single retry with exponential backoff:
- 15 max attempts, delay doubling from 400ms to 5s cap.
- Retry counter reset on successful watcher start.
- Counter cleaned up on WS disconnect (`clearChatWatcherRetry`).

#### 4. Diagnostic Command (`town_diagnose`)

**New AI tool** that lets the steward self-check the plugin environment:
- State directory existence
- Runtime config (default model, workspace)
- WebSocket server status + connected client count
- Steward agent config (`agent.json`)
- LLM providers configured
- WS server running status

Outputs a structured report with ✅/❌/⚠️ indicators and a pass/fail summary. Users can ask the steward "诊断一下环境" to trigger it.

### Files Changed

| File | Change |
|------|--------|
| `src/bridge/ActivityStream.ts` | `toolUseId` pairing + timeout cleanup |
| `src/bridge/DirectorBridge.ts` | Pass `event.toolUseId` at 4 call sites |
| `src/bridge/__tests__/ActivityStream.test.ts` | 4 new test cases |
| `town-frontend/src/main.ts` | WS reconnect with exponential backoff + `attachWsHandlers` refactor |
| `src/plugin/ws-server.ts` | `sync_request` handler + cold-start retry backoff |
| `src/plugin/tools.ts` | `town_diagnose` diagnostic tool |
| `ROADMAP.md` | Mark 4 items as done |

## 2026.7.15 (rev 2)

### Dependencies — Full Upgrade to Latest

All project dependencies upgraded to the latest stable versions. Upgrades were executed in 5 incremental stages with tests passing after each stage.

#### Backend (`package.json`)

| Dependency | From | To | Notes |
|---|---|---|---|
| `@gltf-transform/core` | ^4.3.0 | ^4.4.1 | GLTF optimization core |
| `@gltf-transform/extensions` | ^4.3.0 | ^4.4.1 | GLTF extensions |
| `@gltf-transform/functions` | ^4.3.0 | ^4.4.1 | GLTF processing functions |
| `jsonrepair` | ^3.13.3 | ^3.15.0 | JSON repair |
| `ws` | ^8.16.0 | ^8.21.1 | WebSocket server |
| `@types/ws` | ^8.5.10 | ^8.18.1 | ws type definitions |
| `typescript` | ^5.4.0 | ^7.0.2 | Go-rewritten compiler, major perf gain |
| `vitest` | ^4.1.0 | ^4.1.10 | Test framework |

#### Frontend (`town-frontend/package.json`)

| Dependency | From | To | Notes |
|---|---|---|---|
| `vite` | ^5.2.0 | ^8.1.4 | Rolldown engine, build 29s→7s |
| `@vitejs/plugin-react` | ^4.7.0 | ^6.0.3 | peer: vite ^8 |
| `@vitejs/plugin-basic-ssl` | ^1.1.0 | ^2.3.0 | peer: vite ^6/7/8 |
| `@tailwindcss/vite` | ^4.2.1 | ^4.3.2 | Tailwind Vite plugin |
| `tailwindcss` | ^4.2.1 | ^4.3.2 | Tailwind CSS |
| `tailwind-merge` | ^3.5.0 | ^3.6.0 | Tailwind class merge |
| `three` | ^0.162.0 | ^0.185.1 | Three.js 3D engine |
| `@types/three` | ^0.162.0 | ^0.185.1 | Synced with three |
| `react` | ^19.2.4 | ^19.2.7 | React |
| `react-dom` | ^19.2.4 | ^19.2.7 | React DOM |
| `@types/react` | ^19.2.14 | ^19.2.17 | React types |
| `lucide` | ^0.577.0 | ^1.24.0 | Icon library (dynamic `icons` object) |
| `lucide-react` | ^1.6.0 | ^1.24.0 | Lucide React components |
| `typescript` | ^5.4.0 | ^7.0.2 | Go-rewritten compiler |
| `vitest` | ^4.0.18 | ^4.1.10 | Test framework |

### Deprecated API Replacements

After upgrading, scanned and replaced all APIs marked as deprecated by the new dependency versions:

- **`THREE.Clock` → `THREE.Timer`** (Three.js r183 deprecated `Clock`, runtime warning: *"Please use THREE.Timer instead"*). Migrated 4 files: `Engine.ts`, `AnimMappingDialog.ts`, `CharacterStage.ts`, `preview-main.ts`. API difference: `Clock` uses `start()`/`stop()` + auto-updating `getDelta()`; `Timer` uses explicit `update()` before `getDelta()` (safe for multiple queries per frame).
- **`THREE.PCFSoftShadowMap` → `THREE.PCFShadowMap`** (Three.js r185 deprecated `PCFSoftShadowMap`, runtime auto-downgrades with warning). `PCFShadowMap` now supports soft shadows. Updated 4 files: `Engine.ts`, `CharacterStage.ts`, `EditorScene.ts`, `preview-main.ts`.
- **`build.rollupOptions` → `build.rolldownOptions`** (Vite 8 deprecated `rollupOptions` in favor of Rolldown-native options). Updated `vite.config.ts`.
- **`import.meta.glob({ as: 'raw' })` → `{ query: 'raw', import: 'default' }`** (Vite 6+ deprecated the `as` option). Updated `NPC.ts`.

### Vite 8 Type Compatibility Fix

- **`server.https` type change** — Vite 8 changed `server.https` type from `boolean` to `HttpsServerOptions`. The previous `https: mode === 'https' || ...` (boolean) caused a VSCode type error. Removed the `server.https` config line; HTTPS is now auto-injected by `@vitejs/plugin-basic-ssl` in its `configResolved` hook when the plugin is loaded.

### Reverse Proxy Base Plugin Removal

- **Removed `reverseProxyBasePlugin`** from `vite.config.ts`. The old approach injected an inline `<script>` into `<head>` at build time to dynamically create a `<base>` tag, making `document.baseURI` carry the reverse-proxy prefix. The new approach derives the prefix directly from `location.pathname` in JS:
  - `ws-url.ts`: `detectReverseProxyPrefix()` now reads `window.location.pathname` instead of `document.baseURI`.
  - `api-base.ts`: `apiUrl()` now prepends the proxy prefix (e.g. `/agentshire/55210`) to absolute paths, instead of stripping the leading `/` and relying on `document.baseURI` for relative resolution.
  - Static assets use `./` relative paths (via `base: './'`), which the browser resolves relative to the page URL — automatically carrying the proxy prefix in reverse-proxy scenarios.

### TypeScript 7 Migration

- **`tsconfig.json` (backend)**: Added `"types": ["node"]` — TS 6/7 defaults `types` to `[]`, which would drop global `process`/`Buffer` types from `@types/node`.
- **`town-frontend/tsconfig.json`**: Removed deprecated `baseUrl` (TS 7 removed it entirely, error: `Option 'baseUrl' has been removed`); changed `paths` from `["src/*"]` to `["./src/*"]` (relative paths required without `baseUrl`).

### Performance

- Frontend build time: **29.3s → 6.8s** (Vite 8 Rolldown engine).
- Backend test duration: **3.2s → 2.4s** (TypeScript 7 Go-rewritten compiler).

### Chores
- Updated `AGENTS.md` Tech Stack section with new dependency versions.
- Updated `README.md` and `README.zh-CN.md` with current tech stack.
- Bumped version to `2026.7.15`.

## 2026.7.15

### Improvements
- **Claw Settings Panel Restructure** — The Claw Settings view (`ClawSettingsView.tsx`) has been reorganized from a single overloaded "advanced" tab (21 sections in one page) into 5 logically grouped nav sections with a shared `AdvancedPanel` component using a `group` prop for conditional section rendering:
  - **系统 (System)** — Logging, Update, Diagnostics, Audit
  - **消息 (Messaging)** — Session, Messages, Commands, Cron
  - **工具 (Tools)** — Browser, Tools, Web, Media, MCP
  - **AI** — Talk/Voice, Transcripts, Commitments, Broadcast, ACP
  - **网络 (Network)** — Memory, Proxy, Env, Hooks, UI
  - The existing General, Providers, Models, Plugin, Sessions, and About sections remain as separate nav items, bringing the total to 11 nav entries.
- **OpenClaw Config Defaults** — All ~100 `useState` default values in `ClawSettingsView.tsx` are now aligned with the actual `openclaw.json` values (e.g., `gateway.bind=loopback`, `logging.level=info`, `logging.consoleStyle=pretty`, `logging.redactSensitive=off`, `browser.enabled=true`, `browser.headless=false`, `session.scope=per-sender`, `session.dmScope=main`, `session.typingMode=never`, `commands.native=auto`, `commands.ownerDisplay=raw`, `commands.restart=true`, `memory.backend=builtin`, `memory.citations=auto`, `tools.profile=full`, `talk.consultThinkingLevel=off`, `talk.interruptOnSpeech=true`, `broadcast.strategy=parallel`, `proxy.loopbackMode=gateway-only`, `models.mode=merge`, `plugins.bundledDiscovery=compat`, `plugins.enabled=true`, `update.channel=stable`, `update.checkOnStart=true`, `update.auto.enabled=false`, `diagnostics.enabled=true`, `audit.enabled=false`, `cron.enabled=false`, `cron.maxConcurrentRuns=1`).
- **Shared Props Object** — A shared `advProps` object is defined before the render statement and spread into all 5 `AdvancedPanel` calls, eliminating ~100 lines of repeated prop passing.
- **i18n Labels** — Added nav labels for the 5 new groups in both `en.ts` and `zh-CN.ts` (`claw.nav_system`, `claw.nav_messaging`, `claw.nav_tools`, `claw.nav_ai`, `claw.nav_network`).

### Chores
- Updated `README.md` and `README.zh-CN.md` Claw Settings feature descriptions to reflect the 11-section nav structure.
- Updated `AGENTS.md` and `town-frontend/AGENTS.md` with `ClawSettingsView.tsx` architecture notes.

## 2026.7.14

### Improvements
- **OpenClaw 2026.7.1 SDK Adaptation** — Migrated all `rt.config.loadConfig()` fallbacks to `rt.config.current()` (the stable API since 2026.6.11). Removed the `typeof rt.config.current === "function"` feature-detection guards now that 2026.7.1 is the baseline. Affected files: `channel.ts`, `editor-serve.ts`, `llm-agent-proxy.ts`, `ws-server.ts`, `paths.ts`.
- **Config Access Fix** — `editor-serve.ts` `getStewardWorkspaceDir()` and `loadAgentList()` previously accessed `rt.config` directly (the config object, not the config itself); now correctly call `rt.config.current()` to get the runtime config snapshot.
- **`before_agent_start` → `before_model_resolve` Migration** — The `@deprecated` `before_agent_start` hook is now fully replaced by `before_model_resolve` across `index.ts` (steward hook registration + `session_start` init dispatch), `hook-translator.ts` (AgentEvent translation), and `ws-server.ts` (comment). The project already used `before_prompt_build` for soul injection (migrated from `subagent_spawning` in a prior session). All 12 registered hooks are now non-deprecated.
- **`finalizeInboundContext` → `buildChannelInboundEventContext` Migration** — The `@deprecated` `rt.channel.reply.finalizeInboundContext()` is now fully replaced by `buildChannelInboundEventContext` from `openclaw/plugin-sdk/channel-inbound`. A new `buildTownInboundContext()` helper in `channel.ts` maps the legacy flat params (`Body`/`From`/`To`/`SessionKey`/`ChatType`/`CommandAuthorized`/…) into the structured facts objects (`SenderFacts`/`ConversationFacts`/`RouteFacts`/`ReplyPlanFacts`/`MessageFacts`/`AccessFacts`) required by the new API. All 3 call sites migrated: `channel.ts` (steward dispatch), `citizen-chat-router.ts` (citizen chat), `editor-serve.ts` (soul generation).
- **Startup Banner** — Removed the hardcoded version number from the startup banner; it now reads `🏘️  Agentshire is live!` without a version suffix.

### Chores
- Full OpenClaw 2026.7.1 compliance audit completed: 100% compliant across deprecated API usage, SDK import paths, hook registration, manifest fields, and config access patterns.
- Added `openclaw/plugin-sdk/channel-inbound` mock to `channel.test.ts` to keep the test suite green after the `buildChannelInboundEventContext` import.

## 2026.7.13

### New Features
- **Citizen Spatial Awareness & Movement (3 tools)** — Residents can now perceive their 3D world and move through it via 3 new AI tools: `town_get_my_status` (get own state + position), `town_query_nearby_citizens` (query citizens within a radius, sorted by distance), and `town_walk_to` (walk to a coordinate). A new plugin↔frontend request-response channel (`world_control.query_npc` → `npc_query` GameEvent → `npc_query_result` GameAction) lets plugin-layer tools read live NPC positions/states that only exist in the browser. Tool caller identity is resolved via a `before_tool_call` hook mapping (`toolCallId → agentId → npcId`).
- **Citizen Auto-Walk Toggle** — New "居民自动行走" (Citizen Auto-Walk) switch in the Settings panel controls `DailyBehavior` scheduled walking (leaving home / roaming / going home). Default ON; when OFF, NPCs stay visible at their current positions and stop scheduling new walks, but still respond to `town_walk_to` tool moves and user dialogue. Toggling does not remove any NPC — all citizens remain on the map at all times.
- **Town 3D Scene Lazy-Loading** — The app now defaults to the `#chat` route on open. The Town 3D scene (iframe loading `town.html` → Engine/MainScene/WebSocket) is only initialized when the user first clicks the Town tab, avoiding the full 3D engine/asset/WebSocket initialization cost when the user just wants to chat. Once loaded, the Town iframe stays mounted for instant switching.
- **Agent Models Panel** — New `AgentModelsPanel` React component in the Claw Settings view ("代理管理" / Agent Models): manage each resident (Agent) and its LLM model proxy — primary model + fallbacks, identity (name, emoji), thinking/reasoning defaults, context tokens, subagent timeout, group-chat history limit. All fields map to `openclaw.json` `agents.list[]` entries via new `get-agent-config` / `update-agent-config` backend APIs.
- **Session Deletion** — The Claw Settings → Sessions panel now supports deleting individual sessions (per agent + sessionKey), removing both the `sessions.json` entry and the `.jsonl` / `.trajectory` files.

### Improvements
- **Claw Settings Navigation** — Added a dedicated "代理管理" (Providers) nav section in the Claw Settings panel, separating provider/agent-model management from the models list.
- **Mobile Chat Back-Button Fix** — `ChatView` now watches an `exitNonce` signal from `App` to correctly reset internal group-chat state when the mobile back button is pressed while in group chat (where `selectedAgent` is already null, so the existing effect couldn't detect the back press).
- **DailyBehavior Auto-Walk Granularity** — Auto-walk toggle only affects scheduled walking decisions; AgentBrain L1/L2 decisions, casual encounters, and tool-triggered moves are unaffected.

### Chores
- Updated `openclaw.plugin.json` `contracts.tools` with the 3 new spatial tools (`town_get_my_status`, `town_query_nearby_citizens`, `town_walk_to`).
- Added `getAgentConfig` / `updateAgentConfig` helpers in `citizen-agent-manager.ts` for reading/patching agent entries in `openclaw.json`.
- Added `sessions/delete` route in `editor-serve.ts` Claw API.

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
