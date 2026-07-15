/**
 * Resolves local file paths into Chat-consumable asset metadata.
 *
 * All URL generation is centralised here so that history restore,
 * realtime delta, and future task-card rendering use the same URLs.
 */

import type { ChatMediaType } from "../contracts/chat.js";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);

const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  pdf: "application/pdf", md: "text/markdown", txt: "text/plain",
};

export interface ResolvedAsset {
  mediaType: ChatMediaType;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

function getStewardWorkspaceDir(): string {
  return join(stateDir(), "workspace-town-steward");
}

function ext(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

export function detectMediaType(filePath: string): ChatMediaType {
  const e = ext(filePath);
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  return "file";
}

export function resolveMimeType(filePath: string): string {
  return MIME_MAP[ext(filePath)] ?? "application/octet-stream";
}

export function resolveAsset(filePath: string): ResolvedAsset {
  const fileName = filePath.split("/").pop() ?? "file";
  const mediaType = detectMediaType(filePath);
  const mimeType = resolveMimeType(filePath);

  const wsDir = getStewardWorkspaceDir();
  let fileUrl: string;
  if (filePath.startsWith(wsDir)) {
    fileUrl = `/steward-workspace${filePath.slice(wsDir.length)}`;
  } else {
    // base64url 编码：避免 %2F 被 nginx 反代吞掉
    const b64 = Buffer.from(filePath, "utf-8").toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    fileUrl = `/citizen-workshop/_api/media/${b64}`;
  }

  let fileSize: number | undefined;
  try { if (existsSync(filePath)) fileSize = statSync(filePath).size; } catch {}

  return { mediaType, fileUrl, fileName, mimeType, fileSize };
}

