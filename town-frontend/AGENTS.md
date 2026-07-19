# Town Frontend Development Rules

> Rules for AI assistants working on `town-frontend/`. Read before any UI/style/text change.

## Brand Color Palette

All UI components MUST use these colors. Never invent new accent colors.

| Token | Value | Usage |
|---|---|---|
| `--app-brand-primary` | `#D4A574` | Primary accent (toggles, active states, icons) |
| `--app-brand-secondary` | `#E7DDCC` | Secondary text, subtle highlights |
| `--gradient-primary` | `linear-gradient(135deg, #C4915E, #D4A574)` | Buttons, progress bars, key CTAs |
| `--accent-gold` | `#ffd700` | Sparingly for emphasis |

**Button styles:**
- Primary button: `background: linear-gradient(135deg, #C4915E, #D4A574); color: #000; font-weight: 600/700`
- Hover: `filter: brightness(1.1)` or `brightness(1.15)`
- Toggle ON: `background: #D4A574`
- Toggle OFF: `background: rgba(255,255,255,0.15)`

**Panel/card background** (dark theme):
- `background: rgba(30,30,30,0.96)` with `border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; backdrop-filter: blur(10px)`
- Text: `#eee` / `#fff` for headings, `rgba(255,255,255,0.85)` for body, `rgba(255,255,255,0.5)` for secondary
- Row dividers: `1px solid rgba(255,255,255,0.06)`

**Forbidden colors:** Do NOT use `#45E796`, `#667eea`, `#764ba2`, or any green/purple as accent. These do not belong to the brand palette.

## i18n (Internationalization)

All user-visible strings MUST go through the i18n system. Never hardcode Chinese or English text in code.

### How to use

```typescript
import { t, getLocale } from '../i18n'

// Simple key lookup
t('settings.title')        // → "设置" or "Settings"

// With template variables
t('npc.greeting', { name: 'Yan' })  // → "岩 打招呼" or "Yan greets"

// For module-level constants that depend on locale, use lazy getters:
function getLabels() {
  return getLocale() === 'en' ? LABELS_EN : LABELS_ZH
}
// Do NOT use getLocale() in top-level const — it runs before initLocale().
```

### Adding new strings

1. Add key to `src/i18n/zh-CN.ts` (Chinese)
2. Add same key to `src/i18n/en.ts` (English)
3. English UI text should be concise to avoid layout overflow/line breaks

### Dialogue / voice pools

- Chinese dialogues: `src/npc/DialogueScripts.ts`, `src/game/minigame/TroubleGame.ts`
- English dialogues: `src/i18n/dialogue-en.ts`, `src/i18n/trouble-en.ts`
- Use lazy getter pattern: `function getVoicePool() { return getLocale() === 'en' ? VOICE_EN : VOICE_ZH }`

### Default character data

- Live data: `src/data/town-defaults.json` (overwritten by user publish — do NOT modify for i18n)
- Chinese reference: `src/data/town-defaults.ref-zh.json` (static, never modified)
- English reference: `src/data/town-defaults.en.json` (static, never modified)
- Translation logic: `translateDefaultField()` in `TownConfig.ts` — compares actual value against both ref files

### Settings panel

Settings UI is in `src/ui/SettingsPanel.ts`. Language switch requires Save button click → `location.reload()`. No immediate application of changes.

The Settings panel includes three boolean toggles (persisted in `localStorage` key `town-settings`):
- **背景音乐** (`music`, default `true`) — toggles BGM playback.
- **灵魂模式** (`soulMode`, default `true`) — enables soul-file-driven persona for citizens.
- **动物模式** (`animalMode`, default `true`) — enables the Animal Mode autonomy system (`AnimalModeManager`). When enabled, `main.ts` calls `scene.setAnimalModeEnabled(true)` which boots the `AutonomyEngine` / `NeedsEngine` / `MoodEngine` / `RelationshipEngine` loop. Citizens are registered into the needs engine on spawn (`MainScene.onNpcSpawn` → `animalMode.registerCitizen(npcId)`) so the L2 decision loop has citizens to act on. When disabled, citizens remain visible but stop autonomous behavior.

### Town lazy-loading

The app defaults to the `#chat` route on open (`App.tsx` `getTabFromHash()`). The Town 3D scene iframe (`TownView.tsx`) only loads `town.html` (setting `iframe.src`) on the **first** time the Town tab becomes visible; a `loaded` state then locks the iframe mounted so subsequent tab switches are instant. This avoids initializing the 3D engine / WebSocket / assets when the user only wants to chat.

### Agent Models Panel

Per-agent LLM model proxy management UI is in `src/app/AgentModelsPanel.tsx` (React, rendered inside the Claw Settings view). It manages each resident's `agents.list[]` entry: primary model + fallbacks, identity (name, emoji), thinking/reasoning defaults, context tokens, subagent timeout, group-chat history limit. Reads/writes via `get-agent-config` / `update-agent-config` Claw API routes in `editor-serve.ts`.

### Claw Settings View

The Claw Settings panel (`src/app/ClawSettingsView.tsx`, ~2700 lines) is the in-app OpenClaw runtime config UI with 11 left-nav sections:

| Nav | Sections | Component |
|---|---|---|
| 通用设置 (General) | Gateway mode, subagent timeout, default model, agent count | `GeneralPanel` |
| 系统 (System) | Logging, Update, Diagnostics, Audit | `AdvancedPanel group="system"` |
| 消息 (Messaging) | Session, Messages, Commands, Cron | `AdvancedPanel group="messaging"` |
| 工具 (Tools) | Browser, Tools, Web, Media, MCP | `AdvancedPanel group="tools"` |
| AI | Talk/Voice, Transcripts, Commitments, Broadcast, ACP | `AdvancedPanel group="ai"` |
| 网络 (Network) | Memory, Proxy, Env, Hooks, UI | `AdvancedPanel group="network"` |
| 代理管理 (Providers) | Per-agent model proxy | `AgentModelsPanel` |
| 模型管理 (Models) | LLM provider/model CRUD | `ModelPanel` |
| 插件配置 (Plugin) | Plugin enable/bundled discovery | inline |
| 会话列表 (Sessions) | Live session/token-usage inspection | inline |
| 关于 (About) | Version info | inline |

`AdvancedPanel` accepts a `group` prop ('system' | 'messaging' | 'tools' | 'ai' | 'network') and conditionally renders the corresponding sections. A shared `advProps` object (defined before the return statement) is spread into all 5 `AdvancedPanel` calls to avoid repeating ~100 config state variables.

All `useState` default values are aligned with the actual `openclaw.json` values (not schema defaults, since most core config sections have no schema `default` property). The config is loaded from and saved to `openclaw.json` via `config/load` and `config/save` Claw API routes in `editor-serve.ts`.

`noSaveSections = ['sessions', 'about', 'models', 'providers']` — these sections don't trigger the Save button (they have their own data management).
