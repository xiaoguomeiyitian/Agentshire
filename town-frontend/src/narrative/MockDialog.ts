import { getMockReplies } from '../types'

export class MockDialog {
  private greeted = false
  private gameRequested = false

  matchReply(userText: string): { reply: string; event: string | null } {
    const text = userText.toLowerCase()
    const replies = getMockReplies()

    if (!this.greeted) {
      this.greeted = true
      return { reply: replies.greeting[0], event: null }
    }

    if (!this.gameRequested && (text.includes('游戏') || text.includes('做') || text.includes('想做') || text.includes('game') || text.includes('想要'))) {
      this.gameRequested = true
      const gameReplies = replies.game_request
      return { reply: gameReplies[Math.floor(Math.random() * gameReplies.length)], event: 'summon_team' }
    }

    if (text.includes('进展') || text.includes('怎么样') || text.includes('progress')) {
      return { reply: replies.progress[0], event: null }
    }

    if (text.includes('带我') || text.includes('逛逛') || text.includes('tour')) {
      const tourReplies = replies.tour
      return { reply: tourReplies[Math.floor(Math.random() * tourReplies.length)], event: 'tour' }
    }

    if (text.includes('回工坊') || text.includes('回去') || text.includes('office')) {
      return { reply: replies.return_office[0], event: 'return_office' }
    }

    const fallbacks = replies.fallback
    return { reply: fallbacks[Math.floor(Math.random() * fallbacks.length)], event: null }
  }

  markGreeted(): void { this.greeted = true }
  hasRequestedGame(): boolean { return this.gameRequested }
  reset(): void { this.greeted = false; this.gameRequested = false }
}
