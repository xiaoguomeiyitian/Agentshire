import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { apiUrl } from '@/utils/api-base'

export interface AssetManifest {
  characters: Record<string, string>
  buildings: Record<string, string>
  furniture: Record<string, string>
  props: Record<string, string>
}

const BASE = apiUrl(import.meta.env.BASE_URL + 'assets/models')
const LIBRARY_BASE = apiUrl(import.meta.env.BASE_URL + 'assets/Characters_1/gLTF')

const MANIFEST: AssetManifest = {
  characters: {
    'char-male-a': `${BASE}/characters/character-male-a.glb`,
    'char-male-b': `${BASE}/characters/character-male-b.glb`,
    'char-male-c': `${BASE}/characters/character-male-c.glb`,
    'char-male-d': `${BASE}/characters/character-male-d.glb`,
    'char-male-e': `${BASE}/characters/character-male-e.glb`,
    'char-male-f': `${BASE}/characters/character-male-f.glb`,
    'char-female-a': `${BASE}/characters/character-female-a.glb`,
    'char-female-b': `${BASE}/characters/character-female-b.glb`,
    'char-female-c': `${BASE}/characters/character-female-c.glb`,
    'char-female-d': `${BASE}/characters/character-female-d.glb`,
    'char-female-e': `${BASE}/characters/character-female-e.glb`,
    'char-female-f': `${BASE}/characters/character-female-f.glb`,
    'char-pet-beaver': `${BASE}/characters/character-pet-beaver.glb`,
    'char-pet-bee': `${BASE}/characters/character-pet-bee.glb`,
    'char-pet-bunny': `${BASE}/characters/character-pet-bunny.glb`,
    'char-pet-cat': `${BASE}/characters/character-pet-cat.glb`,
    'char-pet-caterpillar': `${BASE}/characters/character-pet-caterpillar.glb`,
    'char-pet-chick': `${BASE}/characters/character-pet-chick.glb`,
    'char-pet-cow': `${BASE}/characters/character-pet-cow.glb`,
    'char-pet-crab': `${BASE}/characters/character-pet-crab.glb`,
    'char-pet-deer': `${BASE}/characters/character-pet-deer.glb`,
    'char-pet-dog': `${BASE}/characters/character-pet-dog.glb`,
    'char-pet-elephant': `${BASE}/characters/character-pet-elephant.glb`,
    'char-pet-fish': `${BASE}/characters/character-pet-fish.glb`,
    'char-pet-fox': `${BASE}/characters/character-pet-fox.glb`,
    'char-pet-giraffe': `${BASE}/characters/character-pet-giraffe.glb`,
    'char-pet-hog': `${BASE}/characters/character-pet-hog.glb`,
    'char-pet-koala': `${BASE}/characters/character-pet-koala.glb`,
    'char-pet-lion': `${BASE}/characters/character-pet-lion.glb`,
    'char-pet-monkey': `${BASE}/characters/character-pet-monkey.glb`,
    'char-pet-panda': `${BASE}/characters/character-pet-panda.glb`,
    'char-pet-parrot': `${BASE}/characters/character-pet-parrot.glb`,
    'char-pet-penguin': `${BASE}/characters/character-pet-penguin.glb`,
    'char-pet-pig': `${BASE}/characters/character-pet-pig.glb`,
    'char-pet-polar': `${BASE}/characters/character-pet-polar.glb`,
    'char-pet-tiger': `${BASE}/characters/character-pet-tiger.glb`,
  },
  buildings: {
    'building_A': `${BASE}/buildings/building_A.gltf`,
    'building_B': `${BASE}/buildings/building_B.gltf`,
    'building_C': `${BASE}/buildings/building_C.gltf`,
    'building_D': `${BASE}/buildings/building_D.gltf`,
    'building_E': `${BASE}/buildings/building_E.gltf`,
    'building_F': `${BASE}/buildings/building_F.gltf`,
    'building_G': `${BASE}/buildings/building_G.gltf`,
    'building_H': `${BASE}/buildings/building_H.gltf`,
    'base': `${BASE}/buildings/base.gltf`,
    'road_straight': `${BASE}/buildings/road_straight.gltf`,
    'road_corner': `${BASE}/buildings/road_corner.gltf`,
    'road_junction': `${BASE}/buildings/road_junction.gltf`,
    'road_tsplit': `${BASE}/buildings/road_tsplit.gltf`,
    'road_straight_crossing': `${BASE}/buildings/road_straight_crossing.gltf`,
    'watertower': `${BASE}/buildings/watertower.gltf`,
  },
  furniture: {
    'table_medium': `${BASE}/furniture/table_medium.gltf`,
    'table_medium_long': `${BASE}/furniture/table_medium_long.gltf`,
    'table_small': `${BASE}/furniture/table_small.gltf`,
    'table_low': `${BASE}/furniture/table_low.gltf`,
    'chair_A': `${BASE}/furniture/chair_A.gltf`,
    'chair_B': `${BASE}/furniture/chair_B.gltf`,
    'chair_C': `${BASE}/furniture/chair_C.gltf`,
    'chair_stool': `${BASE}/furniture/chair_stool.gltf`,
    'armchair': `${BASE}/furniture/armchair.gltf`,
    'armchair_pillows': `${BASE}/furniture/armchair_pillows.gltf`,
    'couch': `${BASE}/furniture/couch.gltf`,
    'couch_pillows': `${BASE}/furniture/couch_pillows.gltf`,
    'shelf_A_big': `${BASE}/furniture/shelf_A_big.gltf`,
    'shelf_A_small': `${BASE}/furniture/shelf_A_small.gltf`,
    'shelf_B_large': `${BASE}/furniture/shelf_B_large.gltf`,
    'shelf_B_large_decorated': `${BASE}/furniture/shelf_B_large_decorated.gltf`,
    'shelf_B_small': `${BASE}/furniture/shelf_B_small.gltf`,
    'shelf_B_small_decorated': `${BASE}/furniture/shelf_B_small_decorated.gltf`,
    'book_set': `${BASE}/furniture/book_set.gltf`,
    'book_single': `${BASE}/furniture/book_single.gltf`,
    'cabinet_medium': `${BASE}/furniture/cabinet_medium.gltf`,
    'cabinet_medium_decorated': `${BASE}/furniture/cabinet_medium_decorated.gltf`,
    'cabinet_small': `${BASE}/furniture/cabinet_small.gltf`,
    'lamp_standing': `${BASE}/furniture/lamp_standing.gltf`,
    'lamp_table': `${BASE}/furniture/lamp_table.gltf`,
    'bed_single_A': `${BASE}/furniture/bed_single_A.gltf`,
    'bed_double_A': `${BASE}/furniture/bed_double_A.gltf`,
    'rug_rectangle_A': `${BASE}/furniture/rug_rectangle_A.gltf`,
    'rug_oval_A': `${BASE}/furniture/rug_oval_A.gltf`,
    'pictureframe_large_A': `${BASE}/furniture/pictureframe_large_A.gltf`,
    'pictureframe_large_B': `${BASE}/furniture/pictureframe_large_B.gltf`,
    'pictureframe_medium': `${BASE}/furniture/pictureframe_medium.gltf`,
    'cactus_medium_A': `${BASE}/furniture/cactus_medium_A.gltf`,
    'cactus_small_A': `${BASE}/furniture/cactus_small_A.gltf`,
    'pillow_A': `${BASE}/furniture/pillow_A.gltf`,
  },
  props: {
    'bench': `${BASE}/props/bench.gltf`,
    'streetlight': `${BASE}/props/streetlight.gltf`,
    'car_sedan': `${BASE}/props/car_sedan.gltf`,
    'car_hatchback': `${BASE}/props/car_hatchback.gltf`,
    'car_taxi': `${BASE}/props/car_taxi.gltf`,
    'bush': `${BASE}/props/bush.gltf`,
    'firehydrant': `${BASE}/props/firehydrant.gltf`,
    'trash_A': `${BASE}/props/trash_A.gltf`,
    'dumpster': `${BASE}/props/dumpster.gltf`,
    'trafficlight': `${BASE}/props/trafficlight_A.gltf`,
    'capybara': `${BASE}/props/capybara.glb`,
  },
}

type CategoryKey = keyof AssetManifest

export class AssetLoader {
  private loader = new GLTFLoader()
  private cache = new Map<string, THREE.Group>()
  private skinned = new Set<string>()
  private animations = new Map<string, THREE.AnimationClip[]>()
  private loaded = false
  private sharedLibraryAnims: THREE.AnimationClip[] | null = null
  private loadingPromises = new Map<string, Promise<void>>()

  async preload(
    categories: CategoryKey[] = ['characters', 'buildings', 'furniture', 'props'],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const entries: [string, string][] = []
    for (const cat of categories) {
      for (const [key, url] of Object.entries(MANIFEST[cat])) {
        entries.push([`${cat}/${key}`, url])
      }
    }

    let done = 0
    const total = entries.length

    const loadOne = async ([key, url]: [string, string]) => {
      try {
        const gltf = await this.loader.loadAsync(url)
        const model = gltf.scene
        let hasSkin = false
        model.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh
            m.castShadow = true
            m.receiveShadow = true
          }
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            hasSkin = true
          }
        })
        this.cache.set(key, model)
        if (hasSkin) this.skinned.add(key)
        if (gltf.animations.length > 0) {
          this.animations.set(key, gltf.animations)
        }
      } catch {
        console.warn(`[AssetLoader] Failed to load: ${key} (${url})`)
      }
      done++
      onProgress?.(done, total)
    }

    const batchSize = 6
    for (let i = 0; i < entries.length; i += batchSize) {
      await Promise.all(entries.slice(i, i + batchSize).map(loadOne))
    }

    this.loaded = true
  }

  getModel(category: CategoryKey, key: string): THREE.Group | null {
    const cacheKey = `${category}/${key}`
    const cached = this.cache.get(cacheKey)
    if (!cached) return null
    if (this.skinned.has(cacheKey)) {
      return SkeletonUtils.clone(cached) as THREE.Group
    }
    return cached.clone()
  }

  getAnimations(category: CategoryKey, key: string): THREE.AnimationClip[] {
    return this.animations.get(`${category}/${key}`) ?? []
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getCharacterModel(charKey: string): THREE.Group | null {
    return this.getModel('characters', charKey)
  }

  getBuildingModel(key: string): THREE.Group | null {
    return this.getModel('buildings', key)
  }

  getFurnitureModel(key: string): THREE.Group | null {
    return this.getModel('furniture', key)
  }

  getPropModel(key: string): THREE.Group | null {
    return this.getModel('props', key)
  }

  private async loadSharedLibraryAnimations(): Promise<THREE.AnimationClip[]> {
    if (this.sharedLibraryAnims) return this.sharedLibraryAnims
    const url = apiUrl('/ext-assets/Characters_1/gLTF/Animations/Animations.glb')
    try {
      const gltf = await this.loader.loadAsync(url)
      this.sharedLibraryAnims = gltf.animations
      return gltf.animations
    } catch {
      console.warn('[AssetLoader] Failed to load shared library animations')
      return []
    }
  }

  private async loadGltfToCache(cacheKey: string, url: string, animClips?: THREE.AnimationClip[]): Promise<void> {
    if (this.cache.has(cacheKey)) return
    try {
      const gltf = await this.loader.loadAsync(url)
      const model = gltf.scene
      let hasSkin = false
      model.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh
          m.castShadow = true
          m.receiveShadow = true
        }
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true
      })
      this.cache.set(cacheKey, model)
      if (hasSkin) this.skinned.add(cacheKey)

      const clips = gltf.animations.length > 0 ? gltf.animations : (animClips ?? [])
      if (clips.length > 0) this.animations.set(cacheKey, clips)
    } catch {
      console.warn(`[AssetLoader] Failed to load: ${cacheKey} (${url})`)
    }
  }

  async loadLibraryCharacter(meshFileName: string): Promise<THREE.Group | null> {
    const cacheKey = `characters/${meshFileName}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const promise = (async () => {
          const sharedAnims = await this.loadSharedLibraryAnimations()
          const meshUrl = `${LIBRARY_BASE}/Characters/${meshFileName}.glb`
          await this.loadGltfToCache(cacheKey, meshUrl, sharedAnims)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  async loadLibraryCharacterByUrl(modelUrl: string): Promise<THREE.Group | null> {
    const cacheKey = `characters/lib-url-${modelUrl}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const promise = (async () => {
          const sharedAnims = await this.loadSharedLibraryAnimations()
          await this.loadGltfToCache(cacheKey, apiUrl(modelUrl), sharedAnims)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  async loadCustomCharacter(meshUrl: string, animFileUrls?: string[]): Promise<THREE.Group | null> {
    const cacheKey = `characters/custom-${meshUrl}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const promise = (async () => {
          const allClips: THREE.AnimationClip[] = []
          if (animFileUrls?.length) {
            for (const url of animFileUrls) {
              try {
                const animGltf = await this.loader.loadAsync(apiUrl(url))
                allClips.push(...animGltf.animations)
              } catch {
                console.warn(`[AssetLoader] Failed to load custom animation: ${url}`)
              }
            }
          }
          await this.loadGltfToCache(cacheKey, apiUrl(meshUrl), allClips.length > 0 ? allClips : undefined)
          this.fixCustomMaterials(cacheKey)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  private fixCustomMaterials(cacheKey: string): void {
    const model = this.cache.get(cacheKey)
    if (!model) return
    model.traverse(child => {
      if (!(child as THREE.Mesh).isMesh) return
      const mats = Array.isArray((child as THREE.Mesh).material)
        ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
        : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial]
      for (const mat of mats) {
        if (mat.transparent) {
          mat.transparent = false
          mat.alphaTest = 0.5
          mat.opacity = 1
        }
        if (mat.alphaMap) mat.alphaTest = Math.max(mat.alphaTest, 0.5)
        mat.depthWrite = true
        mat.side = THREE.FrontSide
      }
    })
  }

  getAnimationsForKey(cacheKey: string): THREE.AnimationClip[] {
    return this.animations.get(cacheKey) ?? []
  }

  /**
   * Load an arbitrary GLTF/GLB model by URL (for scene editing — buildings, props, roads
   * from the asset catalog that are not in the preloaded MANIFEST).
   * Returns a clone of the cached model. Caches by URL for subsequent calls.
   */
  async loadModelByUrl(url: string): Promise<THREE.Group | null> {
    const cacheKey = `url:${url}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const resolvedUrl = apiUrl(url)
        const promise = (async () => {
          await this.loadGltfToCache(cacheKey, resolvedUrl)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  private getModelFromCache(cacheKey: string): THREE.Group | null {
    const cached = this.cache.get(cacheKey)
    if (!cached) return null
    if (this.skinned.has(cacheKey)) {
      return SkeletonUtils.clone(cached) as THREE.Group
    }
    return cached.clone()
  }
}
