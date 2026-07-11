export type CoverStyleId =
  | 'cyberpunk' | 'fantasy' | 'scifi' | 'retro' | 'minimalist'
  | 'action' | 'cozy' | 'anime' | 'puzzle' | 'adventure'

export interface CoverStyleMeta {
  id: CoverStyleId
  label: string
}

export const COVER_STYLES: CoverStyleMeta[] = [
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'fantasy', label: 'Dark Fantasy' },
  { id: 'scifi', label: 'Deep Space' },
  { id: 'retro', label: 'Arcade Pixel' },
  { id: 'minimalist', label: 'Indie Minimal' },
  { id: 'action', label: 'Action Strike' },
  { id: 'cozy', label: 'Cozy Sim' },
  { id: 'anime', label: 'Anime RPG' },
  { id: 'puzzle', label: 'Sweet Puzzle' },
  { id: 'adventure', label: 'Epic Adventure' },
]

const FONTS: Record<CoverStyleId, string> = {
  cyberpunk:   'var(--font-cover-tech)',
  fantasy:     'var(--font-cover-elegant)',
  scifi:       'var(--font-cover-tech)',
  retro:       'var(--font-cover-retro)',
  minimalist:  'var(--font-cover-modern)',
  action:      'var(--font-cover-retro)',
  cozy:        'var(--font-cover-rounded)',
  anime:       'var(--font-cover-tech)',
  puzzle:      'var(--font-cover-rounded)',
  adventure:   'var(--font-cover-rounded)',
}

function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

const usedStyles = new Set<CoverStyleId>()

export function pickStyleForGame(gameName: string): CoverStyleId {
  if (usedStyles.size >= COVER_STYLES.length) usedStyles.clear()

  const hash = hashString(gameName)
  const startIdx = hash % COVER_STYLES.length
  for (let offset = 0; offset < COVER_STYLES.length; offset++) {
    const candidate = COVER_STYLES[(startIdx + offset) % COVER_STYLES.length].id
    if (!usedStyles.has(candidate)) {
      usedStyles.add(candidate)
      return candidate
    }
  }
  return COVER_STYLES[startIdx].id
}

export function renderCover(styleId: CoverStyleId, gameName: string): string {
  const name = gameName.replace(/\n/g, '<br>')
  const font = FONTS[styleId]
  switch (styleId) {
    case 'cyberpunk':   return coverCyberpunk(name, font)
    case 'fantasy':     return coverFantasy(name, font)
    case 'scifi':       return coverScifi(name, font)
    case 'retro':       return coverRetro(name, font)
    case 'minimalist':  return coverMinimalist(name, font)
    case 'action':      return coverAction(name, font)
    case 'cozy':        return coverCozy(name, font)
    case 'anime':       return coverAnime(name, font)
    case 'puzzle':      return coverPuzzle(name, font)
    case 'adventure':   return coverAdventure(name, font)
  }
}

function coverCyberpunk(name: string, font: string): string {
  return `<div class="relative w-full h-full bg-zinc-950 overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font}">
    <div class="absolute inset-0 opacity-20" style="background-image:linear-gradient(#0ff 1px,transparent 1px),linear-gradient(90deg,#0ff 1px,transparent 1px);background-size:30px 30px;background-position:center"></div>
    <div class="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent via-zinc-950/60 to-zinc-950"></div>
    <div class="absolute top-5 left-0 w-20 h-2 bg-yellow-400 skew-x-[-45deg] -translate-x-2 shadow-[0_0_15px_rgba(250,204,21,0.5)]"></div>
    <div class="absolute top-8 left-0 w-10 h-0.5 bg-yellow-400 skew-x-[-45deg] -translate-x-1"></div>
    <div class="absolute bottom-14 right-0 w-28 h-2.5 bg-fuchsia-500 skew-x-[45deg] translate-x-2 shadow-[0_0_15px_rgba(217,70,239,0.5)]"></div>
    <div class="absolute bottom-11 right-0 w-14 h-0.5 bg-fuchsia-500 skew-x-[45deg] translate-x-1"></div>
    <div class="z-10 flex flex-col items-center w-full px-1">
      <h1 class="text-4xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-white to-fuchsia-500 font-black italic text-center uppercase leading-tight mb-2 break-words w-full" style="filter:drop-shadow(0 0 8px rgba(0,255,255,0.6))">${name}</h1>
    </div>
    <div class="absolute bottom-4 text-cyan-400 text-[9px] tracking-[0.5em] uppercase font-bold" style="filter:drop-shadow(0 0 8px rgba(34,211,238,0.8))">OpenClaw</div>
  </div>`
}

function coverFantasy(name: string, font: string): string {
  return `<div class="relative w-full h-full bg-slate-950 overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font}">
    <div class="absolute inset-0" style="background:radial-gradient(circle at center,rgba(88,28,135,0.5),#020617 70%)"></div>
    <div class="absolute inset-4 border border-amber-500/30 rounded-lg"></div>
    <div class="absolute inset-5 border border-amber-500/10 rounded-lg"></div>
    <div class="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-amber-400/80"></div>
    <div class="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-amber-400/80"></div>
    <div class="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-amber-400/80"></div>
    <div class="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-amber-400/80"></div>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] aspect-square border-[0.5px] border-purple-500/20 rounded-full"></div>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] aspect-square border border-dashed border-amber-500/20 rounded-full"></div>
    <div class="z-10 flex flex-col items-center gap-2 w-full px-2">
      <h1 class="text-4xl text-amber-100 font-bold text-center leading-tight tracking-wide break-words w-full" style="text-shadow:0 0 20px rgba(245,158,11,0.6),0 4px 8px rgba(0,0,0,0.9)">${name}</h1>
    </div>
    <div class="absolute bottom-12 flex items-center gap-4 w-full justify-center px-10">
      <div class="h-px flex-1 bg-gradient-to-r from-transparent to-amber-500/50"></div>
      <div class="w-2 h-2 rotate-45 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]"></div>
      <div class="h-px flex-1 bg-gradient-to-l from-transparent to-amber-500/50"></div>
    </div>
    <div class="absolute bottom-7 text-amber-500/70 text-[9px] tracking-[0.4em] uppercase">OpenClaw</div>
  </div>`
}

function coverScifi(name: string, font: string): string {
  return `<div class="relative w-full h-full bg-[#030712] overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font}">
    <div class="absolute inset-0 opacity-60" style="background-image:radial-gradient(1.5px 1.5px at 20px 30px,#fff,transparent),radial-gradient(1.5px 1.5px at 40px 70px,#fff,transparent),radial-gradient(1.5px 1.5px at 50px 160px,#fff,transparent),radial-gradient(1.5px 1.5px at 90px 40px,#fff,transparent),radial-gradient(1.5px 1.5px at 130px 80px,#fff,transparent);background-size:200px 200px"></div>
    <div class="absolute -top-32 -right-32 w-96 h-96 bg-blue-600 rounded-full opacity-40" style="filter:blur(100px)"></div>
    <div class="absolute -bottom-32 -left-32 w-96 h-96 bg-indigo-600 rounded-full opacity-30" style="filter:blur(100px)"></div>
    <div class="absolute top-1/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent"></div>
    <div class="absolute bottom-1/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent"></div>
    <div class="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border border-blue-500/20 rounded-full"></div>
    <div class="z-10 flex flex-col items-center mt-8 w-full px-2">
      <h1 class="text-4xl text-white font-bold text-center uppercase leading-tight break-words w-full" style="text-shadow:0 0 20px rgba(59,130,246,0.8),0 0 40px rgba(59,130,246,0.4)">${name}</h1>
    </div>
    <div class="absolute bottom-6 text-blue-400 text-[9px] tracking-[0.5em] font-mono uppercase">OpenClaw</div>
  </div>`
}

function coverRetro(name: string, font: string): string {
  return `<div class="relative w-full h-full bg-indigo-950 overflow-hidden flex flex-col items-center justify-center" style="font-family:${font}">
    <div class="absolute inset-0 pointer-events-none z-20 opacity-30" style="background-image:linear-gradient(transparent 50%,rgba(0,0,0,0.8) 50%);background-size:100% 6px"></div>
    <div class="absolute top-6 left-1/2 -translate-x-1/2 w-24 h-24 bg-gradient-to-b from-yellow-300 via-orange-500 to-pink-600 rounded-full shadow-[0_0_40px_rgba(236,72,153,0.5)]">
      <div class="absolute bottom-1 w-full h-0.5 bg-indigo-950"></div>
      <div class="absolute bottom-3 w-full h-1 bg-indigo-950"></div>
      <div class="absolute bottom-5 w-full h-1.5 bg-indigo-950"></div>
      <div class="absolute bottom-8 w-full h-2 bg-indigo-950"></div>
      <div class="absolute bottom-11 w-full h-2.5 bg-indigo-950"></div>
    </div>
    <div class="absolute bottom-0 left-0 w-full h-1/3 bg-indigo-950" style="background-image:linear-gradient(transparent 90%,#ec4899 90%),linear-gradient(90deg,transparent 90%,#ec4899 90%);background-size:40px 20px;transform:perspective(200px) rotateX(60deg);transform-origin:top"></div>
    <div class="z-10 flex flex-col items-center justify-center w-full px-3">
      <h1 class="text-4xl font-bold text-white text-center leading-tight break-words w-full" style="text-shadow:3px 3px 0 #ec4899,-3px -3px 0 #3b82f6">${name}</h1>
    </div>
    <div class="absolute bottom-5 text-yellow-400 text-[8px] animate-pulse z-30 tracking-widest">OpenClaw</div>
  </div>`
}

function coverMinimalist(name: string, font: string): string {
  return `<div class="relative w-full h-full bg-[#F7F5F0] overflow-hidden flex flex-col items-center justify-center p-4" style="font-family:${font}">
    <div class="absolute top-1/4 left-1/4 w-48 h-48 bg-rose-200 rounded-full opacity-80" style="filter:blur(40px);mix-blend-mode:multiply"></div>
    <div class="absolute top-1/3 right-1/4 w-48 h-48 bg-teal-200 rounded-full opacity-80" style="filter:blur(40px);mix-blend-mode:multiply"></div>
    <div class="absolute bottom-1/4 left-1/3 w-40 h-40 bg-amber-100 rounded-full opacity-80" style="filter:blur(40px);mix-blend-mode:multiply"></div>
    <div class="z-10 flex flex-col items-center w-full px-1">
      <h1 class="text-4xl text-slate-800 font-light text-center tracking-wide uppercase mb-2 break-words w-full">${name}</h1>
    </div>
    <div class="absolute bottom-12 flex flex-col items-center gap-3">
      <div class="w-px h-10 bg-slate-300"></div>
      <div class="text-slate-400 text-[8px] tracking-[0.3em] uppercase font-semibold">OpenClaw</div>
    </div>
  </div>`
}

function coverAction(name: string, font: string): string {
  return `<div class="relative w-full h-full bg-zinc-900 overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font}">
    <div class="absolute inset-0 bg-red-600" style="clip-path:polygon(0 0,100% 0,100% 55%,0 45%)"></div>
    <div class="absolute inset-0 opacity-20" style="mix-blend-mode:overlay;background-image:radial-gradient(#000 2px,transparent 2px);background-size:8px 8px"></div>
    <div class="absolute top-0 left-0 w-full h-full pointer-events-none" style="box-shadow:inset 0 0 80px rgba(0,0,0,0.8)"></div>
    <div class="absolute bottom-0 left-0 w-full h-5" style="background-image:repeating-linear-gradient(-45deg,#eab308,#eab308 15px,#000 15px,#000 30px)"></div>
    <div class="absolute top-0 left-0 w-full h-2" style="background-image:repeating-linear-gradient(-45deg,#eab308,#eab308 15px,#000 15px,#000 30px)"></div>
    <div class="z-10 flex flex-col items-center w-full px-1" style="transform:rotate(-6deg) scale(1.1)">
      <h1 class="text-4xl text-white text-center uppercase leading-tight break-words w-full" style="text-shadow:6px 6px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000">${name}</h1>
    </div>
    <div class="absolute bottom-10 text-white/50 text-lg font-bold italic tracking-widest">OpenClaw</div>
  </div>`
}

function coverCozy(name: string, font: string): string {
  return `<div class="relative w-full h-full overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font};background:linear-gradient(to bottom,#d1fae5,#f0fdfa)">
    <div class="absolute top-8 right-8 w-24 h-24 bg-yellow-200 rounded-full opacity-60" style="filter:blur(20px);mix-blend-mode:multiply"></div>
    <div class="absolute top-16 left-6 w-36 h-12 bg-white rounded-full opacity-80" style="filter:blur(8px)"></div>
    <div class="absolute bottom-24 right-8 w-40 h-14 bg-white rounded-full opacity-80" style="filter:blur(8px)"></div>
    <div class="absolute -top-4 -left-4 w-20 h-20 bg-emerald-300 rounded-br-full opacity-50"></div>
    <div class="absolute bottom-0 right-0 w-24 h-24 bg-teal-300 rounded-tl-full opacity-50"></div>
    <div class="z-10 flex flex-col items-center w-full">
      <h1 class="text-4xl text-emerald-900 font-bold text-center leading-tight break-words w-full" style="text-shadow:0 4px 12px rgba(255,255,255,0.8),0 0 4px rgba(255,255,255,1)">${name}</h1>
    </div>
    <div class="absolute bottom-8 text-emerald-700/60 font-bold tracking-widest uppercase text-xs">OpenClaw</div>
  </div>`
}

function coverAnime(name: string, font: string): string {
  return `<div class="relative w-full h-full overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font};background:linear-gradient(to bottom right,#d946ef,#a855f7,#06b6d4)">
    <div class="absolute inset-0 opacity-20" style="background:repeating-conic-gradient(from 0deg, transparent 0 10deg, #fff 10deg 20deg)"></div>
    <div class="absolute inset-0 opacity-30" style="mix-blend-mode:overlay;background-image:radial-gradient(#fff 2px,transparent 2px);background-size:16px 16px"></div>
    <div class="absolute top-16 right-16 text-white text-2xl animate-pulse">✦</div>
    <div class="absolute bottom-24 left-12 text-white text-xl animate-pulse">✦</div>
    <div class="absolute top-1/3 left-8 text-white text-lg animate-pulse">✧</div>
    <div class="z-10 flex flex-col items-center w-full px-2" style="transform:rotate(-2deg)">
      <h1 class="text-4xl text-white text-center uppercase leading-tight break-words w-full" style="text-shadow:4px 4px 0 #4c1d95,8px 8px 0 #000">${name}</h1>
    </div>
    <div class="absolute bottom-8 bg-black text-white px-4 py-1 text-[9px] tracking-widest border-l-4 border-cyan-400" style="transform:skewX(-12deg)">OpenClaw</div>
  </div>`
}

function coverPuzzle(name: string, font: string): string {
  return `<div class="relative w-full h-full overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font};background:linear-gradient(to bottom right,#f9a8d4,#c084fc,#818cf8)">
    <div class="absolute top-8 left-8 w-12 h-12 bg-white/30 rounded-full border border-white/50" style="backdrop-filter:blur(4px)"></div>
    <div class="absolute bottom-16 right-10 w-20 h-20 bg-white/20 rounded-full border border-white/50" style="backdrop-filter:blur(4px)"></div>
    <div class="absolute top-1/3 right-6 w-8 h-8 bg-white/40 rounded-full border border-white/50" style="backdrop-filter:blur(4px)"></div>
    <div class="absolute bottom-1/3 left-5 w-11 h-11 bg-white/25 rounded-full border border-white/50" style="backdrop-filter:blur(4px)"></div>
    <div class="absolute inset-0 opacity-10" style="background-image:repeating-linear-gradient(45deg,transparent,transparent 20px,#fff 20px,#fff 40px)"></div>
    <div class="z-10 flex flex-col items-center w-full px-2">
      <h1 class="text-4xl text-white font-bold text-center leading-tight break-words w-full" style="-webkit-text-stroke:2px #d946ef;text-shadow:0 8px 16px rgba(217,70,239,0.5),0 4px 4px rgba(0,0,0,0.1)">${name}</h1>
    </div>
    <div class="absolute bottom-6 bg-white/90 text-fuchsia-600 px-5 py-1.5 rounded-full font-bold text-xs border-2 border-fuchsia-200" style="box-shadow:0 4px 12px rgba(0,0,0,0.1)">OpenClaw</div>
  </div>`
}

function coverAdventure(name: string, font: string): string {
  return `<div class="relative w-full h-full overflow-hidden flex flex-col items-center justify-center p-3" style="font-family:${font};background:linear-gradient(to bottom,#C4915E,#D4A574)">
    <div class="absolute top-0 left-1/2 -translate-x-1/2 w-[200%] h-[200%] opacity-20" style="background:repeating-conic-gradient(from 0deg, transparent 0 15deg, #fff 15deg 30deg)"></div>
    <div class="absolute -bottom-16 -left-12 w-40 h-40 bg-amber-400 rounded-full"></div>
    <div class="absolute -bottom-24 -right-12 w-52 h-52 bg-amber-500 rounded-full"></div>
    <div class="absolute -bottom-32 left-1/4 w-56 h-56 bg-amber-600 rounded-full"></div>
    <div class="absolute top-6 left-6 w-14 h-4 bg-white/80 rounded-full" style="filter:blur(2px)"></div>
    <div class="absolute top-12 right-8 w-16 h-5 bg-white/60 rounded-full" style="filter:blur(2px)"></div>
    <div class="z-10 flex flex-col items-center w-full px-2 mb-8">
      <h1 class="text-4xl text-white font-black text-center uppercase leading-tight break-words w-full" style="text-shadow:0 4px 0 #8B6332,0 8px 16px rgba(0,0,0,0.3)">${name}</h1>
    </div>
    <div class="absolute bottom-6 text-emerald-50 font-bold tracking-[0.2em] uppercase text-xs" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3))">OpenClaw</div>
  </div>`
}
