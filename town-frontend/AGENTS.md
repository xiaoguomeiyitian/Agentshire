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
t('workflow.briefing', { name: 'Yan' })  // → "岩 收到任务" or "Yan received task"

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

- Chinese dialogues: `src/npc/DialogueScripts.ts`, `src/game/minigame/BanweiGame.ts`
- English dialogues: `src/i18n/dialogue-en.ts`, `src/i18n/banwei-en.ts`
- Use lazy getter pattern: `function getVoicePool() { return getLocale() === 'en' ? VOICE_EN : VOICE_ZH }`

### Default character data

- Live data: `src/data/town-defaults.json` (overwritten by user publish — do NOT modify for i18n)
- Chinese reference: `src/data/town-defaults.ref-zh.json` (static, never modified)
- English reference: `src/data/town-defaults.en.json` (static, never modified)
- Translation logic: `translateDefaultField()` in `TownConfig.ts` — compares actual value against both ref files

### Settings panel

Settings UI is in `src/ui/SettingsPanel.ts`. Language switch requires Save button click → `location.reload()`. No immediate application of changes.

The Settings panel also includes a **Citizen Auto-Walk** toggle (`autoWalk: boolean`, default `true`). When toggled, a `CustomEvent('town-auto-walk-change', { detail: { enabled } })` is dispatched (and posted to the town iframe via `postMessage`); `main.ts` listens and calls `scene.setAutoWalkEnabled(enabled)`, which iterates all `DailyBehavior` instances calling `behavior.setAutoWalkEnabled()`. When disabled, NPCs stop scheduling new walks but **stay visible** at their current positions; sleeping NPCs are woken immediately. Toggling does not remove any NPC from the map.

### Town lazy-loading

The app defaults to the `#chat` route on open (`App.tsx` `getTabFromHash()`). The Town 3D scene iframe (`TownView.tsx`) only loads `town.html` (setting `iframe.src`) on the **first** time the Town tab becomes visible; a `loaded` state then locks the iframe mounted so subsequent tab switches are instant. This avoids initializing the 3D engine / WebSocket / assets when the user only wants to chat.

### Agent Models Panel

Per-agent LLM model proxy management UI is in `src/app/AgentModelsPanel.tsx` (React, rendered inside the Claw Settings view). It manages each resident's `agents.list[]` entry: primary model + fallbacks, identity (name, emoji), thinking/reasoning defaults, context tokens, subagent timeout, group-chat history limit. Reads/writes via `get-agent-config` / `update-agent-config` Claw API routes in `editor-serve.ts`.
