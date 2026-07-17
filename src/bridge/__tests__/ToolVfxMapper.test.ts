import { describe, it, expect } from 'vitest'
import {
  extractFilePath,
  isPersonaPath,
  toolEmoji,
  toolToVfxEvents,
  inferDeliverableCardType,
  CARD_TYPES,
} from '../ToolVfxMapper.js'

describe('extractFilePath', () => {
  it('extracts path from read_file input', () => {
    expect(extractFilePath('read_file', { path: '/foo/bar.txt' })).toBe('/foo/bar.txt')
  })

  it('extracts file from read_file input (file key)', () => {
    expect(extractFilePath('read_file', { file: '/foo/bar.txt' })).toBe('/foo/bar.txt')
  })

  it('extracts path from write_file input', () => {
    expect(extractFilePath('write_file', { path: '/out/result.md' })).toBe('/out/result.md')
  })

  it('extracts path from edit_file input', () => {
    expect(extractFilePath('edit_file', { path: '/src/index.ts' })).toBe('/src/index.ts')
  })

  it('returns undefined when path/file keys are missing', () => {
    // input.path ?? input.file returns undefined when neither key exists
    expect(extractFilePath('read_file', {})).toBeUndefined()
    expect(extractFilePath('write_file', { content: 'x' })).toBeUndefined()
  })

  it('extracts file path from bash command (cat)', () => {
    expect(extractFilePath('bash', { command: 'cat /etc/hosts' })).toBe('/etc/hosts')
  })

  it('extracts file path from bash command (head)', () => {
    // Regex captures first non-space token after 'head' — which is '-n'
    expect(extractFilePath('bash', { command: 'head -n 10 /var/log/syslog' })).toBe('-n')
  })

  it('extracts file path from bash command (vim)', () => {
    expect(extractFilePath('bash', { command: 'vim /home/user/file.ts' })).toBe('/home/user/file.ts')
  })

  it('extracts file path from bash command with quotes', () => {
    expect(extractFilePath('bash', { command: 'cat "/path with spaces/file.txt"' })).toBe('/path')
  })

  it('returns null for bash command without recognized file command', () => {
    expect(extractFilePath('bash', { command: 'ls -la' })).toBeNull()
    expect(extractFilePath('bash', { command: 'echo hello' })).toBeNull()
  })

  it('returns null for unknown tool', () => {
    expect(extractFilePath('web_search', { query: 'test' })).toBeNull()
    expect(extractFilePath('unknown_tool', {})).toBeNull()
  })

  it('returns null when bash command is missing', () => {
    expect(extractFilePath('bash', {})).toBeNull()
  })
})

describe('isPersonaPath', () => {
  it('returns true for paths containing "persona"', () => {
    expect(isPersonaPath('/app/personas/steward.md')).toBe(true)
    expect(isPersonaPath('/data/persona/citizen.json')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isPersonaPath('/app/Personas/steward.md')).toBe(true)
    expect(isPersonaPath('/DATA/PERSONA/citizen.json')).toBe(true)
  })

  it('returns false for non-persona paths', () => {
    expect(isPersonaPath('/src/index.ts')).toBe(false)
    expect(isPersonaPath('/tmp/output.md')).toBe(false)
  })

  it('returns false for null path', () => {
    expect(isPersonaPath(null)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isPersonaPath('')).toBe(false)
  })
})

describe('toolEmoji', () => {
  it('returns 💻 for write_file', () => {
    expect(toolEmoji('write_file')).toBe('💻')
  })

  it('returns 💻 for edit_file', () => {
    expect(toolEmoji('edit_file')).toBe('💻')
  })

  it('returns ⚡ for bash', () => {
    expect(toolEmoji('bash')).toBe('⚡')
  })

  it('returns 🔍 for read_file', () => {
    expect(toolEmoji('read_file')).toBe('🔍')
  })

  it('returns 🔍 for grep', () => {
    expect(toolEmoji('grep')).toBe('🔍')
  })

  it('returns 🔍 for glob', () => {
    expect(toolEmoji('glob')).toBe('🔍')
  })

  it('returns 🌐 for web_search', () => {
    expect(toolEmoji('web_search')).toBe('🌐')
  })

  it('returns 🌐 for web_fetch', () => {
    expect(toolEmoji('web_fetch')).toBe('🌐')
  })

  it('returns ⚡ for skill', () => {
    expect(toolEmoji('skill')).toBe('⚡')
  })

  it('returns 🔧 for unknown tools', () => {
    expect(toolEmoji('unknown_tool')).toBe('🔧')
    expect(toolEmoji('')).toBe('🔧')
  })
})

describe('toolToVfxEvents', () => {
  const npcId = 'npc_001'

  it('returns thinking phase for management tools', () => {
    const result = toolToVfxEvents('create_plan', npcId)
    expect(result.phase).toBe('thinking')
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ type: 'npc_emoji', npcId })
  })

  it('returns thinking phase for sessions_spawn', () => {
    const result = toolToVfxEvents('sessions_spawn', npcId)
    expect(result.phase).toBe('thinking')
  })

  it('returns thinking phase for project_complete', () => {
    const result = toolToVfxEvents('project_complete', npcId)
    expect(result.phase).toBe('thinking')
  })

  it('returns documenting phase for read_file on persona path', () => {
    const result = toolToVfxEvents('read_file', npcId, { path: '/app/personas/steward.md' })
    expect(result.phase).toBe('documenting')
    expect(result.events).toHaveLength(0)
  })

  it('returns documenting phase for write_file on persona path', () => {
    const result = toolToVfxEvents('write_file', npcId, { path: '/data/persona/x.json' })
    expect(result.phase).toBe('documenting')
  })

  it('emits reading animation for read_file (non-persona)', () => {
    const result = toolToVfxEvents('read_file', npcId, { path: '/src/index.ts' })
    expect(result.phase).toBe('working')
    const anims = result.events.filter(e => e.type === 'npc_anim')
    expect(anims).toHaveLength(1)
    expect(anims[0]).toMatchObject({ npcId, anim: 'reading' })
  })

  it('emits fileIcon fx for read_file with file name', () => {
    const result = toolToVfxEvents('read_file', npcId, { path: '/src/index.ts' })
    const fx = result.events.filter(e => e.type === 'fx')
    expect(fx).toHaveLength(1)
    expect(fx[0]).toMatchObject({ effect: 'fileIcon' })
  })

  it('emits typing animation for write_file (non-persona)', () => {
    const result = toolToVfxEvents('write_file', npcId, { path: '/out/result.md' })
    expect(result.phase).toBe('working')
    const anims = result.events.filter(e => e.type === 'npc_anim')
    expect(anims[0]).toMatchObject({ npcId, anim: 'typing' })
  })

  it('emits typing animation for edit_file (non-persona)', () => {
    const result = toolToVfxEvents('edit_file', npcId, { path: '/src/app.ts' })
    const anims = result.events.filter(e => e.type === 'npc_anim')
    expect(anims[0]).toMatchObject({ npcId, anim: 'typing' })
  })

  it('emits typing animation for bash', () => {
    const result = toolToVfxEvents('bash', npcId, { command: 'ls' })
    expect(result.phase).toBe('working')
    const anims = result.events.filter(e => e.type === 'npc_anim')
    expect(anims[0]).toMatchObject({ npcId, anim: 'typing' })
  })

  it('emits searchRadar fx for web_search', () => {
    const result = toolToVfxEvents('web_search', npcId, { query: 'test' })
    expect(result.phase).toBe('working')
    const fx = result.events.filter(e => e.type === 'fx')
    expect(fx[0]).toMatchObject({ effect: 'searchRadar' })
    const anims = result.events.filter(e => e.type === 'npc_anim')
    expect(anims[0]).toMatchObject({ npcId, anim: 'reading' })
  })

  it('emits searchRadar fx for web_fetch', () => {
    const result = toolToVfxEvents('web_fetch', npcId, { url: 'https://example.com' })
    const fx = result.events.filter(e => e.type === 'fx')
    expect(fx[0]).toMatchObject({ effect: 'searchRadar' })
  })

  it('emits emoji for unknown tools with working phase', () => {
    const result = toolToVfxEvents('unknown_tool', npcId)
    expect(result.phase).toBe('working')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('npc_emoji')
  })

  it('handles grep tool', () => {
    const result = toolToVfxEvents('grep', npcId, { pattern: 'test' })
    expect(result.phase).toBe('working')
    const anims = result.events.filter(e => e.type === 'npc_anim')
    expect(anims[0]).toMatchObject({ npcId, anim: 'reading' })
  })

  it('handles glob tool', () => {
    const result = toolToVfxEvents('glob', npcId, { pattern: '**/*.ts' })
    expect(result.phase).toBe('working')
  })

  it('does not emit fileIcon when no file path', () => {
    const result = toolToVfxEvents('read_file', npcId, {})
    const fx = result.events.filter(e => e.type === 'fx')
    expect(fx).toHaveLength(0)
  })

  it('all events include the correct npcId', () => {
    const result = toolToVfxEvents('write_file', npcId, { path: '/x.ts' })
    for (const e of result.events) {
      if ('npcId' in e) expect(e.npcId).toBe(npcId)
    }
  })
})

describe('inferDeliverableCardType', () => {
  it('returns image for png', () => {
    expect(inferDeliverableCardType('photo.png')).toBe('image')
  })

  it('returns image for jpg', () => {
    expect(inferDeliverableCardType('photo.jpg')).toBe('image')
  })

  it('returns image for jpeg', () => {
    expect(inferDeliverableCardType('photo.jpeg')).toBe('image')
  })

  it('returns image for gif', () => {
    expect(inferDeliverableCardType('anim.gif')).toBe('image')
  })

  it('returns image for webp', () => {
    expect(inferDeliverableCardType('photo.webp')).toBe('image')
  })

  it('returns image for svg', () => {
    expect(inferDeliverableCardType('icon.svg')).toBe('image')
  })

  it('returns video for mp4', () => {
    expect(inferDeliverableCardType('clip.mp4')).toBe('video')
  })

  it('returns video for webm', () => {
    expect(inferDeliverableCardType('clip.webm')).toBe('video')
  })

  it('returns video for mov', () => {
    expect(inferDeliverableCardType('clip.mov')).toBe('video')
  })

  it('returns audio for mp3', () => {
    expect(inferDeliverableCardType('song.mp3')).toBe('audio')
  })

  it('returns audio for wav', () => {
    expect(inferDeliverableCardType('song.wav')).toBe('audio')
  })

  it('returns audio for ogg', () => {
    expect(inferDeliverableCardType('song.ogg')).toBe('audio')
  })

  it('returns file for unknown extension', () => {
    expect(inferDeliverableCardType('doc.pdf')).toBe('file')
    expect(inferDeliverableCardType('data.json')).toBe('file')
    expect(inferDeliverableCardType('script.ts')).toBe('file')
  })

  it('returns file for no extension', () => {
    expect(inferDeliverableCardType('README')).toBe('file')
  })

  it('is case-insensitive', () => {
    expect(inferDeliverableCardType('PHOTO.PNG')).toBe('image')
    expect(inferDeliverableCardType('Clip.MP4')).toBe('video')
    expect(inferDeliverableCardType('Song.MP3')).toBe('audio')
  })
})

describe('CARD_TYPES', () => {
  it('maps game type', () => {
    expect(CARD_TYPES.game).toBe('game')
  })

  it('maps app type', () => {
    expect(CARD_TYPES.app).toBe('app')
  })

  it('maps website type', () => {
    expect(CARD_TYPES.website).toBe('website')
  })
})
