export type CustomAssetKind = 'model' | 'character'

export interface CharacterAnimationSet {
  idle: boolean
  walk: boolean
  work: boolean
  wave: boolean
  cheer: boolean
  dance: boolean
}

export interface CustomAsset {
  id: string
  kind: CustomAssetKind
  name: string
  fileName: string
  fileSize: number
  createdAt: string
  updatedAt: string
  cells?: [number, number]
  scale?: number
  assetType?: string
  fixRotationX?: number
  fixRotationY?: number
  fixRotationZ?: number
  thumbnail?: string
  animFileName?: string
  detectedAnimations?: CharacterAnimationSet
  gender?: 'male' | 'female' | 'neutral'
  /** Asset category for palette grouping: 'characters' | 'pets' | undefined(=custom) */
  category?: string
}

type Listener = () => void

const API_BASE = '/custom-assets/_api'

export class CustomAssetStore {
  private assets: CustomAsset[] = []
  private listeners: Listener[] = []
  private objectUrls = new Map<string, string>()

  async init(): Promise<void> {
    await this.fetchList()
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  getAssets(kind?: CustomAssetKind, category?: string): CustomAsset[] {
    let list = this.assets
    if (kind) list = list.filter(a => a.kind === kind)
    if (category) {
      list = list.filter(a => (a.category ?? 'custom') === category)
    }
    return list
  }

  getModelUrl(asset: CustomAsset): string {
    const cached = this.objectUrls.get(asset.id)
    if (cached) return cached
    return this.getPersistentUrl(asset)
  }

  getPersistentUrl(asset: CustomAsset): string {
    // kind 'character' → custom-assets/characters/<fileName>
    // kind 'model' → custom-assets/models/<fileName>
    // fileName may include a subdirectory (e.g. "pets/foo.glb")
    const subDir = asset.kind === 'character' ? 'characters' : 'models'
    return `custom-assets/${subDir}/${asset.fileName}`
  }

  resolveModelUrl(modelUrl: string): string {
    if (!modelUrl.startsWith('custom-assets/')) return modelUrl
    for (const asset of this.assets) {
      if (this.getPersistentUrl(asset) === modelUrl) {
        return this.objectUrls.get(asset.id) ?? modelUrl
      }
    }
    return modelUrl
  }

  private async fetchList(): Promise<void> {
    try {
      const resp = await fetch(`${API_BASE}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'model' }),
      })
      const data = await resp.json()
      this.assets = data.assets ?? []
      this.notify()
    } catch {
      this.assets = []
    }
  }

  async upload(params: {
    kind: CustomAssetKind
    name: string
    file: File
    cells?: [number, number]
    scale?: number
    assetType?: string
    fixRotationX?: number
    fixRotationY?: number
    fixRotationZ?: number
    thumbnail?: string
  }): Promise<CustomAsset | { error: string }> {
    const arrayBuf = await params.file.arrayBuffer()
    const base64 = this.arrayBufferToBase64(arrayBuf)

    try {
      const resp = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: params.kind,
          name: params.name,
          data: base64,
          cells: params.cells,
          scale: params.scale,
          assetType: params.assetType,
          fixRotationX: params.fixRotationX,
          fixRotationY: params.fixRotationY,
          fixRotationZ: params.fixRotationZ,
          thumbnail: params.thumbnail,
        }),
      })
      const result = await resp.json()
      if (result.error) return { error: result.error }

      const asset = result.asset as CustomAsset
      const blob = new Blob([arrayBuf], { type: 'model/gltf-binary' })
      this.objectUrls.set(asset.id, URL.createObjectURL(blob))

      const idx = this.assets.findIndex(a => a.id === asset.id)
      if (idx >= 0) this.assets[idx] = asset
      else this.assets.unshift(asset)
      this.notify()
      return asset
    } catch {
      return { error: '上传失败，请重试' }
    }
  }

  async update(
    id: string,
    updates: Partial<Pick<CustomAsset, 'name' | 'cells' | 'scale' | 'assetType' | 'fixRotationX' | 'fixRotationY' | 'fixRotationZ'>>,
  ): Promise<CustomAsset | { error: string }> {
    try {
      const resp = await fetch(`${API_BASE}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
      const result = await resp.json()
      if (result.error) return { error: result.error }

      const asset = result.asset as CustomAsset
      const idx = this.assets.findIndex(a => a.id === id)
      if (idx >= 0) this.assets[idx] = asset
      this.notify()
      return asset
    } catch {
      return { error: '更新失败' }
    }
  }

  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch(`${API_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const result = await resp.json()
      if (result.error) return { success: false, error: result.error }

      this.revokeUrl(id)
      this.assets = this.assets.filter(a => a.id !== id)
      this.notify()
      return { success: true }
    } catch {
      return { success: false, error: '删除失败' }
    }
  }

  private revokeUrl(id: string): void {
    const url = this.objectUrls.get(id)
    if (url) {
      URL.revokeObjectURL(url)
      this.objectUrls.delete(id)
    }
  }

  private arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
}
