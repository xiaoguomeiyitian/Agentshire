import { describe, it, expect, beforeEach } from 'vitest'
import { MoodAnimator } from '../MoodAnimator'
import type { MoodLevel } from '../MoodEngine'

describe('MoodAnimator', () => {
  let animator: MoodAnimator

  beforeEach(() => {
    animator = new MoodAnimator()
  })

  it('maps great mood to cheer animation', () => {
    const anim = animator.getAnimation('great')
    expect(anim.anim).toBe('cheer')
    expect(anim.stateLabel).toBe('心情极好')
  })

  it('maps neutral mood to idle animation', () => {
    const anim = animator.getAnimation('neutral')
    expect(anim.anim).toBe('idle')
  })

  it('maps terrible mood to frustrated animation', () => {
    const anim = animator.getAnimation('terrible')
    expect(anim.anim).toBe('frustrated')
  })

  it('supports English locale', () => {
    const anim = animator.getAnimation('great', 'en')
    expect(anim.stateLabel).toBe('Great')
  })

  it('builds prompt fragment in Chinese', () => {
    const fragment = animator.buildPromptFragment('good', 35, 'zh-CN')
    expect(fragment).toContain('心情不错')
    expect(fragment).toContain('35')
  })

  it('builds prompt fragment in English', () => {
    const fragment = animator.buildPromptFragment('bad', -30, 'en')
    expect(fragment).toContain('Bad')
    expect(fragment).toContain('-30')
  })

  it('all mood levels have valid animations', () => {
    const levels: MoodLevel[] = ['great', 'good', 'neutral', 'bad', 'terrible']
    for (const level of levels) {
      const anim = animator.getAnimation(level)
      expect(anim.anim).toBeTruthy()
      expect(anim.stateLabel).toBeTruthy()
    }
  })
})
