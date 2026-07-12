import { t } from '../i18n'

export interface SettingsState {
  language: string
  music: boolean
  soulMode: boolean
}

const SETTINGS_KEY = 'agentshire_settings'
const ACCENT = '#D4A574'

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      return {
        language: s.language ?? 'zh-CN',
        music: s.music !== false,
        soulMode: s.soulMode !== false,
      }
    }
  } catch { /* ignore */ }
  return { language: 'zh-CN', music: true, soulMode: true }
}

export function saveSettings(state: SettingsState): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state))
}

export function showSettingsPanel(opts: {
  onMusicChange: (enabled: boolean) => void
  onSoulModeChange: (enabled: boolean) => void
  onReset: () => void
}): void {
  if (document.getElementById('agentshire-settings-overlay')) return

  const saved = loadSettings()
  const draft: SettingsState = { ...saved }
  let dirty = false

  const overlay = document.createElement('div')
  overlay.id = 'agentshire-settings-overlay'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '75',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  })

  const card = document.createElement('div')
  Object.assign(card.style, {
    background: 'rgba(30,30,30,0.96)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '20px', padding: '20px 24px', width: '320px', maxWidth: '90vw',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    color: '#eee',
  })

  const title = document.createElement('div')
  Object.assign(title.style, { fontSize: '16px', fontWeight: '700', marginBottom: '18px', color: '#fff' })
  title.textContent = t('settings.title')
  card.appendChild(title)

  // ── Helpers ──

  const markDirty = () => {
    dirty = true
    saveBtn.style.opacity = '1'
    saveBtn.style.cursor = 'pointer'
  }

  const createRow = (label: string, right: HTMLElement): HTMLElement => {
    const row = document.createElement('div')
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
    })
    const labelEl = document.createElement('div')
    Object.assign(labelEl.style, { fontSize: '14px', color: 'rgba(255,255,255,0.85)' })
    labelEl.textContent = label
    row.appendChild(labelEl)
    row.appendChild(right)
    return row
  }

  const createToggle = (initial: boolean, onChange: (v: boolean) => void): HTMLElement => {
    let on = initial
    const btn = document.createElement('button')
    Object.assign(btn.style, {
      width: '44px', height: '24px', borderRadius: '12px', border: 'none',
      cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
      background: on ? ACCENT : 'rgba(255,255,255,0.15)', flexShrink: '0',
    })
    const thumb = document.createElement('span')
    Object.assign(thumb.style, {
      position: 'absolute', top: '2px', width: '20px', height: '20px',
      borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
      left: on ? '22px' : '2px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    })
    btn.appendChild(thumb)
    btn.addEventListener('click', () => {
      on = !on
      btn.style.background = on ? ACCENT : 'rgba(255,255,255,0.15)'
      thumb.style.left = on ? '22px' : '2px'
      onChange(on)
    })
    return btn
  }

  // ── Language pill toggle ──

  const pillWrap = document.createElement('div')
  Object.assign(pillWrap.style, {
    display: 'flex', borderRadius: '10px', overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.12)', flexShrink: '0',
  })

  const langOptions: { value: string; label: string }[] = [
    { value: 'zh-CN', label: '中文' },
    { value: 'en', label: 'EN' },
  ]

  const pillBtns: HTMLButtonElement[] = []
  for (const opt of langOptions) {
    const btn = document.createElement('button')
    const active = opt.value === draft.language
    Object.assign(btn.style, {
      padding: '4px 14px', fontSize: '13px', fontWeight: '500',
      border: 'none', cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
      background: active ? ACCENT : 'transparent',
      color: active ? '#fff' : 'rgba(255,255,255,0.5)',
    })
    btn.textContent = opt.label
    btn.addEventListener('click', () => {
      draft.language = opt.value
      for (const b of pillBtns) {
        const isActive = b === btn
        b.style.background = isActive ? ACCENT : 'transparent'
        b.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.5)'
      }
      markDirty()
    })
    pillBtns.push(btn)
    pillWrap.appendChild(btn)
  }

  card.appendChild(createRow(t('settings.language'), pillWrap))

  // ── Music toggle ──

  card.appendChild(createRow(t('settings.music'), createToggle(draft.music, (v) => {
    draft.music = v
    markDirty()
  })))

  // ── Bottom buttons: Cancel + Save ──

  const btnRow = document.createElement('div')
  Object.assign(btnRow.style, {
    display: 'flex', gap: '10px', marginTop: '20px', paddingTop: '14px',
  })

  const cancelBtn = document.createElement('button')
  Object.assign(cancelBtn.style, {
    flex: '1', padding: '10px 0', borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
    color: 'rgba(255,255,255,0.6)', fontSize: '13px', fontWeight: '500',
    cursor: 'pointer', transition: 'background 0.15s',
  })
  cancelBtn.textContent = t('settings.cancel')
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'rgba(255,255,255,0.05)' })
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent' })
  cancelBtn.addEventListener('click', close)

  const saveBtn = document.createElement('button')
  Object.assign(saveBtn.style, {
    flex: '1', padding: '10px 0', borderRadius: '12px',
    border: 'none', background: 'linear-gradient(135deg, #C4915E, #D4A574)',
    color: '#000', fontSize: '13px', fontWeight: '600',
    cursor: 'default', opacity: '0.4', transition: 'opacity 0.15s, filter 0.15s',
  })
  saveBtn.textContent = t('settings.save')
  saveBtn.addEventListener('mouseenter', () => { if (dirty) saveBtn.style.filter = 'brightness(1.1)' })
  saveBtn.addEventListener('mouseleave', () => { if (dirty) saveBtn.style.filter = 'none' })
  saveBtn.addEventListener('click', () => {
    if (!dirty) return
    saveSettings(draft)
    if (draft.music !== saved.music) opts.onMusicChange(draft.music)
    if (draft.soulMode !== saved.soulMode) opts.onSoulModeChange(draft.soulMode)
    if (draft.language !== saved.language) {
      location.reload()
      return
    }
    close()
  })

  btnRow.appendChild(cancelBtn)
  btnRow.appendChild(saveBtn)
  card.appendChild(btnRow)

  overlay.appendChild(card)
  document.body.appendChild(overlay)

  function close() {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  document.addEventListener('keydown', onKey)
}
