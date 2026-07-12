import type { PlacedItem, BuildingPlacement, Rotation, GroupDef, LightPointDef, LightType } from './TownMapConfig'
import { genId } from './TownMapConfig'
import type { TownEditor } from './TownEditor'
import type { Command } from './UndoStack'
import { getLocale } from '../i18n'

const SVG_ROTATE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 13.72A10 10 0 1 1 18.57 4.93L21.5 8"/></svg>'
const SVG_FLIP_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M16 7l4 5-4 5"/><path d="M8 7l-4 5 4 5"/></svg>'
const SVG_FLIP_Z = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M7 8L12 4l5 4"/><path d="M7 16l5 4 5-4"/></svg>'
const SVG_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>'

// X (horizontal) alignment icons - vertical reference line + horizontal rects
const SVG_ALIGN_LEFT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="2" x2="4" y2="22"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>'
const SVG_ALIGN_CENTER_H = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><rect x="4" y="6" width="16" height="4" rx="1"/><rect x="6" y="14" width="12" height="4" rx="1"/></svg>'
const SVG_ALIGN_RIGHT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="20" y1="2" x2="20" y2="22"/><rect x="4" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>'
const SVG_DISTRIBUTE_H = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="4" height="14" rx="1"/><rect x="10" y="5" width="4" height="14" rx="1"/><rect x="16" y="5" width="4" height="14" rx="1"/></svg>'

// Y (vertical) alignment icons - horizontal reference line + vertical rects
const SVG_ALIGN_TOP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="4" x2="22" y2="4"/><rect x="6" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>'
const SVG_ALIGN_CENTER_V = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="12" x2="22" y2="12"/><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="6" width="4" height="12" rx="1"/></svg>'
const SVG_ALIGN_BOTTOM = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="20" x2="22" y2="20"/><rect x="6" y="4" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>'
const SVG_DISTRIBUTE_V = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="4" width="14" height="4" rx="1"/><rect x="5" y="10" width="14" height="4" rx="1"/><rect x="5" y="16" width="14" height="4" rx="1"/></svg>'

// Z (elevation) alignment icons - same as Y but with left-side tick marks for height axis
const SVG_ALIGN_Z_TOP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="4" x2="4" y2="4"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="2" y1="20" x2="4" y2="20"/><line x1="6" y1="4" x2="22" y2="4"/><rect x="10" y="8" width="4" height="12" rx="1"/><rect x="16" y="8" width="4" height="8" rx="1"/></svg>'
const SVG_ALIGN_Z_MID = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="4" x2="4" y2="4"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="2" y1="20" x2="4" y2="20"/><line x1="6" y1="12" x2="22" y2="12"/><rect x="10" y="4" width="4" height="16" rx="1"/><rect x="16" y="6" width="4" height="12" rx="1"/></svg>'
const SVG_ALIGN_Z_BOT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="4" x2="4" y2="4"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="2" y1="20" x2="4" y2="20"/><line x1="6" y1="20" x2="22" y2="20"/><rect x="10" y="4" width="4" height="12" rx="1"/><rect x="16" y="8" width="4" height="8" rx="1"/></svg>'
const SVG_DISTRIBUTE_Z = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="4" x2="6" y2="4"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="2" y1="20" x2="6" y2="20"/><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="9" y="10" width="6" height="4" rx="1"/><rect x="9" y="18" width="6" height="4" rx="1"/></svg>'

export class PropertyInspector {
  private el: HTMLElement
  private editor: TownEditor
  private currentItemId: string | null = null

  constructor(el: HTMLElement, editor: TownEditor) {
    this.el = el
    this.editor = editor
    this.initTooltip()
  }

  private initTooltip(): void {
    const tip = document.createElement('div')
    tip.className = 'pi-tooltip'
    document.body.appendChild(tip)

    this.el.addEventListener('pointerenter', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null
      if (!btn) return
      tip.textContent = btn.dataset.tip!
      tip.classList.add('visible')
      const rect = btn.getBoundingClientRect()
      tip.style.left = `${rect.left + rect.width / 2}px`
      tip.style.top = `${rect.top - 6}px`
    }, true)

    this.el.addEventListener('pointerleave', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null
      if (btn) tip.classList.remove('visible')
    }, true)
  }

  private isStale(itemId: string): boolean {
    return this.currentItemId !== itemId
  }

  update(item: PlacedItem | null): void {
    if (!item) {
      this.el.classList.remove('visible')
      this.currentItemId = null
      return
    }
    this.el.classList.add('visible')
    this.el.innerHTML = ''
    this.currentItemId = item.data.id

    const d = item.data

    this.addTitle(getLocale() === 'en' ? 'Properties' : '资产属性')
    this.addInfoRow(getLocale() === 'en' ? 'Model' : '模型', d.modelKey)
    if (item.kind === 'building') {
      this.addInfoRow(getLocale() === 'en' ? 'Size' : '尺寸', `${(d as BuildingPlacement).widthCells}×${(d as BuildingPlacement).depthCells}`)
    }

    this.addDivider()
    this.addPositionAndTransformRows(item)

    this.addDivider()
    this.addSectionTitle(getLocale() === 'en' ? 'Scale' : '缩放')
    this.addScaleSlider(item)

    this.addDivider()
    this.addLightSection(item)

    if (item.kind === 'prop') {
      this.addDivider()
      this.addAnimationSection(item)
    }

    this.addDivider()
    this.addDeleteButton()
  }

  updateMulti(items: PlacedItem[]): void {
    if (items.length === 0) {
      this.el.classList.remove('visible')
      this.currentItemId = null
      return
    }
    if (items.length === 1) {
      this.update(items[0])
      return
    }

    const scene = this.editor.editorScene
    const firstGroup = scene.findGroupForItem(items[0].data.id)
    const allSameGroup = firstGroup && items.every(it => {
      const g = scene.findGroupForItem(it.data.id)
      return g && g.id === firstGroup.id
    })

    if (allSameGroup && firstGroup && !scene.isInsideGroup) {
      this.showGroupPanel(firstGroup, items)
      return
    }

    this.el.classList.add('visible')
    this.el.innerHTML = ''
    this.currentItemId = null

    this.addTitle(getLocale() === 'en' ? `Multi-select (${items.length})` : `多选属性 (${items.length} 个资产)`)

    this.addDivider()
    this.addSectionTitle(getLocale() === 'en' ? 'Align' : '对齐')
    this.addAlignmentSection(items)

    this.addDivider()
    this.addSectionTitle(getLocale() === 'en' ? 'Rotate' : '旋转')
    this.addMultiTransformSection(items)

    this.addDivider()
    this.addMultiScaleSection(items)

    this.addDivider()
    this.addMultiActionButtons(items)
  }

  private showGroupPanel(group: GroupDef, items: PlacedItem[]): void {
    this.el.classList.add('visible')
    this.el.innerHTML = ''
    this.currentItemId = null

    this.addTitle(getLocale() === 'en' ? `Group (${group.memberIds.length})` : `组合属性 (${group.memberIds.length} 个成员)`)

    const hint = document.createElement('div')
    hint.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px;'
    hint.textContent = getLocale() === 'en' ? 'Double-click to edit group' : '双击进入编辑组合内模型'
    this.el.appendChild(hint)

    this.addDivider()

    const posRow = document.createElement('div')
    posRow.className = 'pi-angle-row'
    posRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">X</span>
        <input type="number" class="pi-num-input" id="pi-gx" value="${group.anchorX}" step="1" />
      </div>
      <div class="pi-num-field">
        <span class="pi-num-label">Y</span>
        <input type="number" class="pi-num-input" id="pi-gz" value="${group.anchorZ}" step="1" />
      </div>
    `
    this.el.appendChild(posRow)

    const elevRow = document.createElement('div')
    elevRow.className = 'pi-angle-row'
    const elev = group.elevation ?? 0
    elevRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">Z</span>
        <input type="number" class="pi-num-input" id="pi-gelev" value="${elev}" step="0.1" />
      </div>
      <div class="pi-transform-btns">
        <button class="pi-icon-btn" id="pg-snap" data-tip="${getLocale() === 'en' ? 'Snap to top' : '吸附：放到目标顶部'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="M8 6l4-4 4 4"/><rect x="4" y="14" width="16" height="6" rx="1"/></svg>
        </button>
        <button class="pi-icon-btn" id="pg-join" data-tip="${getLocale() === 'en' ? 'Join side' : '拼接：贴到目标侧面'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="8" height="12" rx="1"/><rect x="14" y="6" width="8" height="12" rx="1"/><path d="M10 12h4"/><path d="M12 10l2 2-2 2"/></svg>
        </button>
        <button class="pi-icon-btn" id="pg-ground" data-tip="${getLocale() === 'en' ? 'Ground' : '落地：重置到地面'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18v-8"/><path d="M8 14l4 4 4-4"/><line x1="4" y1="22" x2="20" y2="22"/></svg>
        </button>
      </div>
    `
    this.el.appendChild(elevRow)

    const angleRow = document.createElement('div')
    angleRow.className = 'pi-angle-row'
    angleRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">∠</span>
        <input type="number" class="pi-num-input" id="pi-gangle" value="0" step="90" disabled />
      </div>
      <div class="pi-transform-btns">
        <button class="pi-icon-btn" data-tip="${getLocale() === 'en' ? 'Rotate Group 90°' : '整组旋转 90°'}" id="pg-rotate">${SVG_ROTATE}</button>
        <button class="pi-icon-btn" data-tip="${getLocale() === 'en' ? 'Flip Group H' : '整组水平翻转'}" id="pg-flipx">${SVG_FLIP_X}</button>
        <button class="pi-icon-btn" data-tip="${getLocale() === 'en' ? 'Flip Group V' : '整组垂直翻转'}" id="pg-flipz">${SVG_FLIP_Z}</button>
      </div>
    `
    this.el.appendChild(angleRow)

    this.addDivider()
    this.addSectionTitle(getLocale() === 'en' ? 'Scale' : '缩放')
    const scaleRow = document.createElement('div')
    scaleRow.className = 'pi-scale-row'
    scaleRow.innerHTML = `
      <button class="pi-scale-btn" id="pg-sminus">−</button>
      <input type="range" class="pi-scale-range" id="pg-srange" min="0.05" max="5" step="0.05" value="1" />
      <button class="pi-scale-btn" id="pg-splus">+</button>
      <input type="number" class="pi-scale-num" id="pg-snum" min="0.05" max="5" step="0.05" value="1" />
    `
    this.el.appendChild(scaleRow)

    this.addDivider()

    const actionWrap = document.createElement('div')
    actionWrap.className = 'pi-group-btns'
    const ungroupBtn = document.createElement('button')
    ungroupBtn.className = 'pi-group-btn btn-primary'
    ungroupBtn.textContent = getLocale() === 'en' ? 'Ungroup' : '取消组合'
    ungroupBtn.addEventListener('click', () => this.editor.ungroupSelected())
    actionWrap.appendChild(ungroupBtn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pi-group-btn'
    delBtn.innerHTML = `${SVG_DELETE} ${getLocale() === 'en' ? 'Delete Group' : '删除组合'}`
    delBtn.style.color = 'var(--status-error)'
    delBtn.style.borderColor = 'rgba(255,68,102,0.2)'
    delBtn.addEventListener('click', () => this.editor.deleteSelected())
    actionWrap.appendChild(delBtn)
    this.el.appendChild(actionWrap)

    // Event bindings
    const scene = this.editor.editorScene
    const gxInput = posRow.querySelector('#pi-gx') as HTMLInputElement
    const gzInput = posRow.querySelector('#pi-gz') as HTMLInputElement
    const gelevInput = elevRow.querySelector('#pi-gelev') as HTMLInputElement

    const moveGroup = (newAnchorX: number, newAnchorZ: number) => {
      const dx = newAnchorX - group.anchorX
      const dz = newAnchorZ - group.anchorZ
      if (dx === 0 && dz === 0) return
      const prevAX = group.anchorX, prevAZ = group.anchorZ
      const prevPositions = items.map(it => ({ x: it.data.gridX, z: it.data.gridZ }))
      const cmd: Command = {
        execute: () => {
          group.anchorX = newAnchorX; group.anchorZ = newAnchorZ
          items.forEach(it => { it.data.gridX += dx; it.data.gridZ += dz; scene.updateModelTransform(it) })
          scene.setSelection(items)
          this.showGroupPanel(group, items)
        },
        undo: () => {
          group.anchorX = prevAX; group.anchorZ = prevAZ
          items.forEach((it, i) => { it.data.gridX = prevPositions[i].x; it.data.gridZ = prevPositions[i].z; scene.updateModelTransform(it) })
          scene.setSelection(items)
          this.showGroupPanel(group, items)
        },
      }
      this.editor.undoStack.push(cmd)
    }

    gxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = parseInt(gxInput.value); if (!isNaN(v)) moveGroup(v, group.anchorZ); gxInput.blur() }
      if (e.key === 'Escape') { gxInput.value = String(group.anchorX); gxInput.blur() }
    })
    gxInput.addEventListener('blur', () => { gxInput.value = String(group.anchorX) })
    gzInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = parseInt(gzInput.value); if (!isNaN(v)) moveGroup(group.anchorX, v); gzInput.blur() }
      if (e.key === 'Escape') { gzInput.value = String(group.anchorZ); gzInput.blur() }
    })
    gzInput.addEventListener('blur', () => { gzInput.value = String(group.anchorZ) })

    const moveGroupElev = (newElev: number) => {
      const prevElev = group.elevation ?? 0
      const delta = newElev - prevElev
      if (delta === 0) return
      const prevElevations = items.map(it => (it.data as { elevation?: number }).elevation ?? 0)
      const cmd: Command = {
        execute: () => {
          group.elevation = newElev || undefined
          items.forEach(it => {
            const d = it.data as { elevation?: number }
            d.elevation = Math.round(((d.elevation ?? 0) + delta) * 10) / 10 || undefined
            scene.updateModelTransform(it)
          })
          scene.setSelection(items)
          this.showGroupPanel(group, items)
        },
        undo: () => {
          group.elevation = prevElev || undefined
          items.forEach((it, i) => {
            (it.data as { elevation?: number }).elevation = prevElevations[i] || undefined
            scene.updateModelTransform(it)
          })
          scene.setSelection(items)
          this.showGroupPanel(group, items)
        },
      }
      this.editor.undoStack.push(cmd)
    }
    gelevInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = parseFloat(gelevInput.value); if (!isNaN(v)) moveGroupElev(Math.round(v * 10) / 10); gelevInput.blur() }
      if (e.key === 'Escape') { gelevInput.value = String(group.elevation ?? 0); gelevInput.blur() }
    })
    gelevInput.addEventListener('blur', () => { gelevInput.value = String(group.elevation ?? 0) })

    elevRow.querySelector('#pg-ground')?.addEventListener('click', () => moveGroupElev(0))

    // Snap: move entire group on top of target
    elevRow.querySelector('#pg-snap')?.addEventListener('click', () => {
      const dummyItem = items[0]
      scene.enterSnapMode(dummyItem, (newX, newZ, newElev) => {
        const dx = newX - group.anchorX
        const dz = newZ - group.anchorZ
        const prevAX = group.anchorX, prevAZ = group.anchorZ, prevElev = group.elevation ?? 0
        const prevPositions = items.map(it => ({ x: it.data.gridX, z: it.data.gridZ }))
        const prevElevations = items.map(it => (it.data as { elevation?: number }).elevation ?? 0)
        const cmd: Command = {
          execute: () => {
            group.anchorX += dx; group.anchorZ += dz; group.elevation = newElev || undefined
            const elevDelta = newElev - prevElev
            items.forEach(it => {
              it.data.gridX += dx; it.data.gridZ += dz
              const d = it.data as { elevation?: number }
              d.elevation = Math.round(((d.elevation ?? 0) + elevDelta) * 10) / 10 || undefined
              scene.updateModelTransform(it)
            })
            scene.setSelection(items); this.showGroupPanel(group, items)
          },
          undo: () => {
            group.anchorX = prevAX; group.anchorZ = prevAZ; group.elevation = prevElev || undefined
            items.forEach((it, i) => {
              it.data.gridX = prevPositions[i].x; it.data.gridZ = prevPositions[i].z
              ;(it.data as { elevation?: number }).elevation = prevElevations[i] || undefined
              scene.updateModelTransform(it)
            })
            scene.setSelection(items); this.showGroupPanel(group, items)
          },
        }
        this.editor.undoStack.push(cmd)
      })
    })

    // Join: move entire group adjacent to target
    elevRow.querySelector('#pg-join')?.addEventListener('click', () => {
      const dummyItem = items[0]
      scene.enterJoinMode(dummyItem, (newX, newZ) => {
        const dx = newX - group.anchorX
        const dz = newZ - group.anchorZ
        if (dx === 0 && dz === 0) return
        const prevAX = group.anchorX, prevAZ = group.anchorZ
        const prevPositions = items.map(it => ({ x: it.data.gridX, z: it.data.gridZ }))
        const cmd: Command = {
          execute: () => {
            group.anchorX += dx; group.anchorZ += dz
            items.forEach(it => { it.data.gridX += dx; it.data.gridZ += dz; scene.updateModelTransform(it) })
            scene.setSelection(items); this.showGroupPanel(group, items)
          },
          undo: () => {
            group.anchorX = prevAX; group.anchorZ = prevAZ
            items.forEach((it, i) => { it.data.gridX = prevPositions[i].x; it.data.gridZ = prevPositions[i].z; scene.updateModelTransform(it) })
            scene.setSelection(items); this.showGroupPanel(group, items)
          },
        }
        this.editor.undoStack.push(cmd)
      })
    })

    angleRow.querySelector('#pg-rotate')?.addEventListener('click', () => {
      items.forEach(it => scene.rotateItem(it))
      this.showGroupPanel(group, items)
    })
    angleRow.querySelector('#pg-flipx')?.addEventListener('click', () => {
      items.forEach(it => scene.flipItemX(it))
    })
    angleRow.querySelector('#pg-flipz')?.addEventListener('click', () => {
      items.forEach(it => scene.flipItemZ(it))
    })

    const sRange = scaleRow.querySelector('#pg-srange') as HTMLInputElement
    const sNum = scaleRow.querySelector('#pg-snum') as HTMLInputElement
    const applyGroupScale = (factor: number) => {
      items.forEach(it => {
        const d = it.data as { scale?: number }
        d.scale = Math.max(0.05, Math.min(5, Math.round((d.scale ?? 1) * factor * 100) / 100))
        scene.updateModelTransform(it)
      })
      scene.setSelection(items)
    }
    scaleRow.querySelector('#pg-sminus')?.addEventListener('click', () => applyGroupScale(0.9))
    scaleRow.querySelector('#pg-splus')?.addEventListener('click', () => applyGroupScale(1.1))
    sRange.addEventListener('input', () => { sNum.value = sRange.value })
    sRange.addEventListener('change', () => {
      const factor = parseFloat(sRange.value)
      if (!isNaN(factor) && factor > 0) applyGroupScale(factor)
      sRange.value = '1'; sNum.value = '1'
    })
  }

  private addAlignmentSection(items: PlacedItem[]): void {
    const section = document.createElement('div')
    section.className = 'pi-align-section'

    const axes: { label: string; axis: 'x' | 'y' | 'z'; distSvg: string; buttons: { mode: 'min' | 'center' | 'max'; tip: string; svg: string }[] }[] = [
      {
        label: 'X', axis: 'x', distSvg: SVG_DISTRIBUTE_H,
        buttons: [
          { mode: 'min', tip: getLocale() === 'en' ? 'Align Left' : '左对齐', svg: SVG_ALIGN_LEFT },
          { mode: 'center', tip: getLocale() === 'en' ? 'Center H' : '水平居中', svg: SVG_ALIGN_CENTER_H },
          { mode: 'max', tip: getLocale() === 'en' ? 'Align Right' : '右对齐', svg: SVG_ALIGN_RIGHT },
        ],
      },
      {
        label: 'Y', axis: 'y', distSvg: SVG_DISTRIBUTE_V,
        buttons: [
          { mode: 'min', tip: getLocale() === 'en' ? 'Align Top' : '上对齐', svg: SVG_ALIGN_TOP },
          { mode: 'center', tip: getLocale() === 'en' ? 'Center V' : '垂直居中', svg: SVG_ALIGN_CENTER_V },
          { mode: 'max', tip: getLocale() === 'en' ? 'Align Bottom' : '下对齐', svg: SVG_ALIGN_BOTTOM },
        ],
      },
      {
        label: 'Z', axis: 'z', distSvg: SVG_DISTRIBUTE_Z,
        buttons: [
          { mode: 'max', tip: getLocale() === 'en' ? 'Top' : '顶对齐', svg: SVG_ALIGN_Z_TOP },
          { mode: 'center', tip: getLocale() === 'en' ? 'Center Z' : '高度居中', svg: SVG_ALIGN_Z_MID },
          { mode: 'min', tip: getLocale() === 'en' ? 'Bottom' : '底对齐', svg: SVG_ALIGN_Z_BOT },
        ],
      },
    ]

    for (const row of axes) {
      const rowEl = document.createElement('div')
      rowEl.className = 'pi-align-row'

      const label = document.createElement('span')
      label.className = 'pi-align-label'
      label.textContent = row.label
      rowEl.appendChild(label)

      const btns = document.createElement('div')
      btns.className = 'pi-align-btns'

      for (const b of row.buttons) {
        const btn = document.createElement('button')
        btn.className = 'pi-icon-btn'
        btn.innerHTML = b.svg
        btn.dataset.tip = b.tip
        btn.addEventListener('click', () => {
          this.editor.editorScene.alignItems(items, row.axis, b.mode)
        })
        btns.appendChild(btn)
      }

      const distBtn = document.createElement('button')
      distBtn.className = 'pi-icon-btn'
      distBtn.innerHTML = row.distSvg
      distBtn.dataset.tip = getLocale() === 'en' ? `Distribute ${row.label}` : `${row.label} 等距分布`
      distBtn.addEventListener('click', () => {
        this.editor.editorScene.distributeItems(items, row.axis)
      })
      btns.appendChild(distBtn)

      rowEl.appendChild(btns)
      section.appendChild(rowEl)
    }

    this.el.appendChild(section)
  }

  private addMultiTransformSection(items: PlacedItem[]): void {
    const row = document.createElement('div')
    row.className = 'pi-angle-row'

    const angleField = document.createElement('div')
    angleField.className = 'pi-num-field'
    angleField.innerHTML = `<span class="pi-num-label">∠</span><span class="pi-value" style="font-size:12px;color:var(--text-dim)">—</span>`
    row.appendChild(angleField)

    const btns = document.createElement('div')
    btns.className = 'pi-transform-btns'

    const rotBtn = document.createElement('button')
    rotBtn.className = 'pi-icon-btn'
    rotBtn.innerHTML = SVG_ROTATE
    rotBtn.dataset.tip = getLocale() === 'en' ? 'Rotate All 90°' : '全部旋转 90°'
    rotBtn.addEventListener('click', () => {
      this.editor.rotateSelected()
      this.updateMulti(items)
    })
    btns.appendChild(rotBtn)

    const flipXBtn = document.createElement('button')
    flipXBtn.className = 'pi-icon-btn'
    flipXBtn.innerHTML = SVG_FLIP_X
    flipXBtn.dataset.tip = getLocale() === 'en' ? 'Flip All H' : '全部水平翻转'
    flipXBtn.addEventListener('click', () => {
      for (const it of items) this.editor.editorScene.flipItemX(it)
    })
    btns.appendChild(flipXBtn)

    const flipZBtn = document.createElement('button')
    flipZBtn.className = 'pi-icon-btn'
    flipZBtn.innerHTML = SVG_FLIP_Z
    flipZBtn.dataset.tip = getLocale() === 'en' ? 'Flip All V' : '全部垂直翻转'
    flipZBtn.addEventListener('click', () => {
      for (const it of items) this.editor.editorScene.flipItemZ(it)
    })
    btns.appendChild(flipZBtn)

    row.appendChild(btns)
    this.el.appendChild(row)
  }

  private addMultiScaleSection(items: PlacedItem[]): void {
    this.addSectionTitle(getLocale() === 'en' ? 'Scale' : '缩放')
    const row = document.createElement('div')
    row.className = 'pi-scale-row'
    row.innerHTML = `
      <button class="pi-scale-btn" id="pi-ms-minus">−</button>
      <input type="range" class="pi-scale-range" id="pi-ms-range" min="0.05" max="5" step="0.05" value="1" />
      <button class="pi-scale-btn" id="pi-ms-plus">+</button>
      <span class="pi-value" style="width:50px;text-align:center;font-size:12px;color:var(--text-dim)">—</span>
    `
    this.el.appendChild(row)

    const range = row.querySelector('#pi-ms-range') as HTMLInputElement

    const applyDelta = (delta: number) => {
      for (const it of items) {
        const d = it.data as { scale?: number }
        const prev = d.scale ?? 1
        d.scale = Math.max(0.05, Math.min(5, Math.round((prev + delta) * 100) / 100))
        this.editor.editorScene.updateModelTransform(it)
      }
      this.editor.editorScene.setSelection(items)
    }

    row.querySelector('#pi-ms-minus')?.addEventListener('click', () => applyDelta(-0.1))
    row.querySelector('#pi-ms-plus')?.addEventListener('click', () => applyDelta(0.1))
    range.addEventListener('input', () => {
      const val = parseFloat(range.value)
      for (const it of items) {
        const d = it.data as { scale?: number }
        d.scale = val
        this.editor.editorScene.updateModelTransform(it)
      }
      this.editor.editorScene.setSelection(items)
    })
  }

  private addMultiActionButtons(_items: PlacedItem[]): void {
    const wrap = document.createElement('div')
    wrap.className = 'pi-group-btns'

    const groupBtn = document.createElement('button')
    groupBtn.className = 'pi-group-btn btn-primary'
    groupBtn.textContent = getLocale() === 'en' ? 'Group Ctrl+G' : '组合 Ctrl+G'
    groupBtn.addEventListener('click', () => this.editor.groupSelected())
    wrap.appendChild(groupBtn)

    const delBtn = document.createElement('button')
    delBtn.className = 'pi-group-btn'
    delBtn.innerHTML = `${SVG_DELETE} ${getLocale() === 'en' ? 'Delete' : '删除选中'}`
    delBtn.style.color = 'var(--status-error)'
    delBtn.style.borderColor = 'rgba(255,68,102,0.2)'
    delBtn.addEventListener('click', () => this.editor.deleteSelected())
    wrap.appendChild(delBtn)

    this.el.appendChild(wrap)
  }

  private addTitle(text: string): void {
    const h = document.createElement('div')
    h.className = 'pi-title'
    h.textContent = text
    this.el.appendChild(h)
  }

  private addDivider(): void {
    const d = document.createElement('div')
    d.className = 'pi-divider'
    this.el.appendChild(d)
  }

  private addSectionTitle(text: string): void {
    const h = document.createElement('div')
    h.className = 'pi-section-title'
    h.textContent = text
    this.el.appendChild(h)
  }

  private addInfoRow(label: string, value: string): void {
    const row = document.createElement('div')
    row.className = 'pi-info-row'
    row.innerHTML = `<span class="pi-label">${label}</span><span class="pi-value">${value}</span>`
    this.el.appendChild(row)
  }

  private addPositionAndTransformRows(item: PlacedItem): void {
    const d = item.data
    const itemId = d.id
    const rot = d as { rotationY: number }

    // Row 1: X [input]  Y [input]
    const posRow = document.createElement('div')
    posRow.className = 'pi-angle-row'
    posRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">X</span>
        <input type="number" class="pi-num-input" id="pi-pos-x" value="${d.gridX}" step="1" />
      </div>
      <div class="pi-num-field">
        <span class="pi-num-label">Y</span>
        <input type="number" class="pi-num-input" id="pi-pos-z" value="${d.gridZ}" step="1" />
      </div>
    `
    this.el.appendChild(posRow)

    // Row 2: Z (elevation) + snap/join/ground buttons
    const elev = (d as { elevation?: number }).elevation ?? 0
    const elevRow = document.createElement('div')
    elevRow.className = 'pi-angle-row'
    elevRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">Z</span>
        <input type="number" class="pi-num-input" id="pi-elev" value="${elev}" step="0.1" />
      </div>
      <div class="pi-transform-btns" id="pi-snap-btns">
        <button class="pi-icon-btn" id="pi-snap" data-tip="${getLocale() === 'en' ? 'Snap to top' : '吸附：放到目标顶部'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="M8 6l4-4 4 4"/><rect x="4" y="14" width="16" height="6" rx="1"/></svg>
        </button>
        <button class="pi-icon-btn" id="pi-join" data-tip="${getLocale() === 'en' ? 'Join side' : '拼接：贴到目标侧面'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="8" height="12" rx="1"/><rect x="14" y="6" width="8" height="12" rx="1"/><path d="M10 12h4"/><path d="M12 10l2 2-2 2"/></svg>
        </button>
        <button class="pi-icon-btn" id="pi-ground" data-tip="${getLocale() === 'en' ? 'Ground' : '落地：重置到地面'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18v-8"/><path d="M8 14l4 4 4-4"/><line x1="4" y1="22" x2="20" y2="22"/></svg>
        </button>
      </div>
    `
    this.el.appendChild(elevRow)

    // Row 3: ∠ [angle]  [↻] [⇔] [⇕]
    const transformRow = document.createElement('div')
    transformRow.className = 'pi-angle-row'
    transformRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">∠</span>
        <input type="number" class="pi-num-input" id="pi-angle" value="${rot.rotationY}" step="90" min="0" max="270" />
      </div>
      <div class="pi-transform-btns" id="pi-btns"></div>
    `
    this.el.appendChild(transformRow)

    // Position inputs
    const xInput = posRow.querySelector('#pi-pos-x') as HTMLInputElement
    const zInput = posRow.querySelector('#pi-pos-z') as HTMLInputElement

    const commitPos = (input: HTMLInputElement, axis: 'x' | 'z') => {
      if (this.isStale(itemId)) return
      const val = parseInt(input.value)
      if (isNaN(val)) { input.value = String(axis === 'x' ? d.gridX : d.gridZ); return }
      const prev = axis === 'x' ? d.gridX : d.gridZ
      if (val === prev) return
      const cmd: Command = {
        execute: () => { if (axis === 'x') d.gridX = val; else d.gridZ = val; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item) },
        undo: () => { if (axis === 'x') d.gridX = prev; else d.gridZ = prev; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item) },
      }
      this.editor.undoStack.push(cmd)
    }

    xInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitPos(xInput, 'x'); xInput.blur() } if (e.key === 'Escape') { xInput.value = String(d.gridX); xInput.blur() } })
    xInput.addEventListener('blur', () => { xInput.value = String(d.gridX) })
    zInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitPos(zInput, 'z'); zInput.blur() } if (e.key === 'Escape') { zInput.value = String(d.gridZ); zInput.blur() } })
    zInput.addEventListener('blur', () => { zInput.value = String(d.gridZ) })

    // Elevation input
    const elevInput = elevRow.querySelector('#pi-elev') as HTMLInputElement
    const dElev = d as { elevation?: number }
    const commitElev = () => {
      if (this.isStale(itemId)) return
      const val = parseFloat(elevInput.value)
      if (isNaN(val)) { elevInput.value = String(dElev.elevation ?? 0); return }
      const prev = dElev.elevation ?? 0
      const next = Math.round(val * 10) / 10
      if (prev === next) return
      const cmd: Command = {
        execute: () => { dElev.elevation = next || undefined; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item) },
        undo: () => { dElev.elevation = prev || undefined; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item) },
      }
      this.editor.undoStack.push(cmd)
    }
    elevInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitElev(); elevInput.blur() } if (e.key === 'Escape') { elevInput.value = String(dElev.elevation ?? 0); elevInput.blur() } })
    elevInput.addEventListener('blur', () => { elevInput.value = String(dElev.elevation ?? 0) })

    // Snap to target button
    const snapBtn = elevRow.querySelector('#pi-snap') as HTMLButtonElement
    snapBtn.addEventListener('click', () => {
      this.editor.editorScene.enterSnapMode(item, (newX, newZ, newElev) => {
        const prevX = d.gridX, prevZ = d.gridZ, prevElev = dElev.elevation ?? 0
        const cmd: Command = {
          execute: () => {
            d.gridX = newX; d.gridZ = newZ; dElev.elevation = newElev || undefined
            this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item)
          },
          undo: () => {
            d.gridX = prevX; d.gridZ = prevZ; dElev.elevation = prevElev || undefined
            this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item)
          },
        }
        this.editor.undoStack.push(cmd)
      })
    })

    // Join (snap adjacent) button
    const joinBtn = elevRow.querySelector('#pi-join') as HTMLButtonElement
    joinBtn.addEventListener('click', () => {
      this.editor.editorScene.enterJoinMode(item, (newX, newZ) => {
        const prevX = d.gridX, prevZ = d.gridZ
        const cmd: Command = {
          execute: () => {
            d.gridX = newX; d.gridZ = newZ
            this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item)
          },
          undo: () => {
            d.gridX = prevX; d.gridZ = prevZ
            this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item)
          },
        }
        this.editor.undoStack.push(cmd)
      })
    })

    // Ground (reset elevation) button
    const groundBtn = elevRow.querySelector('#pi-ground') as HTMLButtonElement
    groundBtn.addEventListener('click', () => {
      const prev = dElev.elevation ?? 0
      if (prev === 0) return
      const cmd: Command = {
        execute: () => { dElev.elevation = undefined; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item) },
        undo: () => { dElev.elevation = prev || undefined; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item) },
      }
      this.editor.undoStack.push(cmd)
    })

    // Angle input
    const angleInput = transformRow.querySelector('#pi-angle') as HTMLInputElement
    const commitAngle = () => {
      if (this.isStale(itemId)) return
      let val = parseInt(angleInput.value)
      if (isNaN(val)) { angleInput.value = String(rot.rotationY); return }
      val = ((val % 360) + 360) % 360
      const snapped = ([0, 90, 180, 270].reduce((best, r) => Math.abs(r - val) < Math.abs(best - val) ? r : best, 0)) as Rotation
      const prev = rot.rotationY as Rotation
      if (snapped === prev) { angleInput.value = String(prev); return }
      const cmd: Command = {
        execute: () => { rot.rotationY = snapped; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item) },
        undo: () => { rot.rotationY = prev; this.editor.editorScene.updateModelTransform(item); this.editor.editorScene.setSelection(item); this.update(item) },
      }
      this.editor.undoStack.push(cmd)
    }
    angleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitAngle(); angleInput.blur() } if (e.key === 'Escape') { angleInput.value = String(rot.rotationY); angleInput.blur() } })
    angleInput.addEventListener('blur', () => { angleInput.value = String(rot.rotationY) })

    // Transform buttons
    const btns = transformRow.querySelector('#pi-btns')!

    const rotBtn = document.createElement('button')
    rotBtn.className = 'pi-icon-btn'
    rotBtn.innerHTML = SVG_ROTATE
    rotBtn.dataset.tip = getLocale() === 'en' ? 'Rotate 90°' : '旋转 90°'
    rotBtn.addEventListener('click', () => { this.editor.rotateSelected(); this.update(item) })
    btns.appendChild(rotBtn)

    const flipXBtn = document.createElement('button')
    flipXBtn.className = 'pi-icon-btn'
    flipXBtn.innerHTML = SVG_FLIP_X
    flipXBtn.dataset.tip = getLocale() === 'en' ? 'Flip H' : '水平翻转'
    if ((d as { flipX?: boolean }).flipX) flipXBtn.classList.add('active')
    flipXBtn.addEventListener('click', () => { this.editor.editorScene.flipItemX(item); this.update(item) })
    btns.appendChild(flipXBtn)

    const flipZBtn = document.createElement('button')
    flipZBtn.className = 'pi-icon-btn'
    flipZBtn.innerHTML = SVG_FLIP_Z
    flipZBtn.dataset.tip = getLocale() === 'en' ? 'Flip V' : '垂直翻转'
    if ((d as { flipZ?: boolean }).flipZ) flipZBtn.classList.add('active')
    flipZBtn.addEventListener('click', () => { this.editor.editorScene.flipItemZ(item); this.update(item) })
    btns.appendChild(flipZBtn)
  }

  private addScaleSlider(item: PlacedItem): void {
    const d = item.data as { scale?: number }
    const currentScale = d.scale ?? 1
    const row = document.createElement('div')
    row.className = 'pi-scale-row'
    row.innerHTML = `
      <button class="pi-scale-btn" id="pi-scale-minus">−</button>
      <input type="range" class="pi-scale-range" id="pi-scale-range" min="0.05" max="5" step="0.05" value="${currentScale}" />
      <button class="pi-scale-btn" id="pi-scale-plus">+</button>
      <input type="number" class="pi-scale-num" id="pi-scale-num" min="0.05" max="5" step="0.05" value="${currentScale}" />
    `
    this.el.appendChild(row)

    const range = row.querySelector('#pi-scale-range') as HTMLInputElement
    const num = row.querySelector('#pi-scale-num') as HTMLInputElement
    let commitPrev = currentScale

    const applyScale = (val: number) => {
      val = Math.max(0.05, Math.min(5, Math.round(val * 100) / 100))
      d.scale = val
      range.value = String(val)
      num.value = String(val)
      this.editor.editorScene.updateModelTransform(item)
      this.editor.editorScene.setSelection(item)
    }

    const commitScale = (val: number) => {
      const prev = commitPrev
      const next = Math.max(0.05, Math.min(5, Math.round(val * 100) / 100))
      if (prev === next) return
      const cmd: Command = {
        execute: () => { applyScale(next) },
        undo: () => { applyScale(prev) },
      }
      this.editor.undoStack.push(cmd)
      commitPrev = next
    }

    range.addEventListener('input', () => applyScale(parseFloat(range.value)))
    range.addEventListener('change', () => commitScale(parseFloat(range.value)))
    num.addEventListener('change', () => commitScale(parseFloat(num.value)))

    row.querySelector('#pi-scale-minus')?.addEventListener('click', () => {
      commitScale((d.scale ?? 1) - 0.1)
      this.update(item)
    })
    row.querySelector('#pi-scale-plus')?.addEventListener('click', () => {
      commitScale((d.scale ?? 1) + 0.1)
      this.update(item)
    })
  }

  private hexNumToStr(n: number): string {
    return '#' + n.toString(16).padStart(6, '0')
  }

  private hexStrToNum(s: string): number {
    return parseInt(s.replace('#', ''), 16)
  }

  private addLightSection(item: PlacedItem): void {
    const d = item.data as any
    const lights: LightPointDef[] | undefined = d.lights

    const headerRow = document.createElement('div')
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;'

    const titleSpan = document.createElement('span')
    titleSpan.className = 'pi-section-title'
    titleSpan.style.margin = '0'
    titleSpan.textContent = `${getLocale() === 'en' ? 'Lights' : '灯光'} (${lights?.length ?? 0})`
    headerRow.appendChild(titleSpan)

    const addBtn = document.createElement('button')
    addBtn.className = 'pi-icon-btn'
    addBtn.style.cssText = 'font-size:11px;padding:3px 10px;position:relative;white-space:nowrap;flex-shrink:0;width:auto;'
    addBtn.textContent = getLocale() === 'en' ? '+ Add' : '+ 添加'
    headerRow.appendChild(addBtn)
    this.el.appendChild(headerRow)

    const dropdownMenu = document.createElement('div')
    dropdownMenu.style.cssText = 'display:none;position:absolute;right:0;top:100%;background:var(--surface-2,#2a2a2a);border:1px solid var(--border,#444);border-radius:4px;z-index:100;min-width:90px;box-shadow:0 4px 12px rgba(0,0,0,0.3);'
    addBtn.style.position = 'relative'
    addBtn.appendChild(dropdownMenu)

    const typeOptions: { label: string; type: LightType }[] = [
      { label: getLocale() === 'en' ? 'Window' : '窗户灯', type: 'window' },
      { label: getLocale() === 'en' ? 'Street' : '路灯', type: 'street' },
      { label: getLocale() === 'en' ? 'Headlight' : '车前灯', type: 'vehicle_head' },
      { label: getLocale() === 'en' ? 'Taillight' : '车尾灯', type: 'vehicle_tail' },
    ]
    for (const opt of typeOptions) {
      const optBtn = document.createElement('div')
      optBtn.style.cssText = 'padding:4px 10px;cursor:pointer;font-size:11px;white-space:nowrap;'
      optBtn.textContent = opt.label
      optBtn.addEventListener('pointerenter', () => { optBtn.style.background = 'rgba(255,255,255,0.1)' })
      optBtn.addEventListener('pointerleave', () => { optBtn.style.background = '' })
      optBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        dropdownMenu.style.display = 'none'
        const newLight: LightPointDef = {
          id: genId('light'),
          offsetX: 0, offsetY: 0.5, offsetZ: 0,
          color: opt.type === 'vehicle_tail' ? 0xff2200 : 0xffe0a0,
          intensity: opt.type === 'street' ? 2.0 : 1.5,
          distance: opt.type === 'street' ? 12 : 4,
          type: opt.type,
        }
        if (!d.lights) d.lights = []
        ;(d.lights as LightPointDef[]).push(newLight)
        this.editor.onConfigChanged()
        this.editor.editorScene.setSelection([item])
        this.update(item)
      })
      dropdownMenu.appendChild(optBtn)
    }

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'block' : 'none'
    })
    document.addEventListener('pointerdown', (e) => {
      if (!addBtn.contains(e.target as Node)) dropdownMenu.style.display = 'none'
    }, { once: true })

    if (!lights || lights.length === 0) {
      const hint = document.createElement('div')
      hint.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:4px;'
      hint.textContent = getLocale() === 'en' ? 'No lights' : '无灯光配置'
      this.el.appendChild(hint)
      return
    }

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i]
      const card = document.createElement('div')
      card.style.cssText = 'background:rgba(0,0,0,0.15);border-radius:6px;padding:8px;margin-bottom:6px;'

      const SVG_LIGHT_WINDOW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 01-1 1H9a1 1 0 01-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/></svg>'
      const SVG_LIGHT_STREET = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>'
      const SVG_LIGHT_VEHICLE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>'
      const typeIconSvg = light.type === 'window' ? SVG_LIGHT_WINDOW : light.type === 'street' ? SVG_LIGHT_STREET : SVG_LIGHT_VEHICLE
      const typeLabel = light.type === 'window' ? (getLocale() === 'en' ? 'Window' : '窗户灯') : light.type === 'street' ? (getLocale() === 'en' ? 'Street' : '路灯') : light.type === 'vehicle_head' ? (getLocale() === 'en' ? 'Headlight' : '车前灯') : (getLocale() === 'en' ? 'Taillight' : '车尾灯')

      const cardHeader = document.createElement('div')
      cardHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;'
      const labelSpan = document.createElement('span')
      labelSpan.innerHTML = `${typeIconSvg} ${typeLabel}`
      labelSpan.style.cssText = 'font-size:11px;display:flex;align-items:center;gap:4px;'
      cardHeader.appendChild(labelSpan)

      const headerBtns = document.createElement('div')
      headerBtns.style.cssText = 'display:flex;gap:2px;align-items:center;'

      const relocBtn = document.createElement('button')
      relocBtn.className = 'pi-icon-btn'
      relocBtn.style.cssText = 'font-size:10px;padding:1px 4px;'
      relocBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'
      relocBtn.title = getLocale() === 'en' ? 'Relocate' : '重新放置'
      relocBtn.addEventListener('click', () => {
        this.editor.editorScene.enterLightPlaceMode(item, light.type, (offset) => {
          light.offsetX = Math.round(offset.x * 100) / 100
          light.offsetY = Math.round(offset.y * 100) / 100
          light.offsetZ = Math.round(offset.z * 100) / 100
          this.editor.onConfigChanged()
          this.editor.editorScene.setSelection([item])
          this.update(item)
        })
      })
      headerBtns.appendChild(relocBtn)

      const delLightBtn = document.createElement('button')
      delLightBtn.className = 'pi-icon-btn'
      delLightBtn.style.cssText = 'font-size:10px;color:var(--status-error);padding:1px 4px;'
      delLightBtn.textContent = '✕'
      delLightBtn.addEventListener('click', () => {
        ;(d.lights as LightPointDef[]).splice(i, 1)
        if ((d.lights as LightPointDef[]).length === 0) d.lights = undefined
        this.editor.onConfigChanged()
        this.editor.editorScene.setSelection([item])
        this.update(item)
      })
      headerBtns.appendChild(delLightBtn)
      cardHeader.appendChild(headerBtns)
      card.appendChild(cardHeader)

      const offsetRow = document.createElement('div')
      offsetRow.className = 'pi-light-grid'
      offsetRow.innerHTML = `
        <div class="pi-num-field"><span class="pi-num-label">oX</span><input type="number" class="pi-num-input" data-field="offsetX" value="${light.offsetX}" step="0.1" /></div>
        <div class="pi-num-field"><span class="pi-num-label">oY</span><input type="number" class="pi-num-input" data-field="offsetY" value="${light.offsetY}" step="0.1" /></div>
        <div class="pi-num-field"><span class="pi-num-label">oZ</span><input type="number" class="pi-num-input" data-field="offsetZ" value="${light.offsetZ}" step="0.1" /></div>
      `
      card.appendChild(offsetRow)

      for (const inp of offsetRow.querySelectorAll<HTMLInputElement>('input')) {
        inp.addEventListener('change', () => {
          const field = inp.dataset.field as 'offsetX' | 'offsetY' | 'offsetZ'
          const val = parseFloat(inp.value)
          if (!isNaN(val)) {
            light[field] = Math.round(val * 100) / 100
            this.editor.onConfigChanged()
            this.editor.editorScene.setSelection([item])
          }
        })
      }

      const colorDistRow = document.createElement('div')
      colorDistRow.className = 'pi-light-grid'
      colorDistRow.innerHTML = `
        <div class="pi-num-field"><span class="pi-num-label">${getLocale() === 'en' ? 'C' : '色'}</span><input type="color" class="pi-color-input" value="${this.hexNumToStr(light.color)}" /></div>
        <div class="pi-num-field"><span class="pi-num-label">${getLocale() === 'en' ? 'D' : '距'}</span><input type="number" class="pi-num-input" data-field="distance" value="${light.distance}" step="1" /></div>
        <div class="pi-num-field"><span class="pi-num-label">${getLocale() === 'en' ? 'I' : '强'}</span><input type="number" class="pi-num-input" data-field="intensity" value="${light.intensity}" step="0.1" /></div>
      `
      card.appendChild(colorDistRow)

      const colorInput = colorDistRow.querySelector<HTMLInputElement>('input[type="color"]')!
      colorInput.addEventListener('input', () => {
        light.color = this.hexStrToNum(colorInput.value)
        this.editor.onConfigChanged()
      })

      for (const inp of colorDistRow.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
        inp.addEventListener('change', () => {
          const field = inp.dataset.field as 'distance' | 'intensity'
          const val = parseFloat(inp.value)
          if (!isNaN(val)) {
            light[field] = Math.round(val * 100) / 100
            this.editor.onConfigChanged()
          }
        })
      }

      this.el.appendChild(card)
    }
  }

  private addAnimationSection(item: PlacedItem): void {
    const d = item.data as any

    this.addSectionTitle(getLocale() === 'en' ? 'Animation' : '动画')

    const toggleRow = document.createElement('div')
    toggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;'
    const toggle = document.createElement('div')
    toggle.className = 'pi-toggle' + (d.animated ? ' active' : '')
    const label = document.createElement('span')
    label.style.cssText = 'font-size:12px;color:var(--text-secondary,#ccc);cursor:pointer;user-select:none;'
    label.textContent = getLocale() === 'en' ? 'Animation' : '启用动画'
    toggleRow.appendChild(toggle)
    toggleRow.appendChild(label)
    this.el.appendChild(toggleRow)

    const onToggle = () => {
      d.animated = !d.animated
      toggle.classList.toggle('active', d.animated)
      if (d.animated && !d.vehicleRoute) {
        d.vehicleRoute = { waypoints: [], speedMin: 2, speedMax: 5, laneOffset: 0 }
      }
      this.editor.onConfigChanged()
      this.update(item)
    }
    toggle.addEventListener('click', onToggle)
    label.addEventListener('click', onToggle)

    if (!d.animated) return

    const route = d.vehicleRoute ?? { waypoints: [], speedMin: 2, speedMax: 5, laneOffset: 0 }
    if (!d.vehicleRoute) d.vehicleRoute = route

    const routeRow = document.createElement('div')
    routeRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;'
    const routeInfo = document.createElement('span')
    routeInfo.style.cssText = 'font-size:11px;color:var(--text-muted);'
    routeInfo.textContent = getLocale() === 'en' ? `Route: ${route.waypoints.length} pts` : `路线: ${route.waypoints.length} 个航点`
    routeRow.appendChild(routeInfo)

    const editRouteBtn = document.createElement('button')
    editRouteBtn.className = 'pi-icon-btn'
    editRouteBtn.style.cssText = 'font-size:11px;padding:3px 10px;white-space:nowrap;flex-shrink:0;width:auto;'
    editRouteBtn.textContent = getLocale() === 'en' ? 'Edit Route' : '编辑路线'
    editRouteBtn.addEventListener('click', () => {
      this.editor.editorScene.enterRouteEditMode(item, (waypoints) => {
        route.waypoints = waypoints
        d.vehicleRoute = route
        this.editor.onConfigChanged()
        this.update(item)
      })
    })
    routeRow.appendChild(editRouteBtn)
    this.el.appendChild(routeRow)

    const loopRow = document.createElement('div')
    loopRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;'
    const loopToggle = document.createElement('div')
    loopToggle.className = 'pi-toggle' + (route.loop ? ' active' : '')
    const loopLabel = document.createElement('span')
    loopLabel.style.cssText = 'font-size:12px;color:var(--text-secondary,#ccc);cursor:pointer;user-select:none;'
    loopLabel.textContent = getLocale() === 'en' ? 'Loop' : '循环路线'
    loopRow.appendChild(loopToggle)
    loopRow.appendChild(loopLabel)
    this.el.appendChild(loopRow)

    const onLoopToggle = () => {
      route.loop = !route.loop
      loopToggle.classList.toggle('active', !!route.loop)
      d.vehicleRoute = route
      this.editor.onConfigChanged()
    }
    loopToggle.addEventListener('click', onLoopToggle)
    loopLabel.addEventListener('click', onLoopToggle)

    const fwdRow = document.createElement('div')
    fwdRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;'
    const fwdAngleDeg = Math.round((route.forwardAngle ?? 0) * 180 / Math.PI)
    const fwdLabel = document.createElement('span')
    fwdLabel.style.cssText = 'font-size:11px;color:var(--text-muted);'
    fwdLabel.textContent = getLocale() === 'en' ? `Forward: ${fwdAngleDeg}°` : `前方: ${fwdAngleDeg}°`
    fwdRow.appendChild(fwdLabel)
    const fwdBtn = document.createElement('button')
    fwdBtn.className = 'pi-icon-btn'
    fwdBtn.style.cssText = 'font-size:10px;padding:2px 8px;white-space:nowrap;flex-shrink:0;margin-left:auto;'
    fwdBtn.title = getLocale() === 'en' ? 'Click model front to mark forward direction' : '点击模型车头标记前方方向'
    fwdBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg> ' + (getLocale() === 'en' ? 'Mark Front' : '标记前方')
    fwdBtn.addEventListener('click', () => {
      this.editor.editorScene.enterForwardMarkMode(item, (forwardAngle) => {
        route.forwardAngle = Math.round(forwardAngle * 1000) / 1000
        d.vehicleRoute = route
        this.editor.onConfigChanged()
        this.update(item)
      })
    })
    fwdRow.appendChild(fwdBtn)
    this.el.appendChild(fwdRow)

    const speedTitle = document.createElement('div')
    speedTitle.className = 'pi-section-title'
    speedTitle.style.cssText = 'margin-top:4px;margin-bottom:6px;font-size:10px;'
    speedTitle.textContent = getLocale() === 'en' ? 'Speed' : '速度'
    this.el.appendChild(speedTitle)

    const speedRow = document.createElement('div')
    speedRow.className = 'pi-angle-row'
    speedRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">${getLocale() === 'en' ? 'Min' : '最小'}</span>
        <input type="number" class="pi-num-input" id="pi-anim-smin" value="${route.speedMin}" step="0.5" />
      </div>
      <div class="pi-num-field">
        <span class="pi-num-label">${getLocale() === 'en' ? 'Max' : '最大'}</span>
        <input type="number" class="pi-num-input" id="pi-anim-smax" value="${route.speedMax}" step="0.5" />
      </div>
    `
    this.el.appendChild(speedRow)

    const sMinInput = speedRow.querySelector('#pi-anim-smin') as HTMLInputElement
    const sMaxInput = speedRow.querySelector('#pi-anim-smax') as HTMLInputElement

    sMinInput.addEventListener('change', () => {
      const val = parseFloat(sMinInput.value)
      if (!isNaN(val)) { route.speedMin = Math.round(val * 10) / 10; this.editor.onConfigChanged() }
    })
    sMaxInput.addEventListener('change', () => {
      const val = parseFloat(sMaxInput.value)
      if (!isNaN(val)) { route.speedMax = Math.round(val * 10) / 10; this.editor.onConfigChanged() }
    })

    const laneRow = document.createElement('div')
    laneRow.className = 'pi-angle-row'
    laneRow.innerHTML = `
      <div class="pi-num-field">
        <span class="pi-num-label">${getLocale() === 'en' ? 'Lane' : '车道'}</span>
        <input type="number" class="pi-num-input" id="pi-anim-lane" value="${route.laneOffset}" step="0.1" />
      </div>
    `
    this.el.appendChild(laneRow)

    const laneInput = laneRow.querySelector('#pi-anim-lane') as HTMLInputElement
    laneInput.addEventListener('change', () => {
      const val = parseFloat(laneInput.value)
      if (!isNaN(val)) { route.laneOffset = Math.round(val * 10) / 10; this.editor.onConfigChanged() }
    })
  }

  private addDeleteButton(): void {
    const row = document.createElement('div')
    row.className = 'pi-delete-row'
    const btn = document.createElement('button')
    btn.className = 'pi-delete-btn'
    btn.innerHTML = `${SVG_DELETE} ${getLocale() === 'en' ? 'Delete' : '删除资产'}`
    btn.addEventListener('click', () => this.editor.deleteSelected())
    row.appendChild(btn)
    this.el.appendChild(row)
  }
}
