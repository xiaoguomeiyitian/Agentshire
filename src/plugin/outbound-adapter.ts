import { broadcastAgentEvent, getActiveTownSessionId } from "./ws-server.js";
import { extractTownSessionId } from "./town-session.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

const CHANNEL_ID = "agentshire";

const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  md: "text/markdown", txt: "text/plain", pdf: "application/pdf",
};

function resolveMediaType(url?: string): string {
  if (!url) return "file";
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";
  return "file";
}

export interface ResolvedFileData {
  fileName: string;
  mediaType: string;
  mimeType: string;
  data?: string;
  thumbnailData?: string;
  httpUrl?: string;
}

function getStewardWorkspaceDir(): string {
  return join(stateDir(), "workspace-town-steward");
}

function toHttpUrl(filePath: string): string | undefined {
  const wsDir = getStewardWorkspaceDir();
  if (!filePath.startsWith(wsDir)) return undefined;
  const relPath = filePath.slice(wsDir.length);
  return `/steward-workspace${relPath}`;
}

export function resolveFileData(filePath: string): ResolvedFileData {
  const fileName = filePath.split('/').pop() || filePath;
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const mediaType = resolveMediaType(filePath);
  const mimeType = MIME_MAP[ext] ?? "application/octet-stream";

  const httpUrl = toHttpUrl(filePath);

  if (httpUrl) {
    const thumbnailData = (mediaType === 'image') ? httpUrl : undefined;
    return { fileName, mediaType, mimeType, httpUrl, thumbnailData };
  }

  let data: string | undefined;
  try {
    if (filePath && existsSync(filePath)) {
      data = readFileSync(filePath).toString('base64');
    }
  } catch (e) { console.debug('[outbound] readFile failed:', e); }

  const thumbnailData = (mediaType === 'image' && data) ? `data:${mimeType};base64,${data}` : undefined;

  return { fileName, mediaType, mimeType, data, thumbnailData };
}

export function createOutboundAdapter() {
  const resolveOutboundSessionId = (ctx: { sessionId?: string; sessionKey?: string }) =>
    extractTownSessionId(ctx.sessionId ?? ctx.sessionKey) ?? getActiveTownSessionId();

  const outbound = {
    deliveryMode: "direct" as const,
    textChunkLimit: 4000,

    resolveTarget(params: { to?: string }) {
      const to = params.to;
      if (to && (to.startsWith(`${CHANNEL_ID}:`) || to === CHANNEL_ID)) {
        return { ok: true as const, to };
      }
      return { ok: false as const, error: new Error(`Invalid agentshire target: ${to}`) };
    },

    async sendText(ctx: { text: string; to: string; sessionId?: string; sessionKey?: string }) {
      // Suppress broadcast for implicit (Animal Mode L2) sessions: their LLM reply
      // (which may contain JSON like {"action":"stay",...}) is collected via the
      // deliver callback in onImplicitChat, not meant for chat bubbles.
      const sessionKey = ctx.sessionId ?? ctx.sessionKey ?? "";
      if (sessionKey.includes(":implicit:")) {
        return { channel: CHANNEL_ID, messageId: `town-implicit-${Date.now()}` };
      }
      const townSessionId = resolveOutboundSessionId(ctx);
      broadcastAgentEvent({ type: "text", content: ctx.text }, townSessionId);
      return { channel: CHANNEL_ID, messageId: `town-msg-${Date.now()}` };
    },

    async sendMedia(ctx: {
      text?: string;
      mediaUrl?: string;
      to: string;
      sessionId?: string;
      sessionKey?: string;
    }) {
      // Suppress broadcast for implicit (Animal Mode L2) sessions.
      const sessionKey = ctx.sessionId ?? ctx.sessionKey ?? "";
      if (sessionKey.includes(":implicit:")) {
        return { channel: CHANNEL_ID, messageId: `town-implicit-media-${Date.now()}` };
      }
      const townSessionId = resolveOutboundSessionId(ctx);
      const mediaUrl = ctx.mediaUrl ?? "";
      const resolved = resolveFileData(mediaUrl);

      broadcastAgentEvent({
        type: 'deliverable_card',
        cardType: resolved.mediaType,
        name: resolved.fileName,
        url: resolved.httpUrl || mediaUrl,
        filePath: mediaUrl,
        mimeType: resolved.mimeType,
        data: resolved.data,
        thumbnailData: resolved.thumbnailData,
        httpUrl: resolved.httpUrl,
        summary: ctx.text ?? "",
        files: mediaUrl ? [mediaUrl] : [],
      } as any, townSessionId);

      if (ctx.text) {
        broadcastAgentEvent({ type: "text", content: ctx.text }, townSessionId);
      }

      return { channel: CHANNEL_ID, messageId: `town-media-${Date.now()}` };
    },

    async sendPayload(ctx: { payload: any; to: string; sessionId?: string; sessionKey?: string }) {
      const payload = ctx.payload;

      if (payload?.mediaUrl) {
        return outbound.sendMedia({
          text: payload.text ?? payload.body ?? "",
          mediaUrl: payload.mediaUrl,
          to: ctx.to,
          sessionId: ctx.sessionId,
          sessionKey: ctx.sessionKey,
        });
      }

      const text = payload?.text ?? payload?.body ?? "";
      if (text) {
        return outbound.sendText({
          text,
          to: ctx.to,
          sessionId: ctx.sessionId,
          sessionKey: ctx.sessionKey,
        });
      }

      return { channel: CHANNEL_ID, messageId: `town-payload-${Date.now()}` };
    },
  };

  const messaging = {
    normalizeTarget: (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.startsWith(`${CHANNEL_ID}:`)) return trimmed;
      if (trimmed === "steward" || trimmed === "user") return `${CHANNEL_ID}:${trimmed}`;
      return trimmed;
    },

    targetResolver: {
      looksLikeId: (raw: string, normalized?: string) => {
        const val = normalized ?? raw;
        return val.startsWith(`${CHANNEL_ID}:`) || val === CHANNEL_ID;
      },

      hint: `${CHANNEL_ID}:<target> (e.g. ${CHANNEL_ID}:steward)`,

      resolveTarget: async (params: {
        input: string;
        normalized: string;
      }) => {
        const target = params.normalized.startsWith(`${CHANNEL_ID}:`)
          ? params.normalized
          : `${CHANNEL_ID}:${params.normalized}`;
        const display = target.replace(`${CHANNEL_ID}:`, "");
        return {
          to: target,
          kind: "user" as const,
          display,
          source: "normalized" as const,
        };
      },
    },
  };

  return { outbound, messaging };
}
