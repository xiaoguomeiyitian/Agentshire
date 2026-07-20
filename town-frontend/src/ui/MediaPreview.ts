// @desc Media preview — deliverable card overlay, lightbox, download helpers

import { escapeHtml, truncateFileName } from './ui-utils'
import { t } from '../i18n'
import { apiUrl } from '@/utils/api-base'

export type ShowToastFn = (msg: string) => void

export interface DeliverableItem {
  cardType: string
  name?: string
  url?: string
  filePath?: string
  mimeType?: string
  thumbnailData?: string
  data?: string
  httpUrl?: string
}

/**
 * Manages the media deliverable card overlay (single / list view),
 * lightbox for image zoom, and file download logic.
 */
export class MediaPreview {
  private deliverableCardOpen = false
  private deliverableItems: DeliverableItem[] = []
  private deliverableCardCloseCb: (() => void) | null = null
  private showToastFn: ShowToastFn
  private showGamePublishFn: (item: DeliverableItem, onClose: () => void) => void

  constructor(
    showToastFn: ShowToastFn,
    showGamePublishFn: (item: DeliverableItem, onClose: () => void) => void,
  ) {
    this.showToastFn = showToastFn
    this.showGamePublishFn = showGamePublishFn
  }

  handleDeliverableCard(event: DeliverableItem, onClose?: () => void): void {
    const item = { ...event }

    if (this.deliverableCardOpen) {
      this.deliverableItems.push(item)
      if (item.cardType !== 'game' && item.cardType !== 'app' && item.cardType !== 'website') {
        this.renderMediaCard()
      }
      return
    }

    this.deliverableItems = [item]
    this.deliverableCardOpen = true
    this.deliverableCardCloseCb = onClose ?? null

    const ct = item.cardType
    if (ct === 'game' || ct === 'app' || ct === 'website') {
      this.showGamePublishFn(item, () => this.closeDeliverableCard())
    } else {
      this.renderMediaCard()
    }
  }

  closeDeliverableCard(): void {
    this.deliverableCardOpen = false
    this.deliverableItems = []
    this.deliverableCardCloseCb?.()
    this.deliverableCardCloseCb = null
  }

  isDeliverableCardOpen(): boolean { return this.deliverableCardOpen }
  getDeliverableItems(): ReadonlyArray<DeliverableItem> { return this.deliverableItems }

  // ── private ──

  private renderMediaCard(): void {
    const overlay = document.getElementById('media-publish-overlay')
    if (!overlay) return

    const singleView = document.getElementById('media-single-view')!
    const listView = document.getElementById('media-list-view')!
    const singlePreview = document.getElementById('media-single-preview')!
    const listContainer = document.getElementById('media-list-container')!
    const singleDownloadBtn = document.getElementById('media-single-download')!
    const singleIgnoreBtn = document.getElementById('media-single-ignore')!
    const listIgnoreBtn = document.getElementById('media-list-ignore')!

    let touchStartY = 0
    listView.style.overflowY = 'auto'
    listView.style.touchAction = 'pan-y'
    const scrollListBy = (deltaY: number) => {
      if (listView.style.display === 'none') return
      listView.scrollTop += deltaY
    }
    listView.onwheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      scrollListBy(e.deltaY)
    }
    listView.ontouchstart = (e) => {
      touchStartY = e.touches[0]?.clientY ?? 0
    }
    listView.ontouchmove = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const currentY = e.touches[0]?.clientY ?? touchStartY
      scrollListBy(touchStartY - currentY)
      touchStartY = currentY
    }

    const hideAllBtns = () => {
      singleDownloadBtn.style.display = 'none'
      singleIgnoreBtn.style.display = 'none'
      listIgnoreBtn.style.display = 'none'
    }

    const closeCard = () => {
      overlay.classList.remove('visible')
      hideAllBtns()
      document.body.style.touchAction = 'none'
      overlay.onwheel = null
      overlay.ontouchstart = null
      overlay.ontouchmove = null
      this.closeDeliverableCard()
    }

    singleIgnoreBtn.onclick = closeCard
    listIgnoreBtn.onclick = closeCard
    overlay.onclick = null

    const items = this.deliverableItems.filter(i => i.cardType !== 'game' && i.cardType !== 'app' && i.cardType !== 'website')
    if (items.length === 0) return

    document.body.style.touchAction = 'auto'
    overlay.classList.add('visible')
    overlay.onwheel = (e) => {
      if (listView.style.display === 'none') return
      e.preventDefault()
      scrollListBy(e.deltaY)
    }
    overlay.ontouchstart = (e) => {
      if (listView.style.display === 'none') return
      touchStartY = e.touches[0]?.clientY ?? 0
    }
    overlay.ontouchmove = (e) => {
      if (listView.style.display === 'none') return
      e.preventDefault()
      const currentY = e.touches[0]?.clientY ?? touchStartY
      scrollListBy(touchStartY - currentY)
      touchStartY = currentY
    }

    const getDownloadUrl = (item: DeliverableItem): string => {
      if (item.data) return `data:${item.mimeType || 'application/octet-stream'};base64,${item.data}`
      return apiUrl(item.url || '')
    }

    const hasDownload = (item: DeliverableItem): boolean => !!(item.data || item.url)
    const isHttpItem = (item: DeliverableItem): boolean => !!(item.httpUrl || (item.url && item.url.startsWith('/steward-workspace/')))

    const getHttpOpenUrl = (item: DeliverableItem): string => {
      const httpUrl = item.httpUrl || item.url || ''
      const ext = (item.name || item.filePath || '').split('.').pop()?.toLowerCase() ?? ''
      if (ext === 'md') return apiUrl(`/viewer.html?file=${encodeURIComponent(httpUrl)}`)
      return apiUrl(httpUrl)
    }

    const getPreviewSrc = (item: DeliverableItem): string => {
      if (isHttpItem(item)) return apiUrl(item.httpUrl || item.url || '')
      return getDownloadUrl(item)
    }

    const triggerDownload = async (item: DeliverableItem) => {
      const rawName = item.name || item.filePath || 'download'
      const fileName = rawName.split('/').pop() || rawName
      const src = getDownloadUrl(item)
      if (!src) return

      if (src.startsWith('data:')) {
        const a = document.createElement('a')
        a.href = src
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return
      }

      const resolvedUrl = new URL(src, window.location.href)
      if (resolvedUrl.origin === window.location.origin) {
        const a = document.createElement('a')
        a.href = resolvedUrl.toString()
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return
      }

      try {
        const resp = await fetch(src)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const blob = await resp.blob()
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
      } catch {
        this.showToastFn(t('media.download_fail'))
      }
    }

    if (items.length === 1) {
      singleView.style.display = 'flex'
      listView.style.display = 'none'
      singleIgnoreBtn.style.display = ''
      listIgnoreBtn.style.display = 'none'

      const item = items[0]
      const httpMode = isHttpItem(item)
      const canAction = httpMode || hasDownload(item)
      singleDownloadBtn.style.display = canAction ? '' : 'none'
      if (canAction) {
        singleDownloadBtn.textContent = httpMode ? t('media.view') : t('media.download_btn')
      }
      singlePreview.innerHTML = ''

      const src = getPreviewSrc(item)

      if (item.cardType === 'image') {
        const imgSrc = src || (item.thumbnailData ? (item.thumbnailData.startsWith('data:') ? item.thumbnailData : `data:${item.mimeType};base64,${item.thumbnailData}`) : '')
        const img = document.createElement('img')
        img.src = imgSrc
        img.style.cursor = 'pointer'
        img.onclick = () => this.openLightbox(imgSrc)
        singlePreview.appendChild(img)
      } else if (item.cardType === 'video') {
        const vid = document.createElement('video')
        vid.src = src
        vid.controls = true
        singlePreview.appendChild(vid)
      } else if (item.cardType === 'audio') {
        const aud = document.createElement('audio')
        aud.src = src
        aud.controls = true
        aud.style.width = '80%'
        singlePreview.appendChild(aud)
      } else {
        singlePreview.innerHTML = `
          <div style="font-size: 48px; color: var(--accent-cyan); margin-bottom: 12px;">📄</div>
          <div style="color: #fff; font-size: 16px; font-weight: 600; text-align: center; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(truncateFileName(item.name || item.filePath || t('media.unknown_file')))}</div>
          <div style="color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 4px;">${escapeHtml(item.mimeType || t('media.unknown_type'))}</div>
        `
      }

      if (canAction) {
        singleDownloadBtn.onclick = () => {
          if (httpMode) {
            window.open(getHttpOpenUrl(item), '_blank')
          } else {
            triggerDownload(item)
          }
        }
      }
    } else {
      singleView.style.display = 'none'
      listView.style.display = 'flex'
      singleDownloadBtn.style.display = 'none'
      singleIgnoreBtn.style.display = 'none'
      listIgnoreBtn.style.display = ''

      listContainer.innerHTML = ''
      items.forEach(item => {
        const row = document.createElement('div')
        row.className = 'media-list-item'
        const src = getPreviewSrc(item)
        const httpMode = isHttpItem(item)
        const canAction = httpMode || hasDownload(item)

        let thumbHtml = ''
        if (item.cardType === 'image') {
          const imgSrc = src || (item.thumbnailData ? (item.thumbnailData.startsWith('data:') ? item.thumbnailData : `data:${item.mimeType};base64,${item.thumbnailData}`) : '')
          thumbHtml = `<img src="${imgSrc}" />`
        } else if (item.cardType === 'video') {
          thumbHtml = `<div style="color:var(--accent-cyan);font-size:20px;">🎬</div>`
        } else if (item.cardType === 'audio') {
          thumbHtml = `<div style="color:var(--accent-cyan);font-size:20px;">🎵</div>`
        } else {
          thumbHtml = `<div style="color:var(--accent-cyan);font-size:20px;">📄</div>`
        }

        const actionIcon = httpMode
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
          : '↓'

        row.innerHTML = `
          <div class="media-item-thumb">${thumbHtml}</div>
          <div class="media-item-info">
            <div class="media-item-name">${escapeHtml(truncateFileName(item.name || item.filePath || t('media.unknown_file')))}</div>
            <div class="media-item-meta">${escapeHtml(item.mimeType || item.cardType)}</div>
          </div>
          ${canAction ? `<button class="media-item-action">${actionIcon}</button>` : ''}
        `

        if (item.cardType === 'image') {
          const thumb = row.querySelector('.media-item-thumb') as HTMLElement
          thumb.style.cursor = 'pointer'
          const imgSrc = src || (item.thumbnailData ? (item.thumbnailData.startsWith('data:') ? item.thumbnailData : `data:${item.mimeType};base64,${item.thumbnailData}`) : '')
          thumb.onclick = () => this.openLightbox(imgSrc)
        }

        if (canAction) {
          const btn = row.querySelector('.media-item-action') as HTMLElement
          btn.onclick = () => {
            if (httpMode) {
              window.open(getHttpOpenUrl(item), '_blank')
            } else {
              triggerDownload(item)
            }
          }
        }

        listContainer.appendChild(row)
      })
    }
  }

  private openLightbox(src: string): void {
    const lb = document.getElementById('media-lightbox')
    const img = document.getElementById('media-lightbox-img') as HTMLImageElement
    const closeBtn = document.getElementById('media-lightbox-close')
    if (!lb || !img) return

    img.src = src
    lb.classList.add('visible')
    const closeLb = () => { lb.classList.remove('visible'); img.src = '' }
    lb.onclick = (e) => { if (e.target === lb) closeLb() }
    closeBtn!.onclick = closeLb
  }
}
