// Coordinator for the model (LLM provider) management workshop.
// Holds provider state, undo/redo history, and talks to the backend
// /models/_api/* HTTP endpoints.

import type { ProvidersMap, ProviderConfig, ModelConfig, ImportMode, ApiResult } from "./types";

const MAX_UNDO = 50;

async function apiPost(route: string, body: unknown): Promise<ApiResult> {
  const resp = await fetch(`/models/_api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await resp.json()) as ApiResult;
}

export class ModelManager {
  providers: ProvidersMap = {};
  activeProviderId: string | null = null;

  private undoHistory: ProvidersMap[] = [];
  private redoHistory: ProvidersMap[] = [];
  private listeners: Array<() => void> = [];

  get canUndo(): boolean {
    return this.undoHistory.length > 0;
  }
  get canRedo(): boolean {
    return this.redoHistory.length > 0;
  }

  onConfigChanged(cb: () => void): void {
    this.listeners.push(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private pushUndo(): void {
    this.undoHistory.push(structuredClone(this.providers));
    if (this.undoHistory.length > MAX_UNDO) this.undoHistory.shift();
    this.redoHistory = [];
  }

  undo(): void {
    const prev = this.undoHistory.pop();
    if (!prev) return;
    this.redoHistory.push(structuredClone(this.providers));
    this.providers = prev;
    this.emit();
  }

  redo(): void {
    const next = this.redoHistory.pop();
    if (!next) return;
    this.undoHistory.push(structuredClone(this.providers));
    this.providers = next;
    this.emit();
  }

  async load(): Promise<void> {
    const res = await apiPost("load", {});
    if (res.providers) {
      this.providers = res.providers;
      const ids = Object.keys(this.providers);
      if (!this.activeProviderId || !this.providers[this.activeProviderId]) {
        this.activeProviderId = ids[0] ?? null;
      }
      this.emit();
    }
  }

  private async commit(res: ApiResult): Promise<boolean> {
    if (!res.success || !res.providers) return false;
    this.providers = res.providers;
    this.emit();
    return true;
  }

  async addProvider(id: string, provider: ProviderConfig): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("add-provider", { id, provider });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    this.activeProviderId = id;
    return this.commit(res);
  }

  async updateProvider(id: string, provider: ProviderConfig): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("update-provider", { id, provider });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    return this.commit(res);
  }

  async deleteProvider(id: string): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("delete-provider", { id });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    if (this.activeProviderId === id) {
      this.activeProviderId = Object.keys(res.providers ?? {})[0] ?? null;
    }
    return this.commit(res);
  }

  async addModel(providerId: string, model: ModelConfig): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("add-model", { providerId, model });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    return this.commit(res);
  }

  async updateModel(providerId: string, modelId: string, model: ModelConfig): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("update-model", { providerId, modelId, model });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    return this.commit(res);
  }

  async deleteModel(providerId: string, modelId: string): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("delete-model", { providerId, modelId });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    return this.commit(res);
  }

  async save(): Promise<boolean> {
    const res = await apiPost("save", { providers: this.providers });
    return !!res.success;
  }

  async importModels(file: { providers: ProvidersMap }, mode: ImportMode): Promise<boolean> {
    this.pushUndo();
    const res = await apiPost("import", { file, mode });
    if (!res.success) {
      this.undoHistory.pop();
      return false;
    }
    return this.commit(res);
  }

  async exportModels(): Promise<{ providers: ProvidersMap } | null> {
    const res = await apiPost("export", {});
    return res.file ?? null;
  }

  setActiveProvider(id: string | null): void {
    this.activeProviderId = id;
    this.emit();
  }
}
