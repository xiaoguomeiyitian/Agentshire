import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { apiUrl } from '@/utils/api-base'

const loader = new GLTFLoader()
const cache = new Map<string, THREE.Group>()
const loading = new Map<string, Promise<THREE.Group | null>>()

function cloneModel(model: THREE.Group): THREE.Group {
  let hasSkinned = false
  model.traverse(c => { if ((c as THREE.SkinnedMesh).isSkinnedMesh) hasSkinned = true })
  return (hasSkinned ? SkeletonUtils.clone(model) : model.clone()) as THREE.Group
}

export class EditorAssetLoader {
  /**
   * Load a single model on demand by its URL. Returns cached clone if available.
   */
  async loadModel(url: string): Promise<THREE.Group | null> {
    if (cache.has(url)) return cloneModel(cache.get(url)!)

    if (loading.has(url)) {
      const result = await loading.get(url)!
      return result ? cloneModel(result) : null
    }

    const promise = (async () => {
      try {
        const resolvedUrl = /^(blob:|https?:\/\/)/.test(url) ? url : apiUrl((import.meta.env.BASE_URL ?? '/') + url)
        const gltf = await loader.loadAsync(resolvedUrl)
        const model = gltf.scene
        model.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh
            m.castShadow = true
            m.receiveShadow = true
          }
        })
        cache.set(url, model)
        return model
      } catch {
        console.warn(`[EditorAssetLoader] Failed: ${url}`)
        return null
      } finally {
        loading.delete(url)
      }
    })()

    loading.set(url, promise)
    const result = await promise
    return result ? cloneModel(result) : null
  }

  /**
   * Preload a batch of URLs (for current page). Fire-and-forget style.
   */
  async preloadBatch(urls: string[], onProgress?: (loaded: number, total: number) => void): Promise<void> {
    let done = 0
    const total = urls.length
    const batch = 6
    for (let i = 0; i < urls.length; i += batch) {
      await Promise.all(
        urls.slice(i, i + batch).map(async url => {
          await this.loadModel(url)
          done++
          onProgress?.(done, total)
        })
      )
    }
  }

  /**
   * Get a previously loaded model (sync, returns null if not cached).
   */
  getCachedModel(url: string): THREE.Group | null {
    const c = cache.get(url)
    return c ? cloneModel(c) : null
  }

  isCached(url: string): boolean {
    return cache.has(url)
  }
}
