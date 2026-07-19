// @desc Type-safe window debug bindings for console debugging
declare global {
  interface Window {
    __gameClock?: Record<string, unknown>
    __journals?: Record<string, unknown>
    __mode?: Record<string, unknown>
    __encounter?: Record<string, unknown>
    __daily?: Record<string, unknown>
    __townJournal?: Record<string, unknown>
    __weather?: Record<string, unknown>
    __audio?: Record<string, unknown>
    __trouble?: Record<string, unknown>
    __crowd?: Record<string, unknown>
  }
}

export function installDebugBindings(bindings: {
  gameClock?: Record<string, unknown>
  journals?: Record<string, unknown>
  mode?: Record<string, unknown>
  encounter?: Record<string, unknown>
  daily?: Record<string, unknown>
  townJournal?: Record<string, unknown>
  weather?: Record<string, unknown>
  audio?: Record<string, unknown>
  trouble?: Record<string, unknown>
  crowd?: Record<string, unknown>
}): void {
  if (bindings.gameClock) window.__gameClock = bindings.gameClock
  if (bindings.journals) window.__journals = bindings.journals
  if (bindings.mode) window.__mode = bindings.mode
  if (bindings.encounter) window.__encounter = bindings.encounter
  if (bindings.daily) window.__daily = bindings.daily
  if (bindings.townJournal) window.__townJournal = bindings.townJournal
  if (bindings.weather) window.__weather = bindings.weather
  if (bindings.audio) window.__audio = bindings.audio
  if (bindings.trouble) window.__trouble = bindings.trouble
  if (bindings.crowd) window.__crowd = bindings.crowd
}

export function removeDebugBindings(): void {
  delete window.__gameClock
  delete window.__journals
  delete window.__mode
  delete window.__encounter
  delete window.__daily
  delete window.__townJournal
  delete window.__weather
  delete window.__audio
  delete window.__trouble
  delete window.__crowd
}
