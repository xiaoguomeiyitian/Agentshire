/**
 * Shared HTTP request handler for editor workshops (scene + citizen).
 * Used by both the production server (index.ts) and the Vite dev server (vite.config.ts).
 *
 * Returns true if the request was handled, false if it should fall through.
 */

import { join, relative } from "node:path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { stateDir, initStateDir } from "./paths.js";

function getStewardWorkspaceDir(): string {
  try {
    const { getTownRuntime } = require("./runtime.js") as typeof import("./runtime.js");
    const rt = getTownRuntime();
    const cfg = rt.config as any;
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

function jsonRes(res: any, data: any, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c: Buffer) => {
      b += c.toString();
    });
    req.on("end", () => resolve(b));
  });
}

function serveFile(
  res: any,
  filePath: string,
  baseDir: string,
  cache?: string,
): boolean {
  if (
    !filePath.startsWith(baseDir) ||
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

function resolveDirs(pluginDir: string): {
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

function loadAgentList(): { id: string; name: string }[] {
  try {
    const { getTownRuntime } = require("./runtime.js") as typeof import("./runtime.js");
    const rt = getTownRuntime();
    const cfg = rt.config as any;
    return (cfg?.agents?.list ?? []).map((a: any) => ({
      id: a.id,
      name: a.identity?.name || a.name || a.id,
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
  } catch {
    jsonRes(res, { error: "Invalid JSON body" }, 400);
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
  const changes: Array<{
    action: "create" | "disable" | "update_soul";
    citizenId: string;
    citizenName: string;
    agentId: string;
    soulContent?: string;
    specialty?: string;
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
      changes.push({ action: "create", citizenId: id, citizenName: nc.name, agentId, soulContent: resolveSoulFromFile(nc), specialty: nc.specialty });
    } else if (newEnabled && oldEnabled && !oc?.agentId) {
      agentToCreate.push(nc.name);
      changes.push({ action: "create", citizenId: id, citizenName: nc.name, agentId, soulContent: resolveSoulFromFile(nc), specialty: nc.specialty });
    } else if (!newEnabled && oldEnabled) {
      agentToDisable.push(nc.name ?? oc?.name ?? id);
      changes.push({ action: "disable", citizenId: id, citizenName: nc.name ?? id, agentId: oc?.agentId ?? agentId });
    } else if (newEnabled && oldEnabled) {
      const soulChanged = nc.persona !== oc?.persona
        || nc.name !== oc?.name
        || nc.bio !== oc?.bio
        || nc.specialty !== oc?.specialty;
      if (soulChanged) {
        agentToUpdateSoul.push(nc.name);
        changes.push({ action: "update_soul", citizenId: id, citizenName: nc.name, agentId: oc?.agentId ?? agentId, soulContent: resolveSoulFromFile(nc), specialty: nc.specialty });
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

  return { totalCharacters: newChars.length, agentToCreate, agentToDisable, agentToUpdateSoul, stewardSoulUpdated, changes };
}

const SOUL_GEN_TIMEOUT_MS = 90_000;

async function generateSoulViaAgent(system: string, user: string): Promise<string> {
  const { getTownRuntime } = require("./runtime.js") as typeof import("./runtime.js");
  const rt = getTownRuntime();
  const cfg = rt.config.loadConfig() as any;
  const sessionKey = `agent:town-steward:soul-gen:${Date.now()}`;
  const message = `【系统指令】\n${system}\n\n【用户输入】\n${user}`;

  let responseText = "";
  const agentDone = rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: rt.channel.reply.finalizeInboundContext({
      Body: message,
      RawBody: message,
      CommandBody: message,
      From: "agentshire:user",
      To: "agentshire:steward",
      SessionKey: sessionKey,
      AccountId: "default",
      OriginatingChannel: "agentshire",
      ChatType: "direct",
      SenderId: "user",
      Provider: "agentshire",
      Surface: "agentshire",
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
  } catch {
    jsonRes(res, { error: "Invalid JSON body" }, 400);
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
    const { name, bio, industry, specialty } = body as {
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
  } catch {
    jsonRes(res, { error: "Invalid JSON body" }, 400);
    return true;
  }

  try {
    const m = await import("./model-config.js");
    switch (route) {
      case "load": {
        const file = m.readModelsConfig();
        jsonRes(res, { providers: file.providers });
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

  // /citizen-workshop/_api/media?path=... → serve media files (GET)
  if (
    urlPath === "/citizen-workshop/_api/media" &&
    method === "GET"
  ) {
    const urlObj = typeof url === "string" && url.startsWith("/")
      ? new URL(url, "http://localhost")
      : new URL(url ?? "/", "http://localhost");
    const filePath = urlObj.searchParams.get("path") ?? "";
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return true;
    }
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(readFileSync(filePath));
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
