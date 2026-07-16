/**
 * Model configuration manager for OpenClaw openclaw.json `models.providers`.
 *
 * Reads/writes the `models.providers` section of openclaw.json directly,
 * keeping the rest of the config intact. Format follows the OpenClaw
 * official schema (providers is an object keyed by provider id):
 *
 *   models: {
 *     providers: {
 *       "<id>": {
 *         baseUrl: string,
 *         apiKey: string,            // supports ${ENV} template refs
 *         api?: string,              // e.g. "openai-completions"
 *         models?: ModelConfig[]
 *       }
 *     }
 *   }
 *
 * ModelConfig: {
 *   id: string,
 *   name?: string,
 *   input?: string[],
 *   cost?: { input, output, cacheRead, cacheWrite },
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   api?: string
 * }
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { stateDir } from "./paths.js";

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelConfig {
  id: string;
  name?: string;
  input?: string[];
  cost?: ModelCost;
  contextWindow?: number;
  maxTokens?: number;
  api?: string;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  api?: string;
  models?: ModelConfig[];
}

export type ProvidersMap = Record<string, ProviderConfig>;

export interface ModelFile {
  providers: ProvidersMap;
}

export type ModelErrorCode =
  | "DUPLICATE_PROVIDER"
  | "PROVIDER_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "INVALID_PROVIDER_ID"
  | "EMPTY_PROVIDER_ID"
  | "EMPTY_BASE_URL"
  | "EMPTY_MODEL_ID"
  | "MISSING_PARAMS"
  | "INTERNAL_ERROR";

export interface ModelError {
  code: ModelErrorCode;
  message: string;
}

export class ModelConfigError extends Error {
  code: ModelErrorCode;
  constructor(code: ModelErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ModelConfigError";
  }
}

export const PROVIDER_ID_PATTERN = /^[a-z0-9_-]+$/;

// Matches machine-specific secret refs like ${input:openai-key.AB12CD}
const MACHINE_SECRET_RE = /\$\{input:[^}]*\.[0-9a-fA-F]{6,}\}/;

function getOpenClawConfigPath(): string {
  return join(stateDir(), "openclaw.json");
}

function loadOpenClawConfig(): any {
  const configPath = getOpenClawConfigPath();
  if (!existsSync(configPath)) throw new ModelConfigError("INTERNAL_ERROR", "openclaw.json not found");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function saveOpenClawConfig(cfg: any): void {
  const configPath = getOpenClawConfigPath();
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

/**
 * Exported helpers for the Claw settings panel — read/write the full
 * openclaw.json so the UI can surface gateway mode, agent defaults, plugin
 * enabled flag, etc. Kept here to reuse the same path resolution + atomic
 * write logic as the model CRUD APIs.
 */
export function readOpenClawConfig(): any {
  return loadOpenClawConfig();
}

export function writeOpenClawConfig(cfg: any): void {
  saveOpenClawConfig(cfg);
}

/**
 * Read a config section via `openclaw config get <path> --json`.
 * Returns undefined if the path doesn't exist. Secrets are auto-redacted by the CLI.
 *
 * `path` is validated to contain only safe characters ([A-Za-z0-9._-]) to
 * prevent shell injection — it is interpolated into a shell command string.
 */
export function getConfigSection(path: string): any {
  if (!path || !/^[A-Za-z0-9._-]+$/.test(path)) return undefined;
  try {
    const out = execSync(`openclaw config get ${path} --json 2>/dev/null`, { encoding: "utf-8", timeout: 5000 });
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/**
 * Patch config via `openclaw config patch --stdin` (schema-validated, atomic write).
 * Objects merge recursively, arrays/scalars replace, null deletes a path.
 * Returns true on success, throws on validation error.
 */
export function patchConfig(patch: Record<string, unknown>): void {
  const input = JSON.stringify(patch);
  try {
    execSync("openclaw config patch --stdin", {
      input,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: any) {
    const stderr = err.stderr ?? "";
    const msg = stderr.toString().trim() || err.message;
    throw new ModelConfigError("INTERNAL_ERROR", `Config patch failed: ${msg}`);
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function getProviders(cfg: any): ProvidersMap {
  return (cfg?.models?.providers ?? {}) as ProvidersMap;
}

function getDefaultModel(cfg: any): string | undefined {
  return cfg?.agents?.defaults?.model?.primary;
}

// ── Read ──

export function readModelsConfig(): ModelFile {
  const cfg = loadOpenClawConfig();
  return { providers: clone(getProviders(cfg)) };
}

/**
 * Read the global default model ref (`agents.defaults.model.primary`).
 * Returns undefined if not set.
 */
export function readDefaultModel(): string | undefined {
  const cfg = loadOpenClawConfig();
  const m = getDefaultModel(cfg);
  return typeof m === "string" && m ? m : undefined;
}

/**
 * Write the global default model ref (`agents.defaults.model.primary`).
 * Pass an empty string / undefined to clear it.
 * Validates that the modelRef points to an existing provider/model.
 */
export function writeDefaultModel(modelRef: string | undefined): string | undefined {
  const cfg = loadOpenClawConfig();
  const providers = getProviders(cfg);
  const ref = (modelRef ?? "").trim();
  if (ref) {
    // Validate: ref must be "providerId/modelId" (modelId may contain slashes)
    const slashIdx = ref.indexOf("/");
    if (slashIdx <= 0) {
      throw new ModelConfigError("EMPTY_MODEL_ID", `Default model ref must be "providerId/modelId", got "${ref}"`);
    }
    const providerId = ref.slice(0, slashIdx);
    const modelId = ref.slice(slashIdx + 1);
    const provider = providers[providerId];
    if (!provider) {
      throw new ModelConfigError("PROVIDER_NOT_FOUND", `Provider "${providerId}" not found`);
    }
    const exists = (provider.models ?? []).some((m) => m.id === modelId);
    if (!exists) {
      throw new ModelConfigError("MODEL_NOT_FOUND", `Model "${modelId}" not found in provider "${providerId}"`);
    }
  }
  cfg.agents = cfg.agents ?? {};
  cfg.agents.defaults = cfg.agents.defaults ?? {};
  if (ref) {
    cfg.agents.defaults.model = { primary: ref };
  } else {
    delete cfg.agents.defaults.model;
  }
  saveOpenClawConfig(cfg);
  return ref || undefined;
}

// ── Write (whole file) ──

export function writeModelsConfig(providers: ProvidersMap): void {
  const cfg = loadOpenClawConfig();
  cfg.models = cfg.models ?? {};
  cfg.models.providers = clone(providers);
  saveOpenClawConfig(cfg);
}

// ── Provider CRUD ──

export function addProvider(id: string, provider: ProviderConfig): ProvidersMap {
  if (!id || !PROVIDER_ID_PATTERN.test(id)) {
    throw new ModelConfigError("INVALID_PROVIDER_ID", `Provider id must match ${PROVIDER_ID_PATTERN}`);
  }
  if (!provider?.baseUrl) {
    throw new ModelConfigError("EMPTY_BASE_URL", "baseUrl is required");
  }
  const cfg = loadOpenClawConfig();
  const providers = getProviders(cfg);
  if (providers[id]) {
    throw new ModelConfigError("DUPLICATE_PROVIDER", `Provider "${id}" already exists`);
  }
  const next = clone(providers);
  next[id] = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? "",
    ...(provider.api ? { api: provider.api } : {}),
    models: provider.models ? clone(provider.models) : [],
  };
  cfg.models = cfg.models ?? {};
  cfg.models.providers = next;
  saveOpenClawConfig(cfg);
  return next;
}

export function updateProvider(id: string, provider: ProviderConfig): ProvidersMap {
  if (!id) throw new ModelConfigError("EMPTY_PROVIDER_ID", "Provider id is required");
  const cfg = loadOpenClawConfig();
  const providers = getProviders(cfg);
  if (!providers[id]) {
    throw new ModelConfigError("PROVIDER_NOT_FOUND", `Provider "${id}" not found`);
  }
  if (!provider?.baseUrl) {
    throw new ModelConfigError("EMPTY_BASE_URL", "baseUrl is required");
  }
  const next = clone(providers);
  next[id] = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? "",
    ...(provider.api ? { api: provider.api } : {}),
    models: provider.models ? clone(provider.models) : (next[id].models ?? []),
  };
  cfg.models = cfg.models ?? {};
  cfg.models.providers = next;
  saveOpenClawConfig(cfg);
  return next;
}

export function deleteProvider(id: string): ProvidersMap {
  if (!id) throw new ModelConfigError("EMPTY_PROVIDER_ID", "Provider id is required");
  const cfg = loadOpenClawConfig();
  const providers = getProviders(cfg);
  if (!providers[id]) {
    throw new ModelConfigError("PROVIDER_NOT_FOUND", `Provider "${id}" not found`);
  }
  const next = clone(providers);
  delete next[id];
  cfg.models = cfg.models ?? {};
  cfg.models.providers = next;
  saveOpenClawConfig(cfg);
  return next;
}

// ── Model CRUD (scoped to a provider) ──

function withProviderModelMutated(
  providerId: string,
  mutate: (models: ModelConfig[]) => ModelConfig[],
): ProvidersMap {
  if (!providerId) throw new ModelConfigError("EMPTY_PROVIDER_ID", "Provider id is required");
  const cfg = loadOpenClawConfig();
  const providers = getProviders(cfg);
  if (!providers[providerId]) {
    throw new ModelConfigError("PROVIDER_NOT_FOUND", `Provider "${providerId}" not found`);
  }
  const next = clone(providers);
  const models = next[providerId].models ?? [];
  next[providerId].models = mutate(models);
  cfg.models = cfg.models ?? {};
  cfg.models.providers = next;
  saveOpenClawConfig(cfg);
  return next;
}

export function addModel(providerId: string, model: ModelConfig): ProvidersMap {
  if (!model?.id) throw new ModelConfigError("EMPTY_MODEL_ID", "Model id is required");
  return withProviderModelMutated(providerId, (models) => {
    if (models.some((m) => m.id === model.id)) {
      throw new ModelConfigError("DUPLICATE_PROVIDER", `Model "${model.id}" already exists in provider "${providerId}"`);
    }
    return [...models, clone(model)];
  });
}

export function updateModel(providerId: string, modelId: string, model: ModelConfig): ProvidersMap {
  if (!modelId) throw new ModelConfigError("EMPTY_MODEL_ID", "Model id is required");
  return withProviderModelMutated(providerId, (models) => {
    const idx = models.findIndex((m) => m.id === modelId);
    if (idx < 0) {
      throw new ModelConfigError("MODEL_NOT_FOUND", `Model "${modelId}" not found in provider "${providerId}"`);
    }
    const updated: ModelConfig = { ...clone(models[idx]), ...clone(model), id: modelId };
    const next = [...models];
    next[idx] = updated;
    return next;
  });
}

export function deleteModel(providerId: string, modelId: string): ProvidersMap {
  if (!modelId) throw new ModelConfigError("EMPTY_MODEL_ID", "Model id is required");
  return withProviderModelMutated(providerId, (models) => {
    const next = models.filter((m) => m.id !== modelId);
    if (next.length === models.length) {
      throw new ModelConfigError("MODEL_NOT_FOUND", `Model "${modelId}" not found in provider "${providerId}"`);
    }
    return next;
  });
}

// ── Import / Export ──

export type ImportMode = "append" | "new" | "replace";

/**
 * Import providers from a partial ModelFile.
 * - append: merge into existing providers (skip duplicates by id)
 * - new:    only add providers whose id does not already exist
 * - replace: replace the entire providers map
 */
export function importModels(
  incoming: ModelFile,
  mode: ImportMode,
  existing?: ModelFile,
): ProvidersMap {
  const current = existing ?? readModelsConfig();
  const incomingProviders = incoming?.providers ?? {};

  if (mode === "replace") {
    const next = clone(incomingProviders);
    writeModelsConfig(next);
    return next;
  }

  const next = clone(current.providers);
  for (const [id, provider] of Object.entries(incomingProviders)) {
    // append: skip ids that already exist (merge = keep existing)
    // new:    skip ids that already exist (add new only)
    if (next[id]) continue;
    next[id] = clone(provider);
  }
  writeModelsConfig(next);
  return next;
}

/**
 * Export providers as a ModelFile. Machine-specific secret refs
 * (${input:*.HEX}) are stripped to avoid leaking cross-machine secrets.
 */
export function exportModels(): ModelFile {
  const { providers } = readModelsConfig();
  const cleaned: ProvidersMap = {};
  for (const [id, provider] of Object.entries(providers)) {
    const p = clone(provider);
    if (p.apiKey && MACHINE_SECRET_RE.test(p.apiKey)) {
      p.apiKey = "";
    }
    if (p.models) {
      p.models = p.models.map((m) => {
        const cm = clone(m);
        if (cm.api && MACHINE_SECRET_RE.test(cm.api)) cm.api = "";
        return cm;
      });
    }
    cleaned[id] = p;
  }
  return { providers: cleaned };
}

export function isMachineSpecificApiKey(value: string): boolean {
  return MACHINE_SECRET_RE.test(value ?? "");
}
