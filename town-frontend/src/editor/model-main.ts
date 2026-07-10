import { initLocale, getLocale } from '../i18n'
initLocale()

import '../styles/editor.css'
import '../styles/model-manager.css'
import { ModelManager } from './model/ModelManager'
import { ModelManagerView } from './model/ModelManagerView'

declare global {
  interface Window {
    locale?: string;
  }
}
window.locale = getLocale();

async function boot() {
  applyEditorLocale()

  const manager = new ModelManager()
  const view = new ModelManagerView(manager, document.getElementById('model-manager')!)

  /* ── Toolbar: Undo / Redo ── */
  const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement | null
  const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement | null
  const updateUndoRedoBtns = () => {
    if (undoBtn) undoBtn.disabled = !manager.canUndo
    if (redoBtn) redoBtn.disabled = !manager.canRedo
  }
  updateUndoRedoBtns()
  undoBtn?.addEventListener('click', () => { manager.undo(); updateUndoRedoBtns() })
  redoBtn?.addEventListener('click', () => { manager.redo(); updateUndoRedoBtns() })
  manager.onConfigChanged(updateUndoRedoBtns)

  /* ── Toolbar: Save ── */
  const saveBtn = document.getElementById('btn-save')
  const flashSaveBtn = (text: string) => {
    if (!saveBtn) return
    saveBtn.classList.add('save-flash')
    const origText = saveBtn.lastChild as Text
    const prev = origText.textContent
    origText.textContent = text
    setTimeout(() => { saveBtn.classList.remove('save-flash'); origText.textContent = prev }, 1200)
  }
  const doSave = async () => {
    const ok = await manager.save()
    flashSaveBtn(ok ? (getLocale() === 'en' ? ' Saved' : ' 已保存') : (getLocale() === 'en' ? ' Failed' : ' 保存失败'))
  }
  saveBtn?.addEventListener('click', doSave)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave() }
  })

  /* ── Load initial data ── */
  await manager.load()
  view.render()
}

boot().catch(console.error)

function applyEditorLocale(): void {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!
    const translated = (window as any).__t ? (window as any).__t(key) : key
    if (translated !== key) el.textContent = translated
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')!
    const translated = (window as any).__t ? (window as any).__t(key) : key
    if (translated !== key) el.setAttribute('title', translated)
  })
}
