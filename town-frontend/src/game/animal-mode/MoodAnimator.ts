/**
 * MoodAnimator — maps a citizen's mood level to an animation/state.
 *
 * Mood influences the NPC's idle animation and dialogue tone:
 *   great/good  -> cheer / wave (lively)
 *   neutral     -> idle (default)
 *   bad         -> frustrated (slumped)
 *   terrible    -> frustrated (slumped)
 *
 * This is used by AutonomyEngine (Phase 3) when a citizen is idle and
 * not actively satisfying a need — their idle animation reflects mood.
 */

import type { MoodLevel } from './MoodEngine'

export interface MoodAnimation {
  anim: string          // animation name to play
  stateLabel: string   // human-readable state for UI
}

const MOOD_ANIM_MAP: Record<MoodLevel, MoodAnimation> = {
  great:     { anim: 'cheer',      stateLabel: '心情极好' },
  good:      { anim: 'wave',       stateLabel: '心情不错' },
  neutral:   { anim: 'idle',       stateLabel: '平静' },
  bad:       { anim: 'frustrated', stateLabel: '心情低落' },
  terrible:  { anim: 'frustrated', stateLabel: '心情糟糕' },
}

const MOOD_ANIM_MAP_EN: Record<MoodLevel, MoodAnimation> = {
  great:     { anim: 'cheer',      stateLabel: 'Great' },
  good:      { anim: 'wave',       stateLabel: 'Good' },
  neutral:   { anim: 'idle',       stateLabel: 'Neutral' },
  bad:       { anim: 'frustrated', stateLabel: 'Bad' },
  terrible:  { anim: 'frustrated', stateLabel: 'Terrible' },
}

export class MoodAnimator {
  /** Get the animation + label for a mood level. */
  getAnimation(level: MoodLevel, locale: 'zh-CN' | 'en' = 'zh-CN'): MoodAnimation {
    const map = locale === 'en' ? MOOD_ANIM_MAP_EN : MOOD_ANIM_MAP
    return map[level]
  }

  /** Build a mood description fragment for LLM dialogue prompts. */
  buildPromptFragment(level: MoodLevel, value: number, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
    const anim = this.getAnimation(level, locale)
    if (locale === 'en') {
      return `Current mood: ${anim.stateLabel} (mood value ${value.toFixed(0)}). Adjust your dialogue tone accordingly.`
    }
    return `当前心情：${anim.stateLabel}（心情值 ${value.toFixed(0)}）。请据此调整对话语气。`
  }
}
