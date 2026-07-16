/**
 * Shared HTTP request handler for editor workshops (scene + citizen).
 * Used by both the production server (index.ts) and the Vite dev server (vite.config.ts).
 *
 * Returns true if the request was handled, false if it should fall through.
 */

import { join, relative, resolve, sep } from "node:path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  statSync,
  readdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { stateDir, initStateDir } from "./paths.js";
import { getTownRuntime } from "./runtime.js";
import { buildTownInboundContext } from "./channel.js";


function getStewardWorkspaceDir(): string {
  try {
    const rt = getTownRuntime();
    const cfg = rt.config.current() as any;
    const entry = (cfg?.agents?.list ?? []).find((a: any) => a.id === "town-steward");
    if (entry?.workspace) return entry.workspace;
  } catch {}
  return join(stateDir(), "workspace-town-steward");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".woff2": "font/woff2",
};

function guessMime(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Build the full asset catalog (builtin + custom) for AI scene editing tools.
 * Builtin assets are read from town-frontend/src/data/asset-catalog.json.
 * Custom assets are read from the CustomAssetManager catalog.
 */
export async function buildAssetCatalog(
  pluginDir: string,
  d: ReturnType<typeof resolveDirs>,
): Promise<{ builtin: any[]; custom: any[] }> {
  const builtin: any[] = [];

  // ── 1. Preloaded game assets (always available, in public/assets/models/) ──
  // These are the models the game runtime can actually load via AssetLoader cache.
  const preloadedBuildingsDir = join(pluginDir, "town-frontend", "public", "assets", "models", "buildings");
  const preloadedPropsDir = join(pluginDir, "town-frontend", "public", "assets", "models", "props");
  const preloadedFurnitureDir = join(pluginDir, "town-frontend", "public", "assets", "models", "furniture");

  /** Scan a directory for .gltf files and return asset entries */
  function scanPreloaded(dir: string, category: string, assetType: string): any[] {
    if (!existsSync(dir)) return [];
    const entries: any[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".gltf")) continue;
      const key = file.replace(/\.gltf$/, "");
      // Skip _withoutBase variants (they're alternatives of the same building)
      if (key.endsWith("_withoutBase")) continue;
      entries.push({
        key,
        name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        category,
        assetType,
        cells: [1, 1],
        defaultScale: 1,
        url: `/assets/models/${category}/${file}`,
      });
    }
    return entries;
  }

  // Buildings (building_A..H, base, road_*, watertower, etc.)
  for (const entry of scanPreloaded(preloadedBuildingsDir, "buildings", "building")) {
    // Classify: road_* → road, car_* → vehicle, others → building
    if (entry.key.startsWith("road_")) {
      entry.category = "roads";
      entry.assetType = "road";
    } else if (entry.key.startsWith("car_")) {
      entry.category = "vehicles";
      entry.assetType = "vehicle";
    } else if (["bench", "bush", "dumpster", "firehydrant", "streetlight", "trafficlight_A", "trafficlight_B", "trafficlight_C", "trash_A", "trash_B", "watertower"].includes(entry.key)) {
      entry.category = "streetProps";
      entry.assetType = "prop";
    } else if (["box_A", "box_B"].includes(entry.key)) {
      entry.category = "other";
      entry.assetType = "prop";
    } else {
      entry.category = "buildings";
      entry.assetType = "building";
      // Known building sizes
      entry.cells = [6, 6];
      entry.defaultScale = 1.8;
    }
    builtin.push(entry);
  }

  // Props
  for (const entry of scanPreloaded(preloadedPropsDir, "props", "prop")) {
    builtin.push(entry);
  }

  // Furniture
  for (const entry of scanPreloaded(preloadedFurnitureDir, "furniture", "furniture")) {
    builtin.push(entry);
  }

  // ── 2. Megapack assets (only if the files actually exist on disk) ──
  const megapackBase = join(d.extAssetsDir, "Map_1");
  const megapackExists = existsSync(megapackBase);
  if (megapackExists) {
    const catalogPath = join(pluginDir, "town-frontend", "src", "data", "asset-catalog.json");
    if (existsSync(catalogPath)) {
      try {
        const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
        for (const [category, groups] of Object.entries(catalog)) {
          for (const group of groups as any[]) {
            const type = (group.type ?? "").toLowerCase();
            const colors = group.colors ?? [""];
            for (const color of colors) {
              const file = (group.filePattern ?? "").replace("{color}", color);
              const url = (group.urlPattern ?? "") + file;
              // Verify the file exists on disk before offering it
              const filePath = join(megapackBase, decodeURIComponent(url.replace("assets/models/megapack/gltf/", "")));
              if (!existsSync(filePath)) continue;
              const key = `${group.type}_${group.style}_${color}`.toLowerCase().replace(/\s+/g, "_");
              builtin.push({
                key,
                name: `${group.name}${color && color !== "A" ? ` (${color})` : ""}`,
                category,
                assetType: type,
                cells: group.cells ?? [1, 1],
                defaultScale: group.defaultScale ?? 1,
                url,
                fixRotationX: group.fixRotationX,
                fixRotationY: group.fixRotationY,
                fixRotationZ: group.fixRotationZ,
              });
            }
          }
        }
      } catch {}
    }
  }

  // Read custom assets catalog
  const custom: any[] = [];
  if (existsSync(d.catalogPath)) {
    try {
      const cat = JSON.parse(readFileSync(d.catalogPath, "utf-8"));
      for (const asset of cat.assets ?? []) {
        if (asset.kind !== "model") continue;
        // Build URL: kind 'character' → /custom-assets/characters/<fileName>,
        // kind 'model' → /custom-assets/models/<fileName>.
        // fileName may already include a subdirectory (e.g. "pets/foo.glb").
        const subDir = asset.kind === "character" ? "characters" : "models";
        custom.push({
          id: asset.id,
          key: asset.id,
          name: asset.name,
          category: asset.category ?? "custom",
          assetType: (asset.assetType ?? "prop").toLowerCase(),
          cells: asset.cells ?? [1, 1],
          defaultScale: asset.scale ?? 1,
          url: `/custom-assets/${subDir}/${asset.fileName}`,
          fixRotationX: asset.fixRotationX,
          fixRotationY: asset.fixRotationY,
          fixRotationZ: asset.fixRotationZ,
        });
      }
    } catch {}
  }

  return { builtin, custom };
}

function jsonRes(res: any, data: any, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

/** Map a readBody/JSON.parse error to the appropriate HTTP status + message. */
function bodyError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "Body too large") return { status: 413, message: "请求体过大" };
  return { status: 400, message: "Invalid JSON body" };
}

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50MB: accommodates base64-encoded 30MB uploads

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return;
      b += c.toString();
      if (b.length > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(b));
    req.on("error", () => resolve(b));
  });
}

function serveFile(
  res: any,
  filePath: string,
  baseDir: string,
  cache?: string,
): boolean {
  // Path traversal guard: resolved path must stay inside baseDir.
  // Use sep suffix to avoid prefix collisions (e.g. /app vs /app-evil).
  if (
    (!filePath.startsWith(baseDir + sep) && filePath !== baseDir) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    res.writeHead(404);
    res.end("Not Found");
    return true;
  }
  const headers: Record<string, string> = {
    "Content-Type": guessMime(filePath),
    "Access-Control-Allow-Origin": "*",
  };
  if (cache) headers["Cache-Control"] = cache;
  res.writeHead(200, headers);
  res.end(readFileSync(filePath));
  return true;
}

export interface EditorServeDirs {
  pluginDir: string;
  townDataDir: string;
}

export function resolveDirs(pluginDir: string): {
  extAssetsDir: string;
  townDataDir: string;
  soulsDir: string;
  defaultSoulsDir: string;
  draftConfigPath: string;
  publishedConfigPath: string;
  avatarsDir: string;
  animDir: string;
  customAssetsDir: string;
  catalogPath: string;
} {
  const townDataDir = join(pluginDir, "town-data");
  const customAssetsDir = join(townDataDir, "custom-assets");
  return {
    extAssetsDir: join(pluginDir, "assets"),
    townDataDir,
    soulsDir: join(townDataDir, "souls"),
    defaultSoulsDir: join(pluginDir, "town-souls"),
    draftConfigPath: join(townDataDir, "citizen-config-draft.json"),
    publishedConfigPath: join(townDataDir, "citizen-config.json"),
    avatarsDir: join(townDataDir, "avatars"),
    animDir: join(customAssetsDir, "animations"),
    customAssetsDir,
    catalogPath: join(customAssetsDir, "_catalog.json"),
  };
}

function ensureEditorDirs(pluginDir: string): void {
  const d = resolveDirs(pluginDir);
  for (const dir of [d.soulsDir, d.avatarsDir, d.animDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const modelsDir = join(d.customAssetsDir, "models");
  const charsDir = join(d.customAssetsDir, "characters");
  const thumbDir = join(d.customAssetsDir, "thumbnails");
  for (const dir of [modelsDir, charsDir, thumbDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(d.catalogPath))
    writeFileSync(
      d.catalogPath,
      JSON.stringify({ version: 1, assets: [] }),
    );
  migrateCatalogThumbnails(d.customAssetsDir, d.catalogPath);
}

function migrateCatalogThumbnails(customAssetsDir: string, catalogPath: string): void {
  try {
    const catalog = readCatalog(catalogPath);
    let changed = false;
    const thumbDir = join(customAssetsDir, "thumbnails");
    for (const asset of catalog.assets) {
      if (asset.thumbnailFileName) continue;
      if (!asset.thumbnail || !asset.thumbnail.startsWith("data:")) continue;
      const m = asset.thumbnail.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!m) continue;
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const outName = `${asset.id}.${ext}`;
      try {
        writeFileSync(join(thumbDir, outName), Buffer.from(m[2], "base64"));
        asset.thumbnailFileName = outName;
        delete asset.thumbnail;
        changed = true;
      } catch { /* skip this asset */ }
    }
    if (changed) {
      writeCatalog(catalogPath, catalog);
      console.log(`[agentshire] Migrated ${catalog.assets.filter((a: any) => a.thumbnailFileName).length} asset thumbnails to files`);
    }
  } catch {
    /* migration is best-effort */
  }
}

function loadAgentList(): { id: string; name: string; model?: string }[] {
  try {
    const rt = getTownRuntime();
    const cfg = rt.config.current() as any;
    return (cfg?.agents?.list ?? []).map((a: any) => ({
      id: a.id,
      name: a.identity?.name || a.name || a.id,
      model: a.model as string | undefined,
    }));
  } catch {
    return [];
  }
}

function loadSoulContent(
  personaKey: string,
  soulsDir: string,
  defaultSoulsDir: string,
): string | null {
  const userPath = join(soulsDir, `${personaKey}.md`);
  if (existsSync(userPath)) return readFileSync(userPath, "utf-8");
  const defaultPath = join(defaultSoulsDir, `${personaKey}.md`);
  if (existsSync(defaultPath)) return readFileSync(defaultPath, "utf-8");
  return null;
}

function readCatalog(catalogPath: string): any {
  try {
    return JSON.parse(readFileSync(catalogPath, "utf-8"));
  } catch {
    return { version: 1, assets: [] as any[] };
  }
}

function writeCatalog(catalogPath: string, catalog: any): void {
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
}

// ── ext-assets: Characters_1 / Map_1 asset library ──

function handleExtAssets(
  res: any,
  urlPath: string,
  extAssetsDir: string,
): boolean {
  const relPath = decodeURIComponent(urlPath.slice("/ext-assets/".length));
  const filePath = join(extAssetsDir, relPath);
  return serveFile(res, filePath, extAssetsDir, "public, max-age=86400");
}

// ── citizen-workshop/avatars: user-uploaded avatars ──

function handleCitizenAvatars(
  res: any,
  urlPath: string,
  avatarsDir: string,
): boolean {
  const fileName = decodeURIComponent(
    urlPath.slice("/citizen-workshop/avatars/".length),
  );
  const filePath = join(avatarsDir, fileName);
  return serveFile(res, filePath, avatarsDir, "public, max-age=3600");
}

// ── custom-assets/animations: custom character anim files ──

function handleAnimations(
  res: any,
  urlPath: string,
  animDir: string,
): boolean {
  const fileName = decodeURIComponent(
    urlPath.slice("/custom-assets/animations/".length),
  );
  const filePath = join(animDir, fileName);
  return serveFile(res, filePath, animDir, "public, max-age=86400");
}

// ── custom-assets API ──

async function handleCustomAssetsApi(
  req: any,
  res: any,
  route: string,
  customAssetsDir: string,
  catalogPath: string,
): Promise<boolean> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    const e = bodyError(err);
    jsonRes(res, { error: e.message }, e.status);
    return true;
  }

  if (route === "list") {
    const catalog = readCatalog(catalogPath);
    const filtered = body.kind
      ? catalog.assets.filter((a: any) => a.kind === body.kind)
      : catalog.assets;
    const assets = filtered.map((a: any) => {
      if (a.thumbnailFileName && (!a.thumbnail || a.thumbnail.startsWith("data:"))) {
        return { ...a, thumbnail: `/custom-assets/thumbnails/${a.thumbnailFileName}` };
      }
      return a;
    });
    jsonRes(res, { assets });
    return true;
  }

  if (route === "upload") {
    const catalog = readCatalog(catalogPath);
    if (catalog.assets.length >= 20) {
      jsonRes(res, { error: "最多添加 20 个自定义资产" }, 400);
      return true;
    }
    const buf = Buffer.from(body.data, "base64");
    if (buf.length > 30 * 1024 * 1024) {
      jsonRes(res, { error: "文件超过 30MB 限制" }, 400);
      return true;
    }
    const id = randomUUID();
    const fileName = `${id}.glb`;
    const subDir = body.kind === "character" ? "characters" : "models";
    const dir = join(customAssetsDir, subDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), buf);
    const now = new Date().toISOString();
    let thumbnailFileName: string | undefined;
    const thumbDir = join(customAssetsDir, "thumbnails");
    if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true });
    if (body.thumbnail && typeof body.thumbnail === "string" && body.thumbnail.startsWith("data:")) {
      const m = body.thumbnail.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        thumbnailFileName = `${id}.${ext}`;
        try { writeFileSync(join(thumbDir, thumbnailFileName), Buffer.from(m[2], "base64")); } catch { thumbnailFileName = undefined; }
      }
    }
    const asset: any = {
      id,
      kind: body.kind ?? "model",
      name: (body.name ?? "").slice(0, 20),
      fileName,
      fileSize: buf.length,
      createdAt: now,
      updatedAt: now,
      cells: body.cells,
      scale: body.scale,
      assetType: body.assetType,
      fixRotationX: body.fixRotationX,
      fixRotationY: body.fixRotationY,
      fixRotationZ: body.fixRotationZ,
    };
    if (thumbnailFileName) {
      asset.thumbnailFileName = thumbnailFileName;
    } else if (body.thumbnail) {
      asset.thumbnail = body.thumbnail;
    }
    catalog.assets.unshift(asset);
    writeCatalog(catalogPath, catalog);
    if (asset.thumbnailFileName) {
      asset.thumbnail = `/custom-assets/thumbnails/${asset.thumbnailFileName}`;
    }
    jsonRes(res, { asset });
    return true;
  }

  if (route === "update") {
    const catalog = readCatalog(catalogPath);
    const asset = catalog.assets.find((a: any) => a.id === body.id);
    if (!asset) {
      jsonRes(res, { error: "资产不存在" }, 404);
      return true;
    }
    for (const key of [
      "name",
      "cells",
      "scale",
      "assetType",
      "fixRotationX",
      "fixRotationY",
      "fixRotationZ",
    ]) {
      if (body[key] !== undefined)
        (asset as any)[key] =
          key === "name" ? body[key].slice(0, 20) : body[key];
    }
    if (body.thumbnail !== undefined && typeof body.thumbnail === "string" && body.thumbnail.startsWith("data:")) {
      const thumbDir = join(customAssetsDir, "thumbnails");
      if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true });
      const m = body.thumbnail.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const outName = `${asset.id}.${ext}`;
        try {
          if (asset.thumbnailFileName) {
            const old = join(thumbDir, asset.thumbnailFileName);
            if (existsSync(old)) unlinkSync(old);
          }
          writeFileSync(join(thumbDir, outName), Buffer.from(m[2], "base64"));
          asset.thumbnailFileName = outName;
          delete asset.thumbnail;
        } catch { asset.thumbnail = body.thumbnail; }
      }
    } else if (body.thumbnail !== undefined) {
      asset.thumbnail = body.thumbnail;
    }
    for (const key of ["animMapping", "detectedClips", "animFileUrls"]) {
      if (body[key] !== undefined) (asset as any)[key] = body[key];
    }
    asset.updatedAt = new Date().toISOString();
    writeCatalog(catalogPath, catalog);
    jsonRes(res, { asset });
    return true;
  }

  if (route === "delete") {
    const catalog = readCatalog(catalogPath);
    const idx = catalog.assets.findIndex((a: any) => a.id === body.id);
    if (idx < 0) {
      jsonRes(res, { error: "资产不存在" }, 404);
      return true;
    }
    const asset = catalog.assets[idx];
    const subDir = asset.kind === "character" ? "characters" : "models";
    try {
      const fp = join(customAssetsDir, subDir, asset.fileName);
      if (existsSync(fp)) unlinkSync(fp);
    } catch {
      /* gone */
    }
    if (asset.thumbnailFileName) {
      try {
        const tp = join(customAssetsDir, "thumbnails", asset.thumbnailFileName);
        if (existsSync(tp)) unlinkSync(tp);
      } catch { /* gone */ }
    }
    if (asset.animFileUrls && Array.isArray(asset.animFileUrls)) {
      const animDir = join(customAssetsDir, "animations");
      for (const url of asset.animFileUrls) {
        const fn = (url as string).split("/").pop();
        if (fn) {
          try {
            const p = join(animDir, fn);
            if (existsSync(p)) unlinkSync(p);
          } catch {
            /* gone */
          }
        }
      }
    }
    catalog.assets.splice(idx, 1);
    writeCatalog(catalogPath, catalog);
    jsonRes(res, { success: true });
    return true;
  }

  if (route === "optimize") {
    const catalog = readCatalog(catalogPath);
    const asset = catalog.assets.find((a: any) => a.id === body.id);
    if (!asset) {
      jsonRes(res, { error: "资产不存在" }, 404);
      return true;
    }
    const subDir = asset.kind === "character" ? "characters" : "models";
    const filePath = join(customAssetsDir, subDir, asset.fileName);
    if (!existsSync(filePath)) {
      jsonRes(res, { error: "文件不存在" }, 404);
      return true;
    }
    try {
      const { NodeIO } = await import("@gltf-transform/core");
      const { dedup, flatten, prune, quantize } = await import(
        "@gltf-transform/functions"
      );
      const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      const doc = await io.read(filePath);
      await doc.transform(dedup(), flatten(), prune(), quantize());
      const outBuf = await io.writeBinary(doc);
      const originalSize = statSync(filePath).size;
      writeFileSync(filePath, Buffer.from(outBuf));
      const newSize = statSync(filePath).size;
      asset.fileSize = newSize;
      asset.updatedAt = new Date().toISOString();
      writeCatalog(catalogPath, catalog);
      jsonRes(res, {
        success: true,
        originalSize,
        newSize,
        saved: originalSize - newSize,
        ratio: Math.round((1 - newSize / originalSize) * 100),
      });
    } catch (e: any) {
      jsonRes(
        res,
        { error: `优化失败: ${e.message ?? "未知错误"}` },
        500,
      );
    }
    return true;
  }

  jsonRes(res, { error: "Unknown API" }, 404);
  return true;
}

// ── citizen-workshop API ──

function resolveAssetThumbnailUrl(asset: any): string | undefined {
  if (asset?.thumbnailFileName) return `/custom-assets/thumbnails/${asset.thumbnailFileName}`;
  if (asset?.thumbnail && !asset.thumbnail.startsWith("data:")) return asset.thumbnail;
  return undefined;
}

function resolveAvatarUrlServer(
  avatarUrl: string | undefined,
  avatarId: string,
  catalog: any,
): string {
  if (avatarUrl && !avatarUrl.startsWith("data:")) return avatarUrl;

  if (avatarId.startsWith("custom-")) {
    const assetId = avatarId.replace("custom-", "");
    const asset = (catalog.assets ?? []).find((a: any) => a.id === assetId);
    const thumbUrl = resolveAssetThumbnailUrl(asset);
    if (thumbUrl) return thumbUrl;
    if (asset?.thumbnail) return asset.thumbnail;
  }

  if (avatarId.startsWith("lib-")) {
    const libId = avatarId.replace("lib-", "");
    return `/ext-assets/Characters_1/thumbnails/lib-${libId}.webp`;
  }

  return `/assets/avatars/${avatarId}.webp`;
}

function resolveModelUrlServer(
  avatarId: string,
  catalog: any,
): string {
  if (avatarId.startsWith("custom-")) {
    const assetId = avatarId.replace("custom-", "");
    const asset = (catalog.assets ?? []).find((a: any) => a.id === assetId);
    if (asset?.fileName) return `/custom-assets/characters/${asset.fileName}`;
  }

  if (avatarId.startsWith("lib-")) {
    const libId = avatarId.replace("lib-", "");
    return `/ext-assets/Characters_1/gLTF/Characters/Character_${libId}_1_1.glb`;
  }

  const slug = avatarId.replace("char-", "");
  return `/assets/models/characters/character-${slug}.glb`;
}

const DEFAULT_STEWARD_NAME = "OpenClaw";
const DEFAULT_STEWARD_BIO = "干练御姐，做事利落，职业经理型，善于引导对话，通过调度居民完成任务";

function composeStewardSoul(
  name: string,
  bio: string,
  pluginDir: string,
): string {
  const now = new Date().toISOString().split("T")[0];
  const tplPath = join(pluginDir, "town-souls", "SOUL_tpl.md");
  let tplContent = "";
  try {
    tplContent = readFileSync(tplPath, "utf-8");
  } catch {
    console.warn("[citizen-workshop] SOUL_tpl.md not found, using empty template");
  }
  return [
    `# ${name}`,
    "",
    `> 诞生日期: ${now}`,
    "## 人设风格",
    bio,
    "",
    tplContent,
  ].join("\n");
}

function isStewardModified(src: any): boolean {
  return (src.name ?? "") !== DEFAULT_STEWARD_NAME || (src.bio ?? "") !== DEFAULT_STEWARD_BIO;
}

function composeSoulFromConfig(
  name: string,
  bio: string,
  specialty: string,
  customSoul: string,
  pluginDir: string,
): string {
  const now = new Date().toISOString().split("T")[0];
  const persona = customSoul || bio;
  const tplPath = join(pluginDir, "town-souls", "CITIZEN_tpl.md");
  if (existsSync(tplPath)) {
    return readFileSync(tplPath, "utf-8")
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{date\}\}/g, now)
      .replace(/\{\{specialty\}\}/g, specialty || "通用助手")
      .replace(/\{\{bio\}\}/g, bio)
      .replace(/\{\{persona\}\}/g, persona);
  }
  return `# ${name}\n\n> 诞生日期: ${now}\n> 岗位: ${specialty || "通用助手"}\n> 简介: ${bio}\n\n## 人设核心\n\n你的名字叫${name}，你的专业技能是${specialty || "通用助手"}。\n\n${persona}\n\n---\n`;
}

function buildPublishedConfig(
  draft: any,
  soulsDir: string,
  defaultSoulsDir: string,
  catalog: any,
  pluginDir: string,
): any {
  const characters: any[] = [];
  const defaultModelTransform = {
    scale: 2.8,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
  };

  const resolveEntry = (
    role: "user" | "steward" | "citizen",
    src: any,
  ): any => {
    let persona = src.persona || "";
    const isCustom = !!src.useCustomPersona || !persona;
    let personaFile = "";

    if (role === "steward") {
      if (isStewardModified(src)) {
        const soulText = composeStewardSoul(src.name ?? "", src.bio ?? "", pluginDir);
        writeFileSync(join(soulsDir, "soul.md"), soulText, "utf-8");
        personaFile = join(soulsDir, "soul.md");
        persona = "soul";
      } else {
        const defaultPath = join(defaultSoulsDir, "SOUL.md");
        personaFile = existsSync(defaultPath) ? defaultPath : "";
      }
    } else if (role === "citizen" && isCustom) {
      const soulText = composeSoulFromConfig(
        src.name ?? "",
        src.bio ?? "",
        src.specialty ?? "",
        src.customSoul ?? "",
        pluginDir,
      );
      const citizenId = src.id ?? `citizen-${Date.now()}`;
      const soulPath = join(soulsDir, `${citizenId}.md`);
      writeFileSync(soulPath, soulText, "utf-8");
      personaFile = soulPath;
      persona = citizenId;
    } else if (role === "citizen" && !isCustom && persona) {
      const userPath = join(soulsDir, `${persona}.md`);
      const defaultPath = join(defaultSoulsDir, `${persona}.md`);
      personaFile = existsSync(userPath) ? userPath : existsSync(defaultPath) ? defaultPath : "";
    }

    const animData = resolveAnimData(src, catalog);
    return {
      id: src.id ?? role,
      role,
      name: src.name ?? "",
      avatarUrl: resolveAvatarUrlServer(src.avatarUrl, src.avatarId, catalog),
      modelUrl: resolveModelUrlServer(src.avatarId, catalog),
      avatarId: src.avatarId ?? "",
      modelSource: src.modelSource ?? "builtin",
      bio: src.bio ?? "",
      specialty: src.specialty ?? "",
      persona,
      personaFile: personaFile ? relative(pluginDir, personaFile) : "",
      homeId: src.homeId ?? "",
      agentEnabled: role === "citizen" ? !!src.agentEnabled : false,
      modelTransform: resolveModelTransform(src, draft) ?? defaultModelTransform,
      animMapping: animData.animMapping ?? {},
      animFileUrls: animData.animFileUrls ?? [],
      detectedClips: animData.detectedClips ?? [],
      modelRef: src.modelRef ?? "",
    };
  };

  function resolveModelTransform(srcEntry: any, _draftConfig: any): any {
    if (srcEntry?.modelTransform && typeof srcEntry.modelTransform === "object") return srcEntry.modelTransform;
    return null;
  }

  function resolveAnimData(src: any, cat: any): any {
    const avatarId = src.avatarId ?? "";
    if (avatarId.startsWith("custom-")) {
      const assetId = avatarId.replace("custom-", "");
      const asset = (cat.assets ?? []).find((a: any) => a.id === assetId);
      if (asset) {
        const mapping = asset.animMapping && Object.values(asset.animMapping).some((v: any) => v)
          ? asset.animMapping
          : src.animMapping;
        return {
          animMapping: mapping ?? {},
          detectedClips: asset.detectedClips ?? [],
          animFileUrls: asset.animFileUrls ?? [],
        };
      }
    }
    return {
      animMapping: src.animMapping ?? {},
      animFileUrls: src.animFileUrls ?? [],
      detectedClips: src.detectedClips ?? [],
    };
  }

  if (draft.user) characters.push(resolveEntry("user", draft.user));
  if (draft.steward) characters.push(resolveEntry("steward", draft.steward));
  if (Array.isArray(draft.citizens)) {
    for (const c of draft.citizens) {
      characters.push(resolveEntry("citizen", c));
    }
  }

  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    characters,
  };
}

function syncTownDefaults(published: any, pluginDir: string): void {
  try {
    const chars: any[] = published.characters ?? [];
    const steward = chars.find((c: any) => c.role === "steward");
    const user = chars.find((c: any) => c.role === "user");
    const citizens = chars.filter((c: any) => c.role === "citizen");

    const townDefaults = {
      townName: "夏尔",
      steward: {
        id: "steward",
        name: steward?.name ?? "shire",
        personaFile: steward?.personaFile ?? "",
        characterKey: steward?.avatarId ?? "char-female-b",
        role: "steward",
        specialty: "管家",
        bio: steward?.bio ?? "",
      },
      user: {
        id: "user",
        name: user?.name ?? "镇长",
        characterKey: user?.avatarId ?? "char-male-c",
        role: "user",
        specialty: "镇长",
        bio: user?.bio || "小镇的主人，负责决策方向",
      },
      citizens: citizens.map((c: any) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty || "通用",
        role: c.specialty || "通用",
        personaFile: c.personaFile ?? "",
        characterKey: c.avatarId ?? "",
        homeId: c.homeId ?? "",
        bio: c.bio ?? "",
      })),
    };

    const content = JSON.stringify(townDefaults, null, 2);

    const frontendPath = join(pluginDir, "town-frontend", "src", "data", "town-defaults.json");
    writeFileSync(frontendPath, content, "utf-8");

    const stewardWorkspace = getStewardWorkspaceDir();
    if (existsSync(stewardWorkspace)) {
      const resolvePersonaFile = (p: string) =>
        p && !p.startsWith("/") ? join(pluginDir, p) : p;
      const stewardDefaults = {
        ...townDefaults,
        steward: { ...townDefaults.steward, personaFile: resolvePersonaFile(townDefaults.steward.personaFile) },
        citizens: townDefaults.citizens.map((c: any) => ({ ...c, personaFile: resolvePersonaFile(c.personaFile) })),
      };
      writeFileSync(join(stewardWorkspace, "town-defaults.json"), JSON.stringify(stewardDefaults, null, 2), "utf-8");
    }

    console.log("[citizen-workshop] synced town-defaults.json to frontend + steward workspace");
  } catch (err: any) {
    console.warn("[citizen-workshop] Failed to sync town-defaults.json:", err?.message);
  }
}

function computeChangeset(
  oldConfig: any | null,
  newConfig: any,
  soulsDir: string,
  defaultSoulsDir: string,
  pluginDir: string,
): {
  totalCharacters: number;
  agentToCreate: string[];
  agentToDisable: string[];
  agentToUpdateSoul: string[];
  stewardSoulUpdated: boolean;
  stewardModelUpdated: boolean;
  changes: Array<{
    action: "create" | "disable" | "update_soul";
    citizenId: string;
    citizenName: string;
    agentId: string;
    soulContent?: string;
    specialty?: string;
  }>;
} {
  const oldChars: any[] = oldConfig?.characters ?? [];
  const newChars: any[] = newConfig?.characters ?? [];
  const oldMap = new Map(oldChars.map((c: any) => [c.id, c]));
  const newMap = new Map(newChars.map((c: any) => [c.id, c]));

  const agentToCreate: string[] = [];
  const agentToDisable: string[] = [];
  const agentToUpdateSoul: string[] = [];
  let stewardSoulUpdated = false;
  let stewardModelUpdated = false;
  const changes: Array<{
    action: "create" | "disable" | "update_soul";
    citizenId: string;
    citizenName: string;
    agentId: string;
    soulContent?: string;
    specialty?: string;
    modelRef?: string;
  }> = [];

  function buildAgentId(citizenId: string): string {
    return `citizen-${citizenId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }

  function resolveSoulFromFile(entry: any): string {
    if (entry.personaFile) {
      const resolved = entry.personaFile.startsWith("/")
        ? entry.personaFile
        : join(pluginDir, entry.personaFile);
      if (existsSync(resolved)) {
        return readFileSync(resolved, "utf-8");
      }
    }
    if (entry.persona) {
      const content = loadSoulContent(entry.persona, soulsDir, defaultSoulsDir);
      if (content) return content;
    }
    return "";
  }

  // ── Steward change detection ──
  const newSteward = newChars.find((c: any) => c.role === "steward");
  const oldSteward = oldChars.find((c: any) => c.role === "steward");
  if (newSteward) {
    const oldName = oldSteward?.name ?? DEFAULT_STEWARD_NAME;
    const oldBio = oldSteward?.bio ?? DEFAULT_STEWARD_BIO;
    if (newSteward.name !== oldName || newSteward.bio !== oldBio) {
      stewardSoulUpdated = true;
      const stewardSoulContent = resolveSoulFromFile(newSteward);
      if (stewardSoulContent) {
        try {
          const stewardWorkspace = getStewardWorkspaceDir();
          if (existsSync(stewardWorkspace)) {
            writeFileSync(join(stewardWorkspace, "SOUL.md"), stewardSoulContent, "utf-8");
            const identityLines = [
              `# ${newSteward.name}`,
              "",
              `- **Name:** ${newSteward.name}`,
              `- **Role:** 管家`,
            ];
            writeFileSync(join(stewardWorkspace, "IDENTITY.md"), identityLines.join("\n") + "\n", "utf-8");
            console.log("[citizen-workshop] Updated steward SOUL.md + IDENTITY.md in main agent workspace");
          }
        } catch (err: any) {
          console.error("[citizen-workshop] Failed to update steward workspace SOUL.md:", err?.message);
        }
      }
    }

    // ── Steward modelRef change detection ──
    // The steward is the main Agent (town-steward) in openclaw.json, NOT managed by
    // citizen-agent-manager. We detect the change here and apply it in the async
    // publish handler (computeChangeset itself is synchronous).
    const oldModelRef = oldSteward?.modelRef ?? "";
    const newModelRef = newSteward.modelRef ?? "";
    if (newModelRef !== oldModelRef) {
      stewardModelUpdated = true;
    }
  }

  // ── Citizen change detection ──
  for (const [id, nc] of newMap) {
    if (nc.role !== "citizen") continue;
    const oc = oldMap.get(id);
    const newEnabled = !!nc.agentEnabled;
    const oldEnabled = !!oc?.agentEnabled;
    const agentId = buildAgentId(id);

    if (newEnabled && !oldEnabled) {
      agentToCreate.push(nc.name);
      changes.push({ action: "create", citizenId: id, citizenName: nc.name, agentId, soulContent: resolveSoulFromFile(nc), specialty: nc.specialty, modelRef: nc.modelRef || undefined });
    } else if (newEnabled && oldEnabled && !oc?.agentId) {
      agentToCreate.push(nc.name);
      changes.push({ action: "create", citizenId: id, citizenName: nc.name, agentId, soulContent: resolveSoulFromFile(nc), specialty: nc.specialty, modelRef: nc.modelRef || undefined });
    } else if (!newEnabled && oldEnabled) {
      agentToDisable.push(nc.name ?? oc?.name ?? id);
      changes.push({ action: "disable", citizenId: id, citizenName: nc.name ?? id, agentId: oc?.agentId ?? agentId });
    } else if (newEnabled && oldEnabled) {
      const soulChanged = nc.persona !== oc?.persona
        || nc.name !== oc?.name
        || nc.bio !== oc?.bio
        || nc.specialty !== oc?.specialty;
      const modelChanged = (nc.modelRef || "") !== (oc?.modelRef || "");
      if (soulChanged || modelChanged) {
        agentToUpdateSoul.push(nc.name);
        changes.push({ action: "update_soul", citizenId: id, citizenName: nc.name, agentId: oc?.agentId ?? agentId, soulContent: resolveSoulFromFile(nc), specialty: nc.specialty, modelRef: nc.modelRef || undefined });
      }
    }
  }

  for (const [id, oc] of oldMap) {
    if (oc.role !== "citizen" || !oc.agentEnabled) continue;
    if (!newMap.has(id)) {
      agentToDisable.push(oc.name ?? id);
      changes.push({ action: "disable", citizenId: id, citizenName: oc.name ?? id, agentId: oc?.agentId ?? buildAgentId(id) });
    }
  }

  return { totalCharacters: newChars.length, agentToCreate, agentToDisable, agentToUpdateSoul, stewardSoulUpdated, stewardModelUpdated, changes };
}

const SOUL_GEN_TIMEOUT_MS = 90_000;

async function generateSoulViaAgent(system: string, user: string): Promise<string> {
  const rt = getTownRuntime();
  const cfg = rt.config.current() as any;
  const sessionKey = `agent:town-steward:soul-gen:${Date.now()}`;
  const message = `【系统指令】\n${system}\n\n【用户输入】\n${user}`;

  let responseText = "";
  const agentDone = rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: buildTownInboundContext({
      rt,
      body: message,
      from: "agentshire:user",
      to: "agentshire:steward",
      sessionKey,
      accountId: "default",
    }),
    cfg,
    dispatcherOptions: {
      deliver: async (payload: any) => {
        const text = payload?.text ?? payload?.body;
        if (text) responseText = text;
      },
    },
  });

  const timeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error("Soul generation timed out")), SOUL_GEN_TIMEOUT_MS),
  );

  await Promise.race([agentDone, timeout]);
  return responseText;
}

async function handleCitizenWorkshopApi(
  req: any,
  res: any,
  route: string,
  pluginDir: string,
): Promise<boolean> {
  const d = resolveDirs(pluginDir);
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    const e = bodyError(err);
    jsonRes(res, { error: e.message }, e.status);
    return true;
  }

  if (route === "load") {
    if (existsSync(d.draftConfigPath)) {
      try {
        const config = JSON.parse(readFileSync(d.draftConfigPath, "utf-8"));
        jsonRes(res, { config });
      } catch {
        jsonRes(res, { config: null });
      }
    } else {
      jsonRes(res, { config: null });
    }
    return true;
  }

  if (route === "save") {
    writeFileSync(
      d.draftConfigPath,
      JSON.stringify(body.config, null, 2),
      "utf-8",
    );
    if (body.souls && typeof body.souls === "object") {
      for (const [name, content] of Object.entries(body.souls)) {
        writeFileSync(join(d.soulsDir, `${name}.md`), content as string, "utf-8");
      }
    }
    jsonRes(res, { success: true });
    return true;
  }

  if (route === "publish") {
    const draftPath = d.draftConfigPath;
    if (!existsSync(draftPath)) {
      jsonRes(res, { error: "没有草稿可发布，请先保存" }, 400);
      return true;
    }
    try {
      const draft = JSON.parse(readFileSync(draftPath, "utf-8"));
      if (body.souls && typeof body.souls === "object") {
        for (const [name, content] of Object.entries(body.souls)) {
          writeFileSync(join(d.soulsDir, `${name}.md`), content as string, "utf-8");
        }
      }
      const catalog = readCatalog(d.catalogPath);
      const published = buildPublishedConfig(draft, d.soulsDir, d.defaultSoulsDir, catalog, pluginDir);
      let oldPublished: any = null;
      if (existsSync(d.publishedConfigPath)) {
        try { oldPublished = JSON.parse(readFileSync(d.publishedConfigPath, "utf-8")); } catch {}
      }

      if (oldPublished?.characters) {
        const oldMap = new Map(oldPublished.characters.map((c: any) => [c.id, c]));
        for (const entry of published.characters) {
          const old: any = oldMap.get(entry.id);
          if (!old) continue;
          if (old.agentId && !entry.agentId) entry.agentId = old.agentId;
          if (old.agentStatus && !entry.agentStatus) entry.agentStatus = old.agentStatus;
        }
      }

      const changeset = computeChangeset(oldPublished, published, d.soulsDir, d.defaultSoulsDir, pluginDir);

      let agentResults: any[] = [];
      let agentError: string | null = null;

      console.log(`[citizen-workshop] publish: ${changeset.changes.length} agent changes to process`);

      if (changeset.changes.length > 0) {
        try {
          const { applyAgentChanges } = await import("./citizen-agent-manager.js");
          agentResults = await applyAgentChanges(changeset.changes);
          for (const r of agentResults) {
            const entry = published.characters.find((c: any) => c.id === r.citizenId);
            if (!entry) continue;
            if (r.success && (r.action === "create" || r.action === "update_soul")) {
              entry.agentId = r.agentId;
              entry.agentStatus = "active";
            } else if (r.success && r.action === "disable") {
              delete entry.agentId;
              entry.agentStatus = "stopped";
            } else if (!r.success) {
              entry.agentStatus = "error";
            }
          }
          const failed = agentResults.filter((r: any) => !r.success);
          if (failed.length > 0) {
            agentError = failed.map((r: any) => `${r.citizenId}: ${r.error}`).join("; ");
          }
        } catch (err: any) {
          agentError = err?.message ?? "Agent 管理模块加载失败";
          for (const ch of changeset.changes) {
            if (ch.action === "create" || ch.action === "update_soul") {
              const entry = published.characters.find((c: any) => c.id === ch.citizenId);
              if (entry) entry.agentStatus = "error";
            }
          }
        }
      }

      writeFileSync(
        d.publishedConfigPath,
        JSON.stringify(published, null, 2),
        "utf-8",
      );

      syncTownDefaults(published, pluginDir);

      // ── Steward (town-steward) model ref update ──
      // The steward is the main Agent in openclaw.json, not a citizen agent.
      // Apply its modelRef change directly to openclaw.json so channel.ts /
      // llm-agent-proxy pick up the new model on the next conversation.
      if (changeset.stewardModelUpdated) {
        try {
          const { updateAgentModel } = await import("./citizen-agent-manager.js");
          const stewardEntry = published.characters.find((c: any) => c.role === "steward");
          const newModelRef = stewardEntry?.modelRef || undefined;
          updateAgentModel("town-steward", newModelRef);
          console.log(`[citizen-workshop] Updated steward (town-steward) model to ${newModelRef ?? "(default)"}`);
        } catch (err: any) {
          console.error("[citizen-workshop] Failed to update steward model:", err?.message);
        }
      }

      const hasAgentChanges = changeset.changes.length > 0;
      const allSuccess = !agentError;

      if (hasAgentChanges && !allSuccess) {
        jsonRes(res, {
          success: false,
          error: `发布配置已保存，但 Agent 操作失败: ${agentError}`,
          publishedAt: published.publishedAt,
          changeset,
          agentResults: agentResults.length > 0 ? agentResults : undefined,
        });
      } else {
        jsonRes(res, {
          success: true,
          publishedAt: published.publishedAt,
          changeset,
          agentResults: agentResults.length > 0 ? agentResults : undefined,
          stewardSoulUpdated: changeset.stewardSoulUpdated || undefined,
        });
      }
    } catch (e: any) {
      console.error("[citizen-workshop] publish error:", e);
      jsonRes(res, { error: `发布失败: ${e.message ?? "未知错误"}`, stack: e.stack }, 500);
    }
    return true;
  }

  if (route === "load-published") {
    if (existsSync(d.publishedConfigPath)) {
      try {
        const config = JSON.parse(readFileSync(d.publishedConfigPath, "utf-8"));
        jsonRes(res, { config });
      } catch {
        jsonRes(res, { config: null });
      }
    } else {
      jsonRes(res, { config: null });
    }
    return true;
  }

  if (route === "load-soul") {
    const content = loadSoulContent(
      body.name as string,
      d.soulsDir,
      d.defaultSoulsDir,
    );
    jsonRes(res, { content });
    return true;
  }

  if (route === "agents") {
    jsonRes(res, { agents: loadAgentList() });
    return true;
  }

  if (route === "update-agent-model") {
    try {
      // NOTE: request body was already consumed at the top of
      // handleCitizenWorkshopApi() via `await readBody(req)`. Re-reading
      // here would hang forever waiting for an 'end' event that already
      // fired. Reuse the already-parsed `body` instead.
      const agentId = String(body?.agentId ?? "");
      const modelRef = body?.modelRef ? String(body.modelRef) : undefined;
      if (!agentId) {
        jsonRes(res, { error: "agentId required" }, 400);
        return true;
      }
      const { updateAgentModel } = await import("./citizen-agent-manager.js");
      updateAgentModel(agentId, modelRef);

      // Also update modelRef in citizen-config.json (published) so that
      // load-published returns the correct value on page refresh.
      // For steward, the citizenId is "steward"; for citizens, strip the
      // "citizen-" prefix from agentId to get the npcId.
      const citizenId = agentId === "town-steward" ? "steward" : agentId.replace(/^citizen-/, "");
      try {
        if (existsSync(d.publishedConfigPath)) {
          const pub = JSON.parse(readFileSync(d.publishedConfigPath, "utf-8"));
          const chars: any[] = pub.characters ?? [];
          const entry = chars.find((c: any) => c.id === citizenId);
          if (entry) {
            if (modelRef) entry.modelRef = modelRef;
            else delete entry.modelRef;
            writeFileSync(d.publishedConfigPath, JSON.stringify(pub, null, 2), "utf-8");
          }
        }
      } catch (pubErr: any) {
        console.warn("[citizen-workshop] Failed to sync modelRef to citizen-config.json:", pubErr?.message);
      }

      jsonRes(res, { success: true, agentId, model: modelRef });
    } catch (err: any) {
      jsonRes(res, { error: err?.message ?? "Failed to update agent model" }, 500);
    }
    return true;
  }

  if (route === "get-agent-config") {
    try {
      const agentId = String(body?.agentId ?? "");
      if (!agentId) {
        jsonRes(res, { error: "agentId required" }, 400);
        return true;
      }
      const { getAgentConfig } = await import("./citizen-agent-manager.js");
      const agent = getAgentConfig(agentId);
      jsonRes(res, { success: true, agentId, agent: agent ?? null });
    } catch (err: any) {
      jsonRes(res, { error: err?.message ?? "Failed to get agent config" }, 500);
    }
    return true;
  }

  if (route === "update-agent-config") {
    try {
      const agentId = String(body?.agentId ?? "");
      const patch = body?.patch ?? {};
      if (!agentId) {
        jsonRes(res, { error: "agentId required" }, 400);
        return true;
      }
      const { updateAgentConfig } = await import("./citizen-agent-manager.js");
      updateAgentConfig(agentId, patch);
      jsonRes(res, { success: true, agentId });
    } catch (err: any) {
      jsonRes(res, { error: err?.message ?? "Failed to update agent config" }, 500);
    }
    return true;
  }

  if (route === "models") {
    try {
      const m = await import("./model-config.js");
      const file = m.readModelsConfig();
      const options: Array<{ value: string; label: string; providerId: string; modelId: string; contextWindow?: number }> = [];
      for (const [pid, prov] of Object.entries(file.providers ?? {})) {
        const p = prov as any;
        for (const model of p.models ?? []) {
          options.push({
            value: `${pid}/${model.id}`,
            label: `${model.name ?? model.id} (${pid})`,
            providerId: pid,
            modelId: model.id,
            contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : undefined,
          });
        }
      }
      jsonRes(res, { options });
    } catch (err: any) {
      jsonRes(res, { options: [], error: err?.message });
    }
    return true;
  }

  if (route === "buildings") {
    try {
      const mapDraftPath = join(pluginDir, "town-frontend", "town-map.json");
      let buildings: any[] = [];
      if (existsSync(mapDraftPath)) {
        const map = JSON.parse(readFileSync(mapDraftPath, "utf-8"));
        buildings = (map.buildings ?? [])
          .filter((b: any) => b.role === "house")
          .map((b: any) => ({
            id: b.id,
            name: b.displayName || b.modelKey || b.id,
          }));
      }
      jsonRes(res, { buildings });
    } catch {
      jsonRes(res, { buildings: [] });
    }
    return true;
  }

  if (route === "upload-avatar") {
    const { fileName, imageData } = body as {
      fileName: string;
      imageData: string;
    };
    if (!fileName || !imageData) {
      jsonRes(res, { error: "Missing data" }, 400);
      return true;
    }
    const safeName = fileName.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const ext = imageData.startsWith("data:image/png") ? ".png" : ".webp";
    const base64 = imageData.split(",")[1];
    if (!base64) {
      jsonRes(res, { error: "Invalid image data" }, 400);
      return true;
    }
    const outName = `${safeName}${ext}`;
    writeFileSync(join(d.avatarsDir, outName), Buffer.from(base64, "base64"));
    jsonRes(res, {
      success: true,
      url: `/citizen-workshop/avatars/${outName}`,
    });
    return true;
  }

  if (route === "generate-soul") {
    const { name, bio, industry: _industry, specialty } = body as {
      name: string;
      bio: string;
      industry: string;
      specialty: string;
    };
    if (!name || !bio) {
      jsonRes(res, { error: "Missing name/bio" }, 400);
      return true;
    }
    try {
      const { chat, isAvailable } = await import("./llm-agent-proxy.js");
      const { buildPersonaPrompt } = await import("./soul-prompt-template.js");
      const prompt = buildPersonaPrompt({ name, bio, specialty: specialty || "通用助手" });

      if (isAvailable()) {
        const result = await chat({
          system: prompt.system,
          user: prompt.user,
          maxTokens: 2000,
          temperature: 0.8,
          stop: [],
        });
        if (result.text) {
          jsonRes(res, { content: result.text });
          return true;
        }
      }

      const text = await generateSoulViaAgent(prompt.system, prompt.user);
      if (text) {
        jsonRes(res, { content: text });
      } else {
        jsonRes(res, { error: "LLM 返回为空" }, 500);
      }
    } catch (err: any) {
      console.error("[citizen-workshop] generate-soul error:", err?.message);
      jsonRes(res, { error: `生成失败: ${err?.message ?? "未知错误"}` }, 500);
    }
    return true;
  }

  if (route === "upload-anim") {
    const { data, fileName } = body as { data: string; fileName?: string };
    if (!data) {
      jsonRes(res, { error: "Missing data" }, 400);
      return true;
    }
    const id = randomUUID();
    const safeName = (fileName || "anim").replace(/[^a-zA-Z0-9_\-\.]/g, "_");
    const outName = `${id}_${safeName}.glb`;
    writeFileSync(join(d.animDir, outName), Buffer.from(data, "base64"));
    jsonRes(res, {
      success: true,
      url: `/custom-assets/animations/${outName}`,
      id,
    });
    return true;
  }

  if (route === "delete-anim") {
    const { url } = body as { url: string };
    if (!url) {
      jsonRes(res, { error: "Missing url" }, 400);
      return true;
    }
    const fn = url.split("/").pop();
    if (fn) {
      const filePath = join(d.animDir, fn);
      if (filePath.startsWith(d.animDir) && existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
    jsonRes(res, { success: true });
    return true;
  }

  jsonRes(res, { error: "Unknown API" }, 404);
  return true;
}

// ── Model (LLM provider) management API ──

async function handleModelsApi(
  req: any,
  res: any,
  route: string,
): Promise<boolean> {
  let body: any = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch (err) {
    const e = bodyError(err);
    jsonRes(res, { error: e.message }, e.status);
    return true;
  }

  try {
    const m = await import("./model-config.js");
    switch (route) {
      case "load": {
        const file = m.readModelsConfig();
        jsonRes(res, { providers: file.providers, defaultModel: m.readDefaultModel() });
        return true;
      }
      case "get-default": {
        jsonRes(res, { success: true, defaultModel: m.readDefaultModel() });
        return true;
      }
      case "set-default": {
        const ref = m.writeDefaultModel(body.modelRef);
        jsonRes(res, { success: true, defaultModel: ref });
        return true;
      }
      case "save": {
        if (!body.providers || typeof body.providers !== "object") {
          jsonRes(res, { error: "providers object required" }, 400);
          return true;
        }
        m.writeModelsConfig(body.providers);
        jsonRes(res, { success: true });
        return true;
      }
      case "add-provider": {
        const next = m.addProvider(String(body.id ?? ""), body.provider ?? {});
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "update-provider": {
        const next = m.updateProvider(String(body.id ?? ""), body.provider ?? {});
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "delete-provider": {
        const next = m.deleteProvider(String(body.id ?? ""));
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "add-model": {
        const next = m.addModel(String(body.providerId ?? ""), body.model ?? {});
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "update-model": {
        const next = m.updateModel(String(body.providerId ?? ""), String(body.modelId ?? ""), body.model ?? {});
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "delete-model": {
        const next = m.deleteModel(String(body.providerId ?? ""), String(body.modelId ?? ""));
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "import": {
        const mode = (body.mode ?? "append") as "append" | "new" | "replace";
        const next = m.importModels(body.file ?? { providers: {} }, mode);
        jsonRes(res, { success: true, providers: next });
        return true;
      }
      case "export": {
        const file = m.exportModels();
        jsonRes(res, { success: true, file });
        return true;
      }
      default:
        jsonRes(res, { error: "Unknown API" }, 404);
        return true;
    }
  } catch (err: any) {
    const code = err?.code ?? "INTERNAL_ERROR";
    const message = err?.message ?? "Internal error";
    jsonRes(res, { error: message, code }, 400);
    return true;
  }
}

// ── Claw (OpenClaw settings + sessions) API ──

interface SessionSummary {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  chatType: string;
  status: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  modelProvider: string;
  model: string;
  contextTokens: number;
  updatedAt: number;
  startedAt: number;
  endedAt: number;
  runtimeMs: number;
  compactionCount: number;
}

/**
 * Scan ~/.openclaw/agents/<agentId>/sessions/sessions.json and collect a flat
 * list of session summaries with token usage. Each sessions.json maps
 * sessionKey → metadata; we surface the fields the UI needs.
 */
function collectSessionSummaries(): SessionSummary[] {
  const root = stateDir();
  const agentsDir = join(root, "agents");
  if (!existsSync(agentsDir)) return [];

  // Build agentId → name map from openclaw.json for friendly labels.
  const agentNames = new Map<string, string>();
  try {
    const cfg = JSON.parse(readFileSync(join(root, "openclaw.json"), "utf-8"));
    for (const a of cfg?.agents?.list ?? []) {
      agentNames.set(a.id, a.identity?.name || a.name || a.id);
    }
  } catch { /* ignore */ }

  const out: SessionSummary[] = [];
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const sessionsJsonPath = join(agentsDir, agentId, "sessions", "sessions.json");
    if (!existsSync(sessionsJsonPath)) continue;
    let sessions: any;
    try {
      sessions = JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
    } catch {
      continue;
    }
    if (!sessions || typeof sessions !== "object") continue;
    for (const [sessionKey, meta] of Object.entries(sessions)) {
      const m = meta as any;
      if (!m || typeof m !== "object") continue;
      out.push({
        sessionKey,
        sessionId: m.sessionId ?? "",
        agentId,
        agentName: agentNames.get(agentId) ?? agentId,
        chatType: m.chatType ?? "direct",
        status: m.status ?? "unknown",
        totalTokens: m.totalTokens ?? 0,
        inputTokens: m.inputTokens ?? 0,
        outputTokens: m.outputTokens ?? 0,
        cacheRead: m.cacheRead ?? 0,
        cacheWrite: m.cacheWrite ?? 0,
        reasoningTokens: m.reasoningTokens ?? 0,
        estimatedCostUsd: m.estimatedCostUsd ?? 0,
        modelProvider: m.modelProvider ?? "",
        model: m.model ?? "",
        contextTokens: m.contextTokens ?? 0,
        updatedAt: m.updatedAt ?? 0,
        startedAt: m.startedAt ?? m.sessionStartedAt ?? 0,
        endedAt: m.endedAt ?? 0,
        runtimeMs: m.runtimeMs ?? 0,
        compactionCount: m.compactionCount ?? 0,
      });
    }
  }
  // Most recently updated first.
  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return out;
}

async function handleClawApi(
  req: any,
  res: any,
  route: string,
): Promise<boolean> {
  let body: any = {};
  if (req.method === "POST") {
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw);
    } catch (err) {
      const e = bodyError(err);
      jsonRes(res, { error: e.message }, e.status);
      return true;
    }
  }

  try {
    const m = await import("./model-config.js");
    switch (route) {
      case "config/load": {
        const cfg = m.readOpenClawConfig();
        // Surface commonly-edited sections; secrets are auto-redacted by `openclaw config get`
        const summary = {
          gateway: {
            mode: cfg?.gateway?.mode ?? "local",
            port: cfg?.gateway?.port,
            bind: cfg?.gateway?.bind,
            auth: m.getConfigSection("gateway.auth"),
          },
          agents: {
            defaults: cfg?.agents?.defaults ?? {},
            count: (cfg?.agents?.list ?? []).length,
            list: (cfg?.agents?.list ?? []).map((a: any) => ({
              id: a.id,
              name: a.identity?.name || a.name || a.id,
              emoji: a.identity?.emoji,
              thinkingDefault: a.thinkingDefault,
              reasoningDefault: a.reasoningDefault,
            })),
          },
          plugin: {
            enabled: cfg?.plugins?.entries?.agentshire?.enabled ?? true,
            autoLaunch: cfg?.plugins?.entries?.agentshire?.config?.autoLaunch ?? false,
            allowConversationAccess:
              cfg?.plugins?.entries?.agentshire?.hooks?.allowConversationAccess ?? false,
          },
          bindings: cfg?.bindings ?? [],
          meta: cfg?.meta ?? {},
          defaultModel: m.readDefaultModel(),
          // ── Extended config sections (use getConfigSection for auto-redacted reads) ──
          logging: cfg?.logging ?? {},
          browser: cfg?.browser ?? {},
          update: cfg?.update ?? {},
          session: cfg?.session ?? {},
          security: cfg?.security ?? {},
          diagnostics: cfg?.diagnostics ?? {},
          messages: cfg?.messages ?? {},
          commands: cfg?.commands ?? {},
          cron: cfg?.cron ?? {},
          memory: cfg?.memory ?? {},
          proxy: cfg?.proxy ?? {},
          env: cfg?.env ?? {},
          audit: cfg?.audit ?? {},
          tools: cfg?.tools ?? {},
          talk: cfg?.talk ?? {},
          web: cfg?.web ?? {},
          media: cfg?.media ?? {},
          mcp: cfg?.mcp ?? {},
          transcripts: cfg?.transcripts ?? {},
          commitments: cfg?.commitments ?? {},
          broadcast: cfg?.broadcast ?? {},
          models: { mode: cfg?.models?.mode },
          plugins: {
            enabled: cfg?.plugins?.enabled,
            bundledDiscovery: cfg?.plugins?.bundledDiscovery,
          },
          acp: cfg?.acp ?? {},
          hooks: cfg?.hooks ?? {},
          ui: cfg?.ui ?? {},
        };
        jsonRes(res, { success: true, config: summary });
        return true;
      }
      case "config/save": {
        // Build a patch object — `openclaw config patch` does schema validation + atomic write
        const patch: Record<string, unknown> = {};

        // Gateway
        if (body.gateway?.mode !== undefined) {
          patch.gateway = { mode: String(body.gateway.mode) };
        }
        if (body.gateway?.port !== undefined) {
          patch.gateway = { ...(patch.gateway as any ?? {}), port: Number(body.gateway.port) };
        }
        if (body.gateway?.bind !== undefined) {
          patch.gateway = { ...(patch.gateway as any ?? {}), bind: String(body.gateway.bind) };
        }

        // Subagent timeout
        if (body.subagentsTimeoutSeconds !== undefined) {
          const sec = Number(body.subagentsTimeoutSeconds);
          if (Number.isFinite(sec) && sec > 0) {
            patch.agents = { defaults: { subagents: { runTimeoutSeconds: sec } } };
          }
        }

        // Plugin settings
        const pluginPatch: any = {};
        if (body.pluginEnabled !== undefined) pluginPatch.enabled = Boolean(body.pluginEnabled);
        if (body.autoLaunch !== undefined) pluginPatch.config = { autoLaunch: Boolean(body.autoLaunch) };
        if (body.allowConversationAccess !== undefined) pluginPatch.hooks = { allowConversationAccess: Boolean(body.allowConversationAccess) };
        if (Object.keys(pluginPatch).length > 0) {
          patch.plugins = { entries: { agentshire: pluginPatch } };
        }

        // Logging
        if (body.logging) {
          const lg: any = {};
          if (body.logging.level !== undefined) lg.level = String(body.logging.level);
          if (body.logging.consoleLevel !== undefined) lg.consoleLevel = String(body.logging.consoleLevel);
          if (body.logging.consoleStyle !== undefined) lg.consoleStyle = String(body.logging.consoleStyle);
          if (body.logging.redactSensitive !== undefined) lg.redactSensitive = String(body.logging.redactSensitive);
          if (Object.keys(lg).length > 0) patch.logging = lg;
        }

        // Browser
        if (body.browser) {
          const br: any = {};
          if (body.browser.enabled !== undefined) br.enabled = Boolean(body.browser.enabled);
          if (body.browser.headless !== undefined) br.headless = Boolean(body.browser.headless);
          if (body.browser.noSandbox !== undefined) br.noSandbox = Boolean(body.browser.noSandbox);
          if (body.browser.cdpUrl !== undefined) br.cdpUrl = String(body.browser.cdpUrl);
          if (body.browser.actionTimeoutMs !== undefined) {
            const ms = Number(body.browser.actionTimeoutMs);
            if (Number.isFinite(ms) && ms > 0) br.actionTimeoutMs = ms;
          }
          if (Object.keys(br).length > 0) patch.browser = br;
        }

        // Update
        if (body.update) {
          const up: any = {};
          if (body.update.channel !== undefined) up.channel = String(body.update.channel);
          if (body.update.checkOnStart !== undefined) up.checkOnStart = Boolean(body.update.checkOnStart);
          if (body.update.auto?.enabled !== undefined) up.auto = { enabled: Boolean(body.update.auto.enabled) };
          if (Object.keys(up).length > 0) patch.update = up;
        }

        // Session
        if (body.session) {
          const ss: any = {};
          if (body.session.maxHistoryTurns !== undefined) {
            const n = Number(body.session.maxHistoryTurns);
            if (Number.isFinite(n) && n >= 0) ss.maxHistoryTurns = n;
          }
          if (body.session.compactionThresholdTokens !== undefined) {
            const n = Number(body.session.compactionThresholdTokens);
            if (Number.isFinite(n) && n > 0) ss.compactionThresholdTokens = n;
          }
          if (body.session.scope !== undefined) ss.scope = String(body.session.scope);
          if (body.session.idleMinutes !== undefined) {
            const n = Number(body.session.idleMinutes);
            if (Number.isFinite(n) && n >= 0) ss.idleMinutes = n;
          }
          if (Object.keys(ss).length > 0) patch.session = ss;
        }

        // Diagnostics
        if (body.diagnostics) {
          const dg: any = {};
          if (body.diagnostics.enabled !== undefined) dg.enabled = Boolean(body.diagnostics.enabled);
          if (body.diagnostics.stuckSessionWarnMs !== undefined) {
            const ms = Number(body.diagnostics.stuckSessionWarnMs);
            if (Number.isFinite(ms) && ms > 0) dg.stuckSessionWarnMs = ms;
          }
          if (body.diagnostics.stuckSessionAbortMs !== undefined) {
            const ms = Number(body.diagnostics.stuckSessionAbortMs);
            if (Number.isFinite(ms) && ms > 0) dg.stuckSessionAbortMs = ms;
          }
          if (Object.keys(dg).length > 0) patch.diagnostics = dg;
        }

        // Messages
        if (body.messages) {
          const msg: any = {};
          if (body.messages.ackReactionScope !== undefined) msg.ackReactionScope = String(body.messages.ackReactionScope);
          if (body.messages.suppressToolErrors !== undefined) msg.suppressToolErrors = Boolean(body.messages.suppressToolErrors);
          if (Object.keys(msg).length > 0) patch.messages = msg;
        }

        // Commands
        if (body.commands) {
          const cmd: any = {};
          if (body.commands.text !== undefined) cmd.text = Boolean(body.commands.text);
          if (body.commands.bash !== undefined) cmd.bash = Boolean(body.commands.bash);
          if (body.commands.config !== undefined) cmd.config = Boolean(body.commands.config);
          if (body.commands.restart !== undefined) cmd.restart = Boolean(body.commands.restart);
          if (Object.keys(cmd).length > 0) patch.commands = cmd;
        }

        // Cron
        if (body.cron) {
          const cr: any = {};
          if (body.cron.enabled !== undefined) cr.enabled = Boolean(body.cron.enabled);
          if (body.cron.maxConcurrentRuns !== undefined) {
            const n = Number(body.cron.maxConcurrentRuns);
            if (Number.isFinite(n) && n > 0) cr.maxConcurrentRuns = n;
          }
          if (Object.keys(cr).length > 0) patch.cron = cr;
        }

        // Memory
        if (body.memory) {
          const mem: any = {};
          if (body.memory.backend !== undefined) mem.backend = String(body.memory.backend);
          if (Object.keys(mem).length > 0) patch.memory = mem;
        }

        // Proxy
        if (body.proxy) {
          const px: any = {};
          if (body.proxy.enabled !== undefined) px.enabled = Boolean(body.proxy.enabled);
          if (body.proxy.proxyUrl !== undefined) px.proxyUrl = String(body.proxy.proxyUrl);
          if (Object.keys(px).length > 0) patch.proxy = px;
        }

        // Env
        if (body.env) {
          const envPatch: any = {};
          if (body.env.shellEnv?.enabled !== undefined) {
            envPatch.shellEnv = { enabled: Boolean(body.env.shellEnv.enabled) };
          }
          if (Object.keys(envPatch).length > 0) patch.env = envPatch;
        }

        // Audit
        if (body.audit) {
          const au: any = {};
          if (body.audit.enabled !== undefined) au.enabled = Boolean(body.audit.enabled);
          if (Object.keys(au).length > 0) patch.audit = au;
        }

        // Tools
        if (body.tools) {
          const tp: any = {};
          if (body.tools.profile !== undefined) tp.profile = String(body.tools.profile);
          if (body.tools.toolSearch !== undefined) tp.toolSearch = body.tools.toolSearch;
          if (body.tools.codeMode !== undefined) tp.codeMode = body.tools.codeMode;
          if (Object.keys(tp).length > 0) patch.tools = tp;
        }

        // Talk
        if (body.talk) {
          const tk: any = {};
          if (body.talk.provider !== undefined) tk.provider = String(body.talk.provider);
          if (body.talk.consultThinkingLevel !== undefined) tk.consultThinkingLevel = String(body.talk.consultThinkingLevel);
          if (body.talk.consultFastMode !== undefined) tk.consultFastMode = Boolean(body.talk.consultFastMode);
          if (body.talk.speechLocale !== undefined) tk.speechLocale = String(body.talk.speechLocale);
          if (body.talk.interruptOnSpeech !== undefined) tk.interruptOnSpeech = Boolean(body.talk.interruptOnSpeech);
          if (body.talk.silenceTimeoutMs !== undefined) {
            const ms = Number(body.talk.silenceTimeoutMs);
            if (Number.isFinite(ms) && ms > 0) tk.silenceTimeoutMs = ms;
          }
          if (Object.keys(tk).length > 0) patch.talk = tk;
        }

        // Web
        if (body.web) {
          const wb: any = {};
          if (body.web.enabled !== undefined) wb.enabled = Boolean(body.web.enabled);
          if (body.web.heartbeatSeconds !== undefined) {
            const n = Number(body.web.heartbeatSeconds);
            if (Number.isFinite(n) && n > 0) wb.heartbeatSeconds = n;
          }
          if (Object.keys(wb).length > 0) patch.web = wb;
        }

        // Media
        if (body.media) {
          const md: any = {};
          if (body.media.preserveFilenames !== undefined) md.preserveFilenames = Boolean(body.media.preserveFilenames);
          if (body.media.ttlHours !== undefined) {
            const n = Number(body.media.ttlHours);
            if (Number.isFinite(n) && n >= 0) md.ttlHours = n;
          }
          if (Object.keys(md).length > 0) patch.media = md;
        }

        // MCP
        if (body.mcp) {
          const mc: any = {};
          if (body.mcp.sessionIdleTtlMs !== undefined) {
            const n = Number(body.mcp.sessionIdleTtlMs);
            if (Number.isFinite(n) && n > 0) mc.sessionIdleTtlMs = n;
          }
          if (Object.keys(mc).length > 0) patch.mcp = mc;
        }

        // Transcripts
        if (body.transcripts) {
          const tr: any = {};
          if (body.transcripts.enabled !== undefined) tr.enabled = Boolean(body.transcripts.enabled);
          if (body.transcripts.maxUtterances !== undefined) {
            const n = Number(body.transcripts.maxUtterances);
            if (Number.isFinite(n) && n > 0) tr.maxUtterances = n;
          }
          if (Object.keys(tr).length > 0) patch.transcripts = tr;
        }

        // Commitments
        if (body.commitments) {
          const cm: any = {};
          if (body.commitments.enabled !== undefined) cm.enabled = Boolean(body.commitments.enabled);
          if (body.commitments.maxPerDay !== undefined) {
            const n = Number(body.commitments.maxPerDay);
            if (Number.isFinite(n) && n >= 0) cm.maxPerDay = n;
          }
          if (Object.keys(cm).length > 0) patch.commitments = cm;
        }

        // Broadcast
        if (body.broadcast) {
          const bc: any = {};
          if (body.broadcast.strategy !== undefined) bc.strategy = String(body.broadcast.strategy);
          if (Object.keys(bc).length > 0) patch.broadcast = bc;
        }

        // Models mode
        if (body.models?.mode !== undefined) {
          patch.models = { mode: String(body.models.mode) };
        }

        // Plugins global
        if (body.plugins) {
          const pg: any = {};
          if (body.plugins.enabled !== undefined) pg.enabled = Boolean(body.plugins.enabled);
          if (body.plugins.bundledDiscovery !== undefined) pg.bundledDiscovery = String(body.plugins.bundledDiscovery);
          if (Object.keys(pg).length > 0) patch.plugins = { ...(patch.plugins as any ?? {}), ...pg };
        }

        // ACP
        if (body.acp) {
          const ac: any = {};
          if (body.acp.enabled !== undefined) ac.enabled = Boolean(body.acp.enabled);
          if (body.acp.backend !== undefined) ac.backend = String(body.acp.backend);
          if (body.acp.defaultAgent !== undefined) ac.defaultAgent = String(body.acp.defaultAgent);
          if (body.acp.maxConcurrentSessions !== undefined) {
            const n = Number(body.acp.maxConcurrentSessions);
            if (Number.isFinite(n) && n > 0) ac.maxConcurrentSessions = n;
          }
          if (Object.keys(ac).length > 0) patch.acp = ac;
        }

        // Hooks
        if (body.hooks) {
          const hk: any = {};
          if (body.hooks.enabled !== undefined) hk.enabled = Boolean(body.hooks.enabled);
          if (body.hooks.path !== undefined) hk.path = String(body.hooks.path);
          if (body.hooks.token !== undefined) hk.token = String(body.hooks.token);
          if (body.hooks.defaultSessionKey !== undefined) hk.defaultSessionKey = String(body.hooks.defaultSessionKey);
          if (body.hooks.allowRequestSessionKey !== undefined) hk.allowRequestSessionKey = Boolean(body.hooks.allowRequestSessionKey);
          if (body.hooks.maxBodyBytes !== undefined) {
            const n = Number(body.hooks.maxBodyBytes);
            if (Number.isFinite(n) && n > 0) hk.maxBodyBytes = n;
          }
          if (body.hooks.transformsDir !== undefined) hk.transformsDir = String(body.hooks.transformsDir);
          if (Object.keys(hk).length > 0) patch.hooks = hk;
        }

        // UI
        if (body.ui) {
          const ui: any = {};
          if (body.ui.seamColor !== undefined) ui.seamColor = String(body.ui.seamColor);
          if (Object.keys(ui).length > 0) patch.ui = ui;
        }

        // Gateway extended
        if (body.gateway) {
          const gw: any = (patch.gateway as any) ?? {};
          if (body.gateway.customBindHost !== undefined) gw.customBindHost = String(body.gateway.customBindHost);
          if (body.gateway.allowRealIpFallback !== undefined) gw.allowRealIpFallback = Boolean(body.gateway.allowRealIpFallback);
          if (body.gateway.handshakeTimeoutMs !== undefined) {
            const ms = Number(body.gateway.handshakeTimeoutMs);
            if (Number.isFinite(ms) && ms > 0) gw.handshakeTimeoutMs = ms;
          }
          if (body.gateway.channelHealthCheckMinutes !== undefined) {
            const n = Number(body.gateway.channelHealthCheckMinutes);
            if (Number.isFinite(n) && n > 0) gw.channelHealthCheckMinutes = n;
          }
          if (body.gateway.channelStaleEventThresholdMinutes !== undefined) {
            const n = Number(body.gateway.channelStaleEventThresholdMinutes);
            if (Number.isFinite(n) && n > 0) gw.channelStaleEventThresholdMinutes = n;
          }
          if (body.gateway.channelMaxRestartsPerHour !== undefined) {
            const n = Number(body.gateway.channelMaxRestartsPerHour);
            if (Number.isFinite(n) && n > 0) gw.channelMaxRestartsPerHour = n;
          }
          if (Object.keys(gw).length > 0) patch.gateway = gw;
        }

        // Browser extended
        if (body.browser) {
          const br: any = (patch.browser as any) ?? {};
          if (body.browser.evaluateEnabled !== undefined) br.evaluateEnabled = Boolean(body.browser.evaluateEnabled);
          if (body.browser.executablePath !== undefined) br.executablePath = String(body.browser.executablePath);
          if (body.browser.attachOnly !== undefined) br.attachOnly = Boolean(body.browser.attachOnly);
          if (body.browser.cdpPortRangeStart !== undefined) {
            const n = Number(body.browser.cdpPortRangeStart);
            if (Number.isFinite(n) && n > 0) br.cdpPortRangeStart = n;
          }
          if (body.browser.defaultProfile !== undefined) br.defaultProfile = String(body.browser.defaultProfile);
          if (body.browser.color !== undefined) br.color = String(body.browser.color);
          if (Object.keys(br).length > 0) patch.browser = br;
        }

        // Logging extended
        if (body.logging) {
          const lg: any = (patch.logging as any) ?? {};
          if (body.logging.file !== undefined) lg.file = String(body.logging.file);
          if (body.logging.maxFileBytes !== undefined) {
            const n = Number(body.logging.maxFileBytes);
            if (Number.isFinite(n) && n > 0) lg.maxFileBytes = n;
          }
          if (Object.keys(lg).length > 0) patch.logging = lg;
        }

        // Session extended
        if (body.session) {
          const ss: any = (patch.session as any) ?? {};
          if (body.session.dmScope !== undefined) ss.dmScope = String(body.session.dmScope);
          if (body.session.store !== undefined) ss.store = String(body.session.store);
          if (body.session.typingIntervalSeconds !== undefined) {
            const n = Number(body.session.typingIntervalSeconds);
            if (Number.isFinite(n) && n >= 0) ss.typingIntervalSeconds = n;
          }
          if (body.session.typingMode !== undefined) ss.typingMode = String(body.session.typingMode);
          if (body.session.mainKey !== undefined) ss.mainKey = String(body.session.mainKey);
          if (Object.keys(ss).length > 0) patch.session = ss;
        }

        // Diagnostics extended
        if (body.diagnostics) {
          const dg: any = (patch.diagnostics as any) ?? {};
          if (body.diagnostics.memoryPressureSnapshot !== undefined) dg.memoryPressureSnapshot = Boolean(body.diagnostics.memoryPressureSnapshot);
          if (Object.keys(dg).length > 0) patch.diagnostics = dg;
        }

        // Messages extended
        if (body.messages) {
          const msg: any = (patch.messages as any) ?? {};
          if (body.messages.messagePrefix !== undefined) msg.messagePrefix = String(body.messages.messagePrefix);
          if (body.messages.responsePrefix !== undefined) msg.responsePrefix = String(body.messages.responsePrefix);
          if (body.messages.ackReaction !== undefined) msg.ackReaction = String(body.messages.ackReaction);
          if (body.messages.removeAckAfterReply !== undefined) msg.removeAckAfterReply = Boolean(body.messages.removeAckAfterReply);
          if (body.messages.visibleReplies !== undefined) msg.visibleReplies = String(body.messages.visibleReplies);
          if (body.messages.responseUsage !== undefined) msg.responseUsage = String(body.messages.responseUsage);
          if (Object.keys(msg).length > 0) patch.messages = msg;
        }

        // Commands extended
        if (body.commands) {
          const cmd: any = (patch.commands as any) ?? {};
          if (body.commands.native !== undefined) cmd.native = body.commands.native;
          if (body.commands.nativeSkills !== undefined) cmd.nativeSkills = body.commands.nativeSkills;
          if (body.commands.bashForegroundMs !== undefined) {
            const n = Number(body.commands.bashForegroundMs);
            if (Number.isFinite(n) && n >= 0) cmd.bashForegroundMs = n;
          }
          if (body.commands.mcp !== undefined) cmd.mcp = Boolean(body.commands.mcp);
          if (body.commands.plugins !== undefined) cmd.plugins = Boolean(body.commands.plugins);
          if (body.commands.debug !== undefined) cmd.debug = Boolean(body.commands.debug);
          if (body.commands.useAccessGroups !== undefined) cmd.useAccessGroups = Boolean(body.commands.useAccessGroups);
          if (body.commands.ownerDisplay !== undefined) cmd.ownerDisplay = String(body.commands.ownerDisplay);
          if (Object.keys(cmd).length > 0) patch.commands = cmd;
        }

        // Cron extended
        if (body.cron) {
          const cr: any = (patch.cron as any) ?? {};
          if (body.cron.store !== undefined) cr.store = String(body.cron.store);
          if (body.cron.webhook !== undefined) cr.webhook = String(body.cron.webhook);
          if (body.cron.webhookToken !== undefined) cr.webhookToken = String(body.cron.webhookToken);
          if (Object.keys(cr).length > 0) patch.cron = cr;
        }

        // Memory extended
        if (body.memory) {
          const mem: any = (patch.memory as any) ?? {};
          if (body.memory.citations !== undefined) mem.citations = String(body.memory.citations);
          if (Object.keys(mem).length > 0) patch.memory = mem;
        }

        // Proxy extended
        if (body.proxy) {
          const px: any = (patch.proxy as any) ?? {};
          if (body.proxy.loopbackMode !== undefined) px.loopbackMode = String(body.proxy.loopbackMode);
          if (Object.keys(px).length > 0) patch.proxy = px;
        }

        try {
          if (Object.keys(patch).length > 0) {
            m.patchConfig(patch);
          }
          jsonRes(res, { success: true });
        } catch (err: any) {
          jsonRes(res, { success: false, error: err?.message ?? "Config patch failed" }, 500);
        }
        return true;
      }
      case "sessions/list": {
        const sessions = collectSessionSummaries();
        // Aggregate totals for quick display.
        const totals = sessions.reduce(
          (acc, s) => {
            acc.totalTokens += s.totalTokens;
            acc.inputTokens += s.inputTokens;
            acc.outputTokens += s.outputTokens;
            acc.cacheRead += s.cacheRead;
            acc.estimatedCostUsd += s.estimatedCostUsd;
            acc.count += 1;
            return acc;
          },
          { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, estimatedCostUsd: 0, count: 0 },
        );
        jsonRes(res, { success: true, sessions, totals });
        return true;
      }
      case "sessions/delete": {
        // Delete a single session by agentId + sessionKey.
        // Removes the entry from sessions.json AND deletes the .jsonl session files.
        const agentId = String(body.agentId ?? "");
        const sessionKey = String(body.sessionKey ?? "");
        if (!agentId || !sessionKey) {
          jsonRes(res, { error: "agentId and sessionKey required" }, 400);
          return true;
        }
        const root = stateDir();
        const agentDir = join(root, "agents", agentId);
        const sessionsJsonPath = join(agentDir, "sessions", "sessions.json");
        if (!existsSync(sessionsJsonPath)) {
          jsonRes(res, { error: "Session not found" }, 404);
          return true;
        }
        let sessionsMap: any;
        try {
          sessionsMap = JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
        } catch {
          jsonRes(res, { error: "Failed to read sessions" }, 500);
          return true;
        }
        if (!sessionsMap || !(sessionKey in sessionsMap)) {
          jsonRes(res, { error: "Session not found" }, 404);
          return true;
        }
        const meta = sessionsMap[sessionKey] as any;
        const sessionId = meta?.sessionId;
        // Delete session files
        if (sessionId) {
          const sessionDir = join(agentDir, "sessions");
          for (const suffix of [".jsonl", ".trajectory.jsonl", ".trajectory-path.json"]) {
            const fp = join(sessionDir, sessionId + suffix);
            if (existsSync(fp)) {
              try { unlinkSync(fp); } catch { /* ignore */ }
            }
          }
        }
        delete sessionsMap[sessionKey];
        try {
          writeFileSync(sessionsJsonPath, JSON.stringify(sessionsMap, null, 2) + "\n", "utf-8");
        } catch { /* ignore write errors */ }
        jsonRes(res, { success: true, deleted: sessionKey });
        return true;
      }
      case "sessions/clear": {
        // Clear all sessions except the specified keepSessionKey.
        // Removes entries from sessions.json AND deletes the .jsonl session files.
        const keepSessionKey = String(body.keepSessionKey ?? "");
        const keepAgentId = String(body.keepAgentId ?? "");
        const root = stateDir();
        const agentsDir = join(root, "agents");
        if (!existsSync(agentsDir)) {
          jsonRes(res, { success: true, cleared: 0 });
          return true;
        }
        let cleared = 0;
        for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const agentId = entry.name;
          const sessionsJsonPath = join(agentsDir, agentId, "sessions", "sessions.json");
          if (!existsSync(sessionsJsonPath)) continue;
          let sessionsMap: any;
          try {
            sessionsMap = JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
          } catch {
            continue;
          }
          if (!sessionsMap || typeof sessionsMap !== "object") continue;
          const keysToRemove: string[] = [];
          for (const [sessionKey, meta] of Object.entries(sessionsMap)) {
            // Keep the specified session (matched by agentId + sessionKey)
            if (keepSessionKey && agentId === keepAgentId && sessionKey === keepSessionKey) continue;
            keysToRemove.push(sessionKey);
            // Delete session files
            const m = meta as any;
            const sessionId = m?.sessionId;
            if (sessionId) {
              const sessionDir = join(agentsDir, agentId, "sessions");
              for (const suffix of [".jsonl", ".trajectory.jsonl", ".trajectory-path.json"]) {
                const fp = join(sessionDir, sessionId + suffix);
                if (existsSync(fp)) {
                  try { unlinkSync(fp); } catch { /* ignore */ }
                }
              }
            }
          }
          for (const key of keysToRemove) {
            delete sessionsMap[key];
            cleared++;
          }
          if (keysToRemove.length > 0) {
            try {
              writeFileSync(sessionsJsonPath, JSON.stringify(sessionsMap, null, 2) + "\n", "utf-8");
            } catch { /* ignore write errors */ }
          }
        }
        jsonRes(res, { success: true, cleared });
        return true;
      }
      default:
        jsonRes(res, { error: "Unknown API" }, 404);
        return true;
    }
  } catch (err: any) {
    const message = err?.message ?? "Internal error";
    jsonRes(res, { error: message }, 400);
    return true;
  }
}

// ── custom-assets static file serving ──

function handleCustomAssetsStatic(
  res: any,
  urlPath: string,
  customAssetsDir: string,
): boolean {
  const relPath = urlPath.slice("/custom-assets/".length);
  const filePath = join(customAssetsDir, decodeURIComponent(relPath));
  return serveFile(res, filePath, customAssetsDir);
}

// ── Main entry: handle all editor-related requests ──

export async function handleEditorRequest(
  req: any,
  res: any,
  pluginDir: string,
): Promise<boolean> {
  const url = req.url ?? "/";
  const urlPath =
    typeof url === "string" && url.startsWith("/")
      ? url.split("?")[0]
      : new URL(url, "http://localhost").pathname;
  const method = req.method ?? "GET";

  // Ensure stateDir() is initialized (dev server may not have run initStateDir).
  try {
    stateDir();
  } catch {
    try { initStateDir(undefined); } catch {}
  }

  const d = resolveDirs(pluginDir);

  // /ext-assets/* → serve Characters_1 / Map_1 from pluginDir/assets/
  if (urlPath.startsWith("/ext-assets/") && method === "GET") {
    return handleExtAssets(res, urlPath, d.extAssetsDir);
  }

  // /assets/models/megapack/gltf/* → serve from pluginDir/assets/Map_1/
  if (urlPath.startsWith("/assets/models/megapack/gltf/") && method === "GET") {
    const relPath = decodeURIComponent(urlPath.slice("/assets/models/megapack/gltf/".length));
    const megapackBase = join(d.extAssetsDir, "Map_1");
    const filePath = join(megapackBase, relPath);
    return serveFile(res, filePath, megapackBase, "public, max-age=86400");
  }

  // /citizen-workshop/avatars/* → serve user-uploaded avatars
  if (
    urlPath.startsWith("/citizen-workshop/avatars/") &&
    method === "GET"
  ) {
    return handleCitizenAvatars(res, urlPath, d.avatarsDir);
  }

  // /custom-assets/animations/* → serve custom anim files
  if (
    urlPath.startsWith("/custom-assets/animations/") &&
    method === "GET"
  ) {
    return handleAnimations(res, urlPath, d.animDir);
  }

  // /custom-assets/_api/* → custom assets CRUD API
  if (
    urlPath.startsWith("/custom-assets/_api/") &&
    method === "POST"
  ) {
    const route = urlPath.slice("/custom-assets/_api/".length);
    return handleCustomAssetsApi(
      req,
      res,
      route,
      d.customAssetsDir,
      d.catalogPath,
    );
  }

  // /custom-assets/* → static file serving for custom assets
  if (urlPath.startsWith("/custom-assets/")) {
    return handleCustomAssetsStatic(res, urlPath, d.customAssetsDir);
  }

  // /citizen-workshop/_api/media/<encoded-path> → serve media files (GET)
  // 也兼容旧格式 /citizen-workshop/_api/media?path=<encoded-path>（nginx 反代可能丢失 query）
  // 编码方式：base64url（A-Za-z0-9-_），避免 %2F 被 nginx 吞掉；也兼容旧的 encodeURIComponent
  // 安全限制：path 必须在允许的目录范围内（防路径遍历读取任意文件）
  if (
    (urlPath === "/citizen-workshop/_api/media" ||
      urlPath.startsWith("/citizen-workshop/_api/media/")) &&
    method === "GET"
  ) {
    // 优先从路径段取 path，回退到 query string（兼容旧 URL）
    let filePath = "";
    if (urlPath.startsWith("/citizen-workshop/_api/media/")) {
      const raw = urlPath.slice("/citizen-workshop/_api/media/".length);
      // 尝试 base64url 解码（新格式），失败则用 decodeURIComponent（旧格式）
      try {
        // base64url → base64
        const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        filePath = Buffer.from(padded, "base64").toString("utf-8");
      } catch {
        filePath = decodeURIComponent(raw);
      }
    } else {
      const urlObj = typeof url === "string" && url.startsWith("/")
        ? new URL(url, "http://localhost")
        : new URL(url ?? "/", "http://localhost");
      filePath = urlObj.searchParams.get("path") ?? "";
    }
    // 允许的媒体目录白名单：avatars / custom-assets / souls
    const allowedRoots = [d.avatarsDir, d.customAssetsDir, d.soulsDir];
    const resolved = filePath ? resolve(filePath) : "";
    const isAllowed = resolved && allowedRoots.some(root => resolved === root || resolved.startsWith(root + sep));
    if (!isAllowed || !existsSync(resolved) || !statSync(resolved).isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return true;
    }
    const ext = resolved.substring(resolved.lastIndexOf("."));
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(readFileSync(resolved));
    return true;
  }

  // /town-map/_api/load → GET: load saved TownMapConfig
  if (urlPath === "/town-map/_api/load" && method === "GET") {
    const mapPath = join(d.townDataDir, "town-map.json");
    if (existsSync(mapPath)) {
      try {
        const config = JSON.parse(readFileSync(mapPath, "utf-8"));
        jsonRes(res, { config });
      } catch {
        jsonRes(res, { config: null });
      }
    } else {
      jsonRes(res, { config: null });
    }
    return true;
  }

  // /town-map/_api/save → POST: persist TownMapConfig
  if (urlPath === "/town-map/_api/save" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.config) { jsonRes(res, { error: "Missing config" }, 400); return true; }
      writeFileSync(join(d.townDataDir, "town-map.json"), JSON.stringify(body.config, null, 2), "utf-8");
      jsonRes(res, { success: true });
    } catch (err: any) {
      if (err?.message === "Body too large") { jsonRes(res, { error: "请求体过大" }, 413); return true; }
      jsonRes(res, { error: err?.message ?? "Save failed" }, 500);
    }
    return true;
  }

  // /town-map/_api/assets → GET: return full asset catalog (builtin + custom)
  if (urlPath === "/town-map/_api/assets" && method === "GET") {
    try {
      const assets = await buildAssetCatalog(pluginDir, d);
      jsonRes(res, assets);
    } catch (err: any) {
      jsonRes(res, { builtin: [], custom: [], error: err?.message });
    }
    return true;
  }

  // /citizen-workshop/_api/* → citizen workshop API
  if (
    urlPath.startsWith("/citizen-workshop/_api/") &&
    method === "POST"
  ) {
    const route = urlPath.slice("/citizen-workshop/_api/".length).split("?")[0];
    return handleCitizenWorkshopApi(req, res, route, pluginDir);
  }

  // /models/_api/* → model (LLM provider) management API
  if (
    urlPath.startsWith("/models/_api/") &&
    method === "POST"
  ) {
    const route = urlPath.slice("/models/_api/".length).split("?")[0];
    return handleModelsApi(req, res, route);
  }

  // /claw/_api/* → OpenClaw settings + sessions API
  if (urlPath.startsWith("/claw/_api/")) {
    const route = urlPath.slice("/claw/_api/".length).split("?")[0];
    return handleClawApi(req, res, route);
  }

  // /board/plans → read-only plan snapshot for office whiteboard
  if (urlPath === "/board/plans" && method === "GET") {
    const { snapshotPlansForDisplay } = await import("./plan-manager.js");
    const plans = snapshotPlansForDisplay();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify({ success: true, plans }));
    return true;
  }

  return false;
}

export { ensureEditorDirs, MIME_TYPES };
