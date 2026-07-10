// Frontend types for model (LLM provider) management.
// Mirrors the OpenClaw openclaw.json `models.providers` schema.

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
  url?: string;
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

export type ImportMode = "append" | "new" | "replace";

export interface ApiResult {
  success?: boolean;
  providers?: ProvidersMap;
  file?: ModelFile;
  error?: string;
  code?: string;
}
