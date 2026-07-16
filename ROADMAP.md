# ROADMAP

> This roadmap tracks where Agentshire is and where it's going.  
> Agentshire is an OpenClaw/QClaw plugin that turns AI agents into living NPCs in a 3D town with UGC tools.  
> See [README](./README.md) for full feature list, [VISION](./VISION.md) for why we're building this.

> Agentshire doesn't lack a vision.  
> What it needs most right now is a solid foundation — so everyone can install it, run it, and rely on it.

---

## What We've Built ✅

Agentshire is not a slide deck. It's a working system with:

- **3D Town + IM Chat** dual-mode interface, real-time dialog bubbles, multimodal support, **bilingual UI (Chinese + English)**
- **Agent = NPC** real-time mapping, cinematic workflow choreography (summon → assign → code → celebrate → return)
- **Day/night cycle + 12 weather types + procedural ambient sound (zero audio files) + 4-track dynamic BGM**
- **Citizen Workshop**: three-source character models (12 built-in + 300+ library + custom upload), AI soul generation, 8-slot animation mapping, **per-agent LLM model assignment**, publish as independent Agents
- **Town Editor**: drag-and-drop buildings/roads/lights, grouping/alignment/undo, JSON export + game-level preview
- **LLM Model Manager**: standalone page for `openclaw.json` providers/models CRUD with undo/redo history
- **Group Chat**: multi-citizen group conversations with @mention picker, JSONL history persistence, context token budget tracking
- **Soul Mode (basic)**: AgentBrain 3-tier AI decisions + LLM deep conversations + relationship graph
- **Zero-LLM daily social interactions** + Banwei Buster mini-game
- **Topic Discussions**: multi-citizen group discussions with structured turn-taking
- **QClaw + OpenClaw compatibility**: auto-detects state directory, works on both platforms

The focus of this roadmap is not "0 to 1" — it's **stabilizing the foundation before building higher**.

---

## Current Sprint 🔥

> Core principle: **Make the town run reliably first, then make it fun.**

| # | Direction | Status | Needs |
|---|-----------|--------|-------|
| 1 | **Platform Compatibility** | ✅ QClaw + CLI 2026.6.11+ done | Architect · Systems Engineer |
| 2 | **npm One-Click Install** | Blocked | Systems Engineer |
| 3 | **Plugin Stability** | In Progress | Full-Stack Engineer |
| 4 | Soul Mode Improvements | In Progress | AI Engineer · Frontend |
| 5 | Editor ↔ Town Integration | In Progress | Three.js Frontend · Systems |
| 6 | Open Source & Community | In Progress | Everyone willing to help |

### 1. Platform Compatibility

No matter how many features we add, if users can't install it or upgrading breaks everything, none of it matters.

**Current state**: OpenClaw CLI 2026.3.13, 2026.6.11+, and QClaw 0.2.x are fully supported. CLI 4.x–6.10 is broken (Channel init regression).

- [x] ~~**QClaw compatibility**: Auto-detect state directory (`~/.qclaw/` vs `~/.openclaw/`), centralized path resolution~~
- [x] ~~**Agent routing fix**: SessionKey format updated to ensure correct routing to `town-steward` regardless of `agents.list` order~~
- [x] ~~**Dynamic model display**: Show actual model name from runtime config instead of hardcoded value~~
- [x] **4.x Channel initialization regression**: Resolved by migrating the entry point to `defineChannelPluginEntry` from `openclaw/plugin-sdk/channel-core` (compatible with OpenClaw 2026.6.11+)
- [ ] **Rollup code-splitting breaks tool registration**: `api.registerTool()` state is isolated across JS chunks — needs upstream fix or workaround
- [ ] **Plugin SDK API availability varies by version**: needs a unified compatibility layer
- [x] ~~**Security scanner false positives**~~: Resolved
- [ ] Establish a cross-version compatibility test matrix (3.13 / 4.x / latest)

**Goal**: Support 3.13 + QClaw 0.2.x + latest CLI stable simultaneously.

### 2. npm One-Click Install

The plugin has not been published to npm or ClawHub yet. Users must clone → build → link install.

- [x] ~~Refactor browser launch to eliminate `child_process` dependency~~ — Done: uses `api.runtime.system.runCommandWithTimeout` with dynamic import fallback
- [x] ~~Refactor LLM proxy API key resolution to eliminate all `process.env` access~~ — Done: reads from `rt.config.loadConfig()`
- [ ] Publish to npm and/or ClawHub registry
- [ ] Automated npm publish pipeline (GitHub Actions)

**Goal**: `openclaw plugins install agentshire` works out of the box.

### 3. Plugin Stability

Make existing features truly reliable.

- [x] ~~ActivityStream state matching fix: out-of-order `tool_result` arrivals cause "step forever in progress"~~ — Fixed: `toolUseId`-based pairing + 30s timeout auto-cleanup
- [x] ~~ChatSessionWatcher reliability in cold-start scenarios~~ — Fixed: exponential backoff retry (400ms → 5s, up to 15 attempts)
- [x] ~~Full state recovery after WebSocket reconnect~~ — Fixed: frontend auto-reconnect with exponential backoff + `sync_request` resync + `work_snapshot` replay
- [ ] Better error messages: clear diagnostics for install failure / connection failure / missing LLM config
- [x] ~~Diagnostic command: help users self-check their environment~~ — Added `town_diagnose` AI tool (checks state dir, runtime config, WS server, agents, LLM providers)
- [x] ~~Group chat clear-session: stale message reload after switching citizens~~ — Fixed: timestamp filtering (`clearedAgentsRef` / `groupClearedAtRef`)
- [x] ~~Brand color unification across all UI~~ — Done: `#D4A574` brand color applied to 13+ style files

### 4. Soul Mode Improvements

NPCs can already make their own decisions. But if they forget everything after a "night's sleep," that's not really living.

- [ ] NPC long-term memory persistence (remember important events across sessions)
- [ ] Soul Mode product toggle and behavior configuration panel
- [ ] implicit-chat token cost control and fallback strategy optimization

### 5. Editor ↔ Town Integration

You've built a beautiful map in the editor, hit export — then what? There's one last step missing.

- [ ] Load editor-exported JSON map data at runtime
- [ ] Custom building interaction binding and lighting restoration
- [ ] Auto-generate pathfinding graph when map changes

### 6. Open Source & Community

- [ ] Automated npm package publishing (depends on #2)
- [x] CONTRIBUTING.md
- [x] First-launch welcome message and onboarding guide
- [ ] Comprehensive error diagnostics and FAQ documentation

---

## Up Next 🗺️

### Plugin SDK Compatibility Layer

Abstract a unified compat shim to hide OpenClaw version differences:

- **LLM calls**: Auto-select from `prepareSimpleCompletionModel` → `runEmbeddedPiAgent` → direct fetch fallback chain
- **Tool registration**: Detect if `registerTool` is effective, auto-supplement with workspace `TOOLS.md` as fallback
- **Workspace paths**: ~~Unified resolution logic compatible with different version defaults~~ ✅ Done (centralized `stateDir()`)
- **Sub-agent management**: Wrap `subagent.run()` context limitations behind a unified async task interface

### Developer Experience

- e2e test coverage: install → start → chat → workflow full pipeline automated verification
- Version compatibility CI: every PR automatically tested across multiple OpenClaw versions
- Plugin development docs: let other developers use Agentshire as a reference for building their own OpenClaw plugins

### Mobile Experience

The hard part isn't responsive layout — it's: **how does a phone seamlessly connect to OpenClaw running on a local machine?**

- [ ] Solve mobile ↔ local Gateway WebSocket tunneling (may require cloud relay)
- [ ] Mobile 3D performance optimization (model LOD, particle downgrade)

---

## Mid-Term Vision: A Town That Feels Alive 🏘️

Once the engineering foundation is solid, take the town from "animated" to "alive":

- **Clothing**: NPC outfit changes based on season / mood / growth
- **Food**: In-building interactions — cafés restore energy, restaurants as social scenes
- **Shelter**: Home ownership — coming home, decorating, neighbor relationships
- **Travel**: More natural movement — with purpose and small random events along the way
- **Play**: More mini-games + NPC entertainment interactions (Banwei Buster is just the first)

Plus a full progression system:

- NPC experience points and skill trees
- Town prosperity score (accumulates with activity, unlocks new lots and buildings)
- Achievement system / Town chronicles

**This is where game designers and artists can truly shine.**

---

## Long-Term Vision: When Islands Connect 🌍

A single town is cozy.

But if every user has their own town — those towns shouldn't stay isolated forever.

Your architect visits a friend's town to help review some code.  
Two agents from different owners meet at the border and exchange newly learned skills.  
When a global event happens, all connected towns respond together.

Dashboards don't form connections.  
But towns and towns? They naturally do.

**When islands connect into a continent, towns grow into a world.**

---

## Join Us 🤝

Agentshire doesn't just welcome one type of contributor.

**We need most right now:**

- **Architects / Systems Engineers**: OpenClaw plugin SDK compatibility layer, cross-version testing, build and release pipelines
- **OpenClaw Community Contributors**: Upstream bug fixes (Channel init regression, code-splitting state isolation, tool registration)
- **Full-Stack Engineers**: Plugin stability, WebSocket reliability, error diagnostics

**Also welcome:**

- **AI Engineers**: Soul mode, NPC brain, long-term memory, multi-agent orchestration
- **Game Designers**: Game loops, progression balance, event systems, town rhythm
- **Game Artists**: Buildings / characters / props / animations / UI / world atmosphere
- **Developers**: Three.js frontend, Node backend, editor integration, mini-games, protocols
- **Content Creators**: NPC personas, soul files, dialog, town narratives

**Most importantly:** We welcome everyone who doesn't fit neatly into a category.

You don't have to be a professional game designer, a trained artist, or even an AI expert.  
If you believe in this:

> Every user will eventually have their own AI team.  
> And those teams deserve a place to live, grow, work, and play.

Then you're already one of us.

**How to get involved:**

- Browse [Issues](https://github.com/Agentshire/Agentshire/issues) for something that interests you
- Open an Issue or Discussion to share ideas
- Fork → PR — contributions of any size are welcome
- Reach us: `hello@agentshire.dev` · [@AgentshireDev](https://x.com/AgentshireDev)

---

> *This roadmap will keep evolving. But one thing won't change:*  
> *You can't build high on an unstable foundation. First, let everyone walk into their town reliably. Then, together, we'll build a world worth living in.*
