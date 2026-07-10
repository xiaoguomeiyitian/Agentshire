// View layer for the model (LLM provider) management workshop.
// Master-detail layout: left provider list + right provider detail/model cards.
// Borrows the interaction patterns from lm-manager (form modals, import/export,
// toast, delete confirmation).

import type { ModelManager } from "./ModelManager";
import type { ProviderConfig, ModelConfig, ProvidersMap } from "./types";

const PROVIDER_ID_PATTERN = /^[a-z0-9_-]+$/;

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function maskKey(key: string): string {
  if (!key) return "—";
  if (key.startsWith("${")) return key; // env ref, show as-is
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 4) + "•".repeat(Math.max(4, key.length - 8)) + key.slice(-4);
}

export class ModelManagerView {
  private manager: ModelManager;
  private root: HTMLElement;

  // editing state
  private editingProviderId: string | null = null;
  private editingModelId: string | null = null;

  constructor(manager: ModelManager, root: HTMLElement) {
    this.manager = manager;
    this.root = root;
    this.bindStatic();
    this.manager.onConfigChanged(() => this.render());
  }

  private $(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  private bindStatic(): void {
    // Provider list
    this.$("mm-add-provider")?.addEventListener("click", () => this.openProviderModal(null));

    // Provider detail actions
    this.$("mm-edit-provider")?.addEventListener("click", () => {
      if (this.manager.activeProviderId) this.openProviderModal(this.manager.activeProviderId);
    });
    this.$("mm-delete-provider")?.addEventListener("click", () => this.confirmDeleteProvider());
    this.$("mm-add-model")?.addEventListener("click", () => this.openModelModal(null));

    // Provider modal
    this.$("mm-provider-modal-close")?.addEventListener("click", () => this.closeProviderModal());
    this.$("mm-provider-cancel")?.addEventListener("click", () => this.closeProviderModal());
    this.$("mm-provider-save")?.addEventListener("click", () => this.saveProvider());

    // Model modal
    this.$("mm-model-modal-close")?.addEventListener("click", () => this.closeModelModal());
    this.$("mm-model-cancel")?.addEventListener("click", () => this.closeModelModal());
    this.$("mm-model-save")?.addEventListener("click", () => this.saveModel());

    // Import / Export
    this.$("btn-import")?.addEventListener("click", () => this.openImportDialog());
    this.$("mm-import-close")?.addEventListener("click", () => this.closeImportDialog());
    this.$("mm-import-cancel")?.addEventListener("click", () => this.closeImportDialog());
    this.$("mm-import-apply")?.addEventListener("click", () => this.applyImport());
    this.$("btn-export")?.addEventListener("click", () => this.exportConfig());

    // Confirm overlay
    this.$("confirm-cancel")?.addEventListener("click", () => this.closeConfirm());
  }

  // ── Render ──

  render(): void {
    this.renderProviderList();
    this.renderDetail();
  }

  private renderProviderList(): void {
    const list = this.$("mm-providers");
    if (!list) return;
    const ids = Object.keys(this.manager.providers);
    if (ids.length === 0) {
      list.innerHTML = `<div class="mm-list-empty" data-i18n="editor.no_providers">暂无供应商，点击「+ 添加」。</div>`;
      return;
    }
    list.innerHTML = ids
      .map((id) => {
        const p = this.manager.providers[id];
        const active = id === this.manager.activeProviderId ? " active" : "";
        const count = p.models?.length ?? 0;
        return `<div class="mm-provider-item${active}" data-id="${esc(id)}">
          <div class="mm-provider-item-name">${esc(id)}</div>
          <div class="mm-provider-item-meta"><span class="mm-provider-item-id">${esc(id)}</span><span class="mm-count">${count}</span></div>
        </div>`;
      })
      .join("");
    list.querySelectorAll<HTMLElement>(".mm-provider-item").forEach((el) => {
      el.addEventListener("click", () => {
        this.manager.setActiveProvider(el.dataset.id ?? null);
      });
    });
  }

  private renderDetail(): void {
    const empty = this.$("mm-empty");
    const detail = this.$("mm-provider-detail");
    const id = this.manager.activeProviderId;
    const provider = id ? this.manager.providers[id] : null;
    if (!provider || !id) {
      if (empty) empty.hidden = false;
      if (detail) detail.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (detail) detail.hidden = false;

    this.set("mm-provider-name", id);
    this.set("mm-provider-id", id);
    this.set("mm-provider-api", provider.api || "—");
    this.set("mm-provider-url", provider.baseUrl || "—");
    this.set("mm-provider-key", maskKey(provider.apiKey || ""));
    this.set("mm-model-count", String(provider.models?.length ?? 0));

    const modelsEl = this.$("mm-models");
    if (modelsEl) {
      const models = provider.models ?? [];
      if (models.length === 0) {
        modelsEl.innerHTML = `<div class="mm-list-empty" data-i18n="editor.no_models">该供应商暂无模型。</div>`;
      } else {
        modelsEl.innerHTML = models
          .map((m) => this.modelCardHtml(id, m))
          .join("");
        modelsEl.querySelectorAll<HTMLElement>(".mm-model-edit").forEach((el) => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openModelModal(el.dataset.modelId ?? null);
          });
        });
        modelsEl.querySelectorAll<HTMLElement>(".mm-model-del").forEach((el) => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            this.confirmDeleteModel(el.dataset.providerId ?? "", el.dataset.modelId ?? "");
          });
        });
      }
    }
  }

  private modelCardHtml(providerId: string, m: ModelConfig): string {
    const tokens = m.contextWindow ? ` · ${m.contextWindow} ctx` : "";
    const maxOut = m.maxTokens ? ` · ${m.maxTokens} out` : "";
    return `<div class="mm-model-card">
      <div class="mm-model-card-main">
        <div class="mm-model-id">${esc(m.id)}</div>
        <div class="mm-model-sub">${esc(m.name || "")}${tokens}${maxOut}</div>
      </div>
      <div class="mm-model-card-actions">
        <button class="mm-icon-btn mm-model-edit" data-provider-id="${esc(providerId)}" data-model-id="${esc(m.id)}" data-i18n-title="editor.edit">✎</button>
        <button class="mm-icon-btn mm-btn-danger mm-model-del" data-provider-id="${esc(providerId)}" data-model-id="${esc(m.id)}" data-i18n-title="editor.delete">🗑</button>
      </div>
    </div>`;
  }

  private set(id: string, text: string): void {
    const el = this.$(id);
    if (el) el.textContent = text;
  }

  // ── Provider modal ──

  private openProviderModal(id: string | null): void {
    this.editingProviderId = id;
    const modal = this.$("mm-provider-modal");
    const title = this.$("mm-provider-modal-title");
    const provider = id ? this.manager.providers[id] : null;

    if (title) title.textContent = id ? (window.locale === "en" ? "Edit Provider" : "编辑供应商") : (window.locale === "en" ? "Add Provider" : "添加供应商");

    const idInput = this.$("mm-provider-id-input") as HTMLInputElement | null;
    const apiSelect = this.$("mm-provider-api-input") as HTMLSelectElement | null;
    const urlInput = this.$("mm-provider-url-input") as HTMLInputElement | null;
    const keyInput = this.$("mm-provider-key-input") as HTMLInputElement | null;

    if (idInput) { idInput.value = id ?? ""; idInput.disabled = !!id; }
    if (apiSelect) apiSelect.value = provider?.api ?? "openai-completions";
    if (urlInput) urlInput.value = provider?.baseUrl ?? "";
    if (keyInput) keyInput.value = provider?.apiKey ?? "";

    if (modal) modal.hidden = false;
  }

  private closeProviderModal(): void {
    const modal = this.$("mm-provider-modal");
    if (modal) modal.hidden = true;
    this.editingProviderId = null;
  }

  private async saveProvider(): Promise<void> {
    const idInput = this.$("mm-provider-id-input") as HTMLInputElement | null;
    const apiSelect = this.$("mm-provider-api-input") as HTMLSelectElement | null;
    const urlInput = this.$("mm-provider-url-input") as HTMLInputElement | null;
    const keyInput = this.$("mm-provider-key-input") as HTMLInputElement | null;

    const id = (idInput?.value ?? "").trim();
    const apiRaw = apiSelect?.value ?? "openai-completions";
    const baseUrl = (urlInput?.value ?? "").trim();
    const apiKey = (keyInput?.value ?? "").trim();

    if (!id) { this.toast("供应商 ID 不能为空", true); return; }
    if (!PROVIDER_ID_PATTERN.test(id)) { this.toast("供应商 ID 格式非法（仅限小写字母、数字、连字符、下划线）", true); return; }
    if (!baseUrl) { this.toast("Base URL 不能为空", true); return; }

    const provider: ProviderConfig = { baseUrl, apiKey };
    if (apiRaw) provider.api = apiRaw;

    let ok: boolean;
    if (this.editingProviderId) {
      ok = await this.manager.updateProvider(this.editingProviderId, provider);
    } else {
      ok = await this.manager.addProvider(id, provider);
    }
    if (ok) {
      this.closeProviderModal();
      this.toast(this.editingProviderId ? "已保存" : "已添加");
    } else {
      this.toast("操作失败（ID 可能已存在）", true);
    }
  }

  // ── Model modal ──

  private openModelModal(modelId: string | null): void {
    const providerId = this.manager.activeProviderId;
    if (!providerId) return;
    this.editingModelId = modelId;
    const modal = this.$("mm-model-modal");
    const title = this.$("mm-model-modal-title");
    const provider = this.manager.providers[providerId];
    const model = modelId ? provider?.models?.find((m) => m.id === modelId) : null;

    if (title) title.textContent = modelId ? (window.locale === "en" ? "Edit Model" : "编辑模型") : (window.locale === "en" ? "Add Model" : "添加模型");

    const idInput = this.$("mm-model-id-input") as HTMLInputElement | null;
    const nameInput = this.$("mm-model-name-input") as HTMLInputElement | null;
    const maxIn = this.$("mm-model-maxin-input") as HTMLInputElement | null;
    const maxOut = this.$("mm-model-maxout-input") as HTMLInputElement | null;

    if (idInput) idInput.value = model?.id ?? "";
    if (nameInput) nameInput.value = model?.name ?? "";
    if (maxIn) maxIn.value = model?.contextWindow != null ? String(model.contextWindow) : "256000";
    if (maxOut) maxOut.value = model?.maxTokens != null ? String(model.maxTokens) : "16384";

    if (modal) modal.hidden = false;
  }

  private closeModelModal(): void {
    const modal = this.$("mm-model-modal");
    if (modal) modal.hidden = true;
    this.editingModelId = null;
  }

  private async saveModel(): Promise<void> {
    const providerId = this.manager.activeProviderId;
    if (!providerId) return;
    const idInput = this.$("mm-model-id-input") as HTMLInputElement | null;
    const nameInput = this.$("mm-model-name-input") as HTMLInputElement | null;
    const maxIn = this.$("mm-model-maxin-input") as HTMLInputElement | null;
    const maxOut = this.$("mm-model-maxout-input") as HTMLInputElement | null;

    const id = (idInput?.value ?? "").trim();
    if (!id) { this.toast("模型 ID 不能为空", true); return; }

    const model: ModelConfig = { id };
    if (nameInput?.value.trim()) model.name = nameInput.value.trim();
    if (maxIn?.value) model.contextWindow = parseInt(maxIn.value, 10);
    if (maxOut?.value) model.maxTokens = parseInt(maxOut.value, 10);

    let ok: boolean;
    if (this.editingModelId) {
      ok = await this.manager.updateModel(providerId, this.editingModelId, model);
    } else {
      ok = await this.manager.addModel(providerId, model);
    }
    if (ok) {
      this.closeModelModal();
      this.toast(this.editingModelId ? "已保存" : "已添加");
    } else {
      this.toast("操作失败（模型 ID 可能已存在）", true);
    }
  }

  // ── Import / Export ──

  private openImportDialog(): void {
    const dialog = this.$("mm-import-dialog");
    const ta = this.$("mm-import-json") as HTMLTextAreaElement | null;
    if (ta) ta.value = "";
    if (dialog) dialog.hidden = false;
  }
  private closeImportDialog(): void {
    const dialog = this.$("mm-import-dialog");
    if (dialog) dialog.hidden = true;
  }

  private async applyImport(): Promise<void> {
    const modeSel = this.$("mm-import-mode") as HTMLSelectElement | null;
    const ta = this.$("mm-import-json") as HTMLTextAreaElement | null;
    const mode = (modeSel?.value ?? "append") as "append" | "new" | "replace";
    let file: { providers: ProvidersMap };
    try {
      file = JSON.parse(ta?.value ?? "{}");
    } catch {
      this.toast("JSON 解析失败", true);
      return;
    }
    if (!file.providers || typeof file.providers !== "object") {
      this.toast("缺少 providers 字段", true);
      return;
    }
    const ok = await this.manager.importModels(file, mode);
    if (ok) {
      this.closeImportDialog();
      this.toast("导入成功");
    } else {
      this.toast("导入失败", true);
    }
  }

  private async exportConfig(): Promise<void> {
    const file = await this.manager.exportModels();
    if (!file) { this.toast("导出失败", true); return; }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "openclaw-models.json";
    a.click();
    URL.revokeObjectURL(url);
    this.toast("已导出");
  }

  // ── Confirm ──

  private confirmDeleteProvider(): void {
    const id = this.manager.activeProviderId;
    if (!id) return;
    this.showConfirm(
      window.locale === "en" ? "Delete Provider" : "删除供应商",
      window.locale === "en" ? `Delete provider "${id}" and all its models?` : `确定删除供应商 "${id}" 及其所有模型吗？`,
      async () => {
        const ok = await this.manager.deleteProvider(id);
        this.toast(ok ? "已删除" : "删除失败", !ok);
      },
    );
  }

  private confirmDeleteModel(providerId: string, modelId: string): void {
    this.showConfirm(
      window.locale === "en" ? "Delete Model" : "删除模型",
      window.locale === "en" ? `Delete model "${modelId}"?` : `确定删除模型 "${modelId}" 吗？`,
      async () => {
        const ok = await this.manager.deleteModel(providerId, modelId);
        this.toast(ok ? "已删除" : "删除失败", !ok);
      },
    );
  }

  private showConfirm(title: string, message: string, onOk: () => void): void {
    const overlay = this.$("confirm-overlay");
    this.set("confirm-title", title);
    this.set("confirm-message", message);
    const okBtn = this.$("confirm-ok");
    const cancelBtn = this.$("confirm-cancel");
    const cleanup = () => {
      if (overlay) overlay.classList.remove("open");
      okBtn?.removeEventListener("click", onOkHandler);
      cancelBtn?.removeEventListener("click", cancelHandler);
      overlay?.removeEventListener("click", bgHandler);
    };
    const onOkHandler = () => { cleanup(); onOk(); };
    const cancelHandler = () => cleanup();
    const bgHandler = (e: Event) => { if (e.target === overlay) cleanup(); };
    okBtn?.addEventListener("click", onOkHandler);
    cancelBtn?.addEventListener("click", cancelHandler);
    overlay?.addEventListener("click", bgHandler);
    if (overlay) overlay.classList.add("open");
  }

  private closeConfirm(): void {
    this.$("confirm-overlay")?.classList.remove("open");
  }

  // ── Toast ──

  private toast(text: string, isError = false): void {
    const existing = document.querySelector(".mm-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = `mm-toast${isError ? " mm-toast-error" : ""}`;
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}
