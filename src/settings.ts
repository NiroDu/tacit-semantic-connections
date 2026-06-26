import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type TacitPlugin from "./main";
import { createProvider } from "./providers/factory";

// ── Provider types ───────────────────────────────────────
export type ProviderType = "ollama" | "openai" | "openrouter" | "gemini" | "openai-compat";
export type RerankProviderType = "none" | "jina" | "cohere";

export interface TacitSettings {
  // Embeddings
  provider: ProviderType;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiKey: string;
  openaiModel: string;
  openrouterKey: string;
  openrouterModel: string;
  geminiKey: string;
  geminiModel: string;
  compatBaseUrl: string;
  compatKey: string;
  compatModel: string;

  // Reranking
  rerankEnabled: boolean;
  rerankProvider: RerankProviderType;
  rerankEndpoint: string;
  rerankKey: string;
  rerankModel: string;

  // Indexing
  excludeFolders: string[];
  excludeTags: string[];
  chunkSize: number;
  chunkOverlap: number;
  concurrency: number;
  storageInVault: boolean;
  liveIndexing: boolean;
  liveIndexingMinChars: number;

  // Related Notes
  resultCount: number;
  snippetLines: number;
  serendipityDefault: boolean;
  showScoreNumbers: boolean;
  autoUpdate: boolean;

  // Find
  findDefaultMode: "retrieval" | "synthesis";
  findChatProvider: ProviderType;
  findChatModel: string;
  findTopK: number;

  // Internal state
  firstRun: boolean;
}

export const DEFAULT_SETTINGS: TacitSettings = {
  provider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "",
  openaiKey: "",
  openaiModel: "text-embedding-3-small",
  openrouterKey: "",
  openrouterModel: "",
  geminiKey: "",
  geminiModel: "text-embedding-004",
  compatBaseUrl: "",
  compatKey: "",
  compatModel: "",

  rerankEnabled: false,
  rerankProvider: "none",
  rerankEndpoint: "",
  rerankKey: "",
  rerankModel: "",

  excludeFolders: ["Templates", "Attachments", ".obsidian"],
  excludeTags: ["#template", "#attachment"],
  chunkSize: 500,
  chunkOverlap: 60,
  concurrency: 3,
  storageInVault: true,
  liveIndexing: false,
  liveIndexingMinChars: 200,

  resultCount: 8,
  snippetLines: 2,
  serendipityDefault: false,
  showScoreNumbers: false,
  autoUpdate: true,

  findDefaultMode: "retrieval",
  findChatProvider: "ollama",
  findChatModel: "",
  findTopK: 8,

  firstRun: true,
};

// ── Settings Tab ─────────────────────────────────────────
export class TacitSettingTab extends PluginSettingTab {
  plugin: TacitPlugin;

  constructor(app: App, plugin: TacitPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "嵌入向量" });
    this.renderProviderSection(containerEl);

    containerEl.createEl("h2", { text: "重排序（可选）" });
    this.renderRerankSection(containerEl);

    containerEl.createEl("h2", { text: "索引" });
    this.renderIndexingSection(containerEl);

    containerEl.createEl("h2", { text: "相关笔记" });
    this.renderRelatedSection(containerEl);

    containerEl.createEl("h2", { text: "查找" });
    this.renderFindSection(containerEl);

    containerEl.createEl("h2", { text: "隐私说明" });
    this.renderPrivacySection(containerEl);
  }

  // ── Shared: wire a "测试连接" button + result display ────
  private wireTestBtn(btn: HTMLButtonElement, resultEl: HTMLElement) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "测试中…";
      resultEl.style.display = "none";
      try {
        const provider = createProvider(this.plugin.settings);
        const result = await provider.test();
        resultEl.style.display = "block";
        if (result.ok) {
          resultEl.className = "tacit-test-result ok";
          resultEl.textContent = `已连接 · ${result.dimensions ?? "?"} 维`;
        } else {
          resultEl.className = "tacit-test-result fail";
          resultEl.textContent = `连接失败 · ${result.message}`;
        }
      } catch (e) {
        resultEl.style.display = "block";
        resultEl.className = "tacit-test-result fail";
        resultEl.textContent = `连接失败 · ${(e as Error).message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = "测试连接";
      }
    });
  }

  private renderProviderSection(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("向量 Provider")
      .setDesc("选择用于生成嵌入向量的服务。Ollama 在本地运行，数据不离开你的电脑。")
      .addDropdown(d => d
        .addOption("ollama", "Ollama（本地，推荐）")
        .addOption("openai", "OpenAI")
        .addOption("openrouter", "OpenRouter")
        .addOption("gemini", "Gemini")
        .addOption("openai-compat", "通用 OpenAI 兼容")
        .setValue(s.provider)
        .onChange(async v => {
          s.provider = v as ProviderType;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    // Each renderer adds its own inline test button
    if (s.provider === "ollama") this.renderOllamaFields(el);
    else if (s.provider === "openai") this.renderOpenAIFields(el);
    else if (s.provider === "openrouter") this.renderOpenRouterFields(el);
    else if (s.provider === "gemini") this.renderGeminiFields(el);
    else if (s.provider === "openai-compat") this.renderCompatFields(el);
  }

  private renderOllamaFields(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("Ollama 地址")
      .setDesc("默认 http://localhost:11434。在移动端请填写远程地址。")
      .addText(t => t
        .setPlaceholder("http://localhost:11434")
        .setValue(s.ollamaBaseUrl)
        .onChange(async v => { s.ollamaBaseUrl = v.trim(); await this.plugin.saveSettings(); })
      );

    // Model selector + refresh + test — all in one row
    const modelSetting = new Setting(el)
      .setName("模型")
      .setDesc("从 Ollama 本地已安装的模型中选择。");

    const select = modelSetting.controlEl.createEl("select", { cls: "tacit-model-select" });

    const loadModels = async () => {
      select.empty();
      const loading = select.createEl("option", { text: "加载中…", value: "" });
      loading.disabled = true;
      try {
        const { OllamaProvider } = await import("./providers/ollama");
        const p = new OllamaProvider(s.ollamaBaseUrl, s.ollamaModel);
        const models = await p.listModels?.() ?? [];
        select.empty();
        if (models.length === 0) {
          select.createEl("option", { text: "未找到嵌入模型", value: "" });
          new Notice("未找到嵌入模型，请尝试：ollama pull bge-m3");
        } else {
          for (const m of models) {
            const o = select.createEl("option", { text: m, value: m });
            if (m === s.ollamaModel) o.selected = true;
          }
        }
      } catch {
        select.empty();
        select.createEl("option", { text: "无法连接 Ollama", value: "" });
      }
    };

    loadModels();
    select.addEventListener("change", async () => {
      s.ollamaModel = select.value;
      await this.plugin.saveSettings();
    });

    // Refresh button — inline in the same row
    const refreshBtn = modelSetting.controlEl.createEl("button", { text: "刷新" });
    refreshBtn.addEventListener("click", loadModels);

    // Test button — inline in the same row
    const testBtn = modelSetting.controlEl.createEl("button", { text: "测试连接", cls: "mod-cta" });
    const testResult = el.createDiv({ cls: "tacit-test-result" });
    testResult.style.display = "none";
    this.wireTestBtn(testBtn, testResult);
  }

  private renderOpenAIFields(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("OpenAI API Key")
      .addText(t => {
        t.setPlaceholder("sk-...").setValue(s.openaiKey);
        t.inputEl.type = "password";
        t.inputEl.addEventListener("input", async (e) => {
          s.openaiKey = (e.target as HTMLInputElement).value;
          await this.plugin.saveSettings();
        });
      });

    const modelSetting = new Setting(el)
      .setName("模型")
      .addText(t => t
        .setPlaceholder("text-embedding-3-small")
        .setValue(s.openaiModel)
        .onChange(async v => { s.openaiModel = v.trim(); await this.plugin.saveSettings(); })
      );

    const testBtn = modelSetting.controlEl.createEl("button", { text: "测试连接", cls: "mod-cta" });
    const testResult = el.createDiv({ cls: "tacit-test-result" });
    testResult.style.display = "none";
    this.wireTestBtn(testBtn, testResult);
  }

  private renderOpenRouterFields(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("OpenRouter API Key")
      .setDesc("注意：OpenRouter 的嵌入模型支持有限，请确认所选模型支持 /embeddings 接口。")
      .addText(t => {
        t.setPlaceholder("sk-or-...").setValue(s.openrouterKey);
        t.inputEl.type = "password";
        t.inputEl.addEventListener("input", async (e) => {
          s.openrouterKey = (e.target as HTMLInputElement).value;
          await this.plugin.saveSettings();
        });
      });

    const modelSetting = new Setting(el)
      .setName("模型")
      .addText(t => t
        .setValue(s.openrouterModel)
        .onChange(async v => { s.openrouterModel = v.trim(); await this.plugin.saveSettings(); })
      );

    const testBtn = modelSetting.controlEl.createEl("button", { text: "测试连接", cls: "mod-cta" });
    const testResult = el.createDiv({ cls: "tacit-test-result" });
    testResult.style.display = "none";
    this.wireTestBtn(testBtn, testResult);
  }

  private renderGeminiFields(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("Gemini API Key")
      .addText(t => {
        t.setPlaceholder("AIza...").setValue(s.geminiKey);
        t.inputEl.type = "password";
        t.inputEl.addEventListener("input", async (e) => {
          s.geminiKey = (e.target as HTMLInputElement).value;
          await this.plugin.saveSettings();
        });
      });

    const modelSetting = new Setting(el)
      .setName("模型")
      .addDropdown(d => d
        .addOption("text-embedding-004", "text-embedding-004（768维）")
        .addOption("gemini-embedding-001", "gemini-embedding-001（自定义维度）")
        .setValue(s.geminiModel)
        .onChange(async v => { s.geminiModel = v; await this.plugin.saveSettings(); })
      );

    const testBtn = modelSetting.controlEl.createEl("button", { text: "测试连接", cls: "mod-cta" });
    const testResult = el.createDiv({ cls: "tacit-test-result" });
    testResult.style.display = "none";
    this.wireTestBtn(testBtn, testResult);
  }

  private renderCompatFields(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("Base URL")
      .setDesc("兼容 OpenAI /embeddings 接口的任何服务（LM Studio / vLLM / Ollama /v1 等）")
      .addText(t => t
        .setPlaceholder("http://localhost:1234/v1")
        .setValue(s.compatBaseUrl)
        .onChange(async v => { s.compatBaseUrl = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(el)
      .setName("API Key（可留空）")
      .addText(t => {
        t.setValue(s.compatKey);
        t.inputEl.type = "password";
        t.inputEl.addEventListener("input", async (e) => {
          s.compatKey = (e.target as HTMLInputElement).value;
          await this.plugin.saveSettings();
        });
      });

    const modelSetting = new Setting(el)
      .setName("模型名称")
      .addText(t => t
        .setValue(s.compatModel)
        .onChange(async v => { s.compatModel = v.trim(); await this.plugin.saveSettings(); })
      );

    const testBtn = modelSetting.controlEl.createEl("button", { text: "测试连接", cls: "mod-cta" });
    const testResult = el.createDiv({ cls: "tacit-test-result" });
    testResult.style.display = "none";
    this.wireTestBtn(testBtn, testResult);
  }

  private renderRerankSection(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("启用重排序")
      .setDesc("重排序可提升精度，但需要额外一次 API 调用。默认关闭。")
      .addToggle(t => t.setValue(s.rerankEnabled).onChange(async v => {
        s.rerankEnabled = v;
        await this.plugin.saveSettings();
        this.display();
      }));

    if (!s.rerankEnabled) return;

    new Setting(el)
      .setName("重排序服务")
      .addDropdown(d => d
        .addOption("jina", "Jina Reranker")
        .addOption("cohere", "Cohere Rerank")
        .setValue(s.rerankProvider === "none" ? "jina" : s.rerankProvider)
        .onChange(async v => { s.rerankProvider = v as RerankProviderType; await this.plugin.saveSettings(); })
      );

    new Setting(el)
      .setName("Rerank API Key")
      .addText(t => { t.setValue(s.rerankKey); t.inputEl.type = "password"; });

    new Setting(el)
      .setName("Rerank 模型")
      .addText(t => t
        .setPlaceholder("jina-reranker-v2-base-multilingual")
        .setValue(s.rerankModel)
        .onChange(async v => { s.rerankModel = v.trim(); await this.plugin.saveSettings(); })
      );
  }

  private renderIndexingSection(el: HTMLElement) {
    const s = this.plugin.settings;
    const indexer = this.plugin.indexer;

    // ── Live stats block ──────────────────────────────────────
    const statsBlock = el.createDiv({ cls: "tacit-settings-stats" });

    if (indexer) {
      // Status row: dot · label · detail (right-aligned)
      const statusRow = statsBlock.createDiv({ cls: "tacit-index-status-row" });
      const statusDot   = statusRow.createSpan({ cls: "tacit-index-dot" });
      const statusLabel = statusRow.createSpan({ cls: "tacit-index-status-label" });
      const statusDetail = statusRow.createSpan({ cls: "tacit-index-status-detail" });

      // Thin progress bar — shown only while indexing
      const barWrap = statsBlock.createDiv({ cls: "tacit-index-bar-wrap" });
      barWrap.style.display = "none";
      const barFill = barWrap.createDiv({ cls: "tacit-index-bar-fill" });

      // Stat rows
      const notesRow   = statsBlock.createDiv({ cls: "tacit-settings-stats-row" });
      const chunksRow  = statsBlock.createDiv({ cls: "tacit-settings-stats-row" });
      const failedRow  = statsBlock.createDiv({ cls: "tacit-settings-stats-row" });
      const updatedRow = statsBlock.createDiv({ cls: "tacit-settings-stats-row" });
      const modelRow   = statsBlock.createDiv({ cls: "tacit-settings-stats-row" });

      // Action buttons
      const actionsRow = statsBlock.createDiv({ cls: "tacit-stats-actions" });
      const stopBtn    = actionsRow.createEl("button", { text: "停止索引" });
      const rebuildBtn = actionsRow.createEl("button", { text: "重建索引" });
      const retryBtn   = actionsRow.createEl("button", { text: "重试失败" });

      stopBtn.style.display = "none";
      stopBtn.addEventListener("click",    () => { this.plugin.indexer?.stopIndexing(); });
      rebuildBtn.addEventListener("click", () => { this.plugin.indexer?.rebuildAll(); });
      retryBtn.addEventListener("click",   () => { this.plugin.indexer?.retryFailed(); });

      // Failed files section (outside the gray block)
      const failedWrap  = el.createDiv({ cls: "tacit-failed-wrap" });
      failedWrap.style.display = "none";
      const failedLabel = failedWrap.createDiv({ cls: "tacit-failed-label" });
      const listEl      = failedWrap.createEl("ul", { cls: "tacit-failed-list" });
      let lastFailedCount = -1;

      // ── Live update loop ──────────────────────────────────────
      const update = () => {
        const p = indexer.getProgress();

        // Status dot + label + detail
        if (p.isIndexing) {
          statusDot.className = "tacit-index-dot is-indexing";
          statusLabel.textContent = "索引中";
          statusDetail.textContent = p.filesTotal > 0
            ? `${p.filesDone} / ${p.filesTotal} 个文件`
            : "准备中…";
        } else if (p.total === 0) {
          statusDot.className = "tacit-index-dot";
          statusLabel.textContent = "未索引";
          statusDetail.textContent = "";
        } else if (p.failed > 0) {
          statusDot.className = "tacit-index-dot is-warning";
          statusLabel.textContent = "有失败项";
          statusDetail.textContent = `${p.failed} 个文本块未能嵌入`;
        } else {
          statusDot.className = "tacit-index-dot is-done";
          statusLabel.textContent = "已就绪";
          statusDetail.textContent = "";
        }

        // Progress bar
        if (p.isIndexing && p.filesTotal > 0) {
          barWrap.style.display = "block";
          barFill.style.width = `${Math.round((p.filesDone / p.filesTotal) * 100)}%`;
        } else {
          barWrap.style.display = "none";
        }

        // Stats rows
        notesRow.innerHTML  = `<span>笔记</span><span>${p.notes.toLocaleString()}</span>`;
        if (p.isIndexing && p.total > 0) {
          chunksRow.innerHTML = `<span>文本块</span><span>${p.done.toLocaleString()} / ${p.total.toLocaleString()}</span>`;
        } else {
          chunksRow.innerHTML = `<span>文本块</span><span>${p.total.toLocaleString()}</span>`;
        }
        const fc = p.failed > 0 ? "var(--color-red)" : "inherit";
        failedRow.innerHTML  = `<span>失败</span><span style="color:${fc}">${p.failed}</span>`;
        updatedRow.innerHTML = `<span>最后更新</span><span>${p.lastUpdated ?? "—"}</span>`;

        // Stop button — only visible while indexing
        if (p.isIndexing) {
          stopBtn.style.display = "";
          stopBtn.disabled = p.isStopping;
          stopBtn.textContent = p.isStopping ? "停止中…" : "停止索引";
        } else {
          stopBtn.style.display = "none";
        }
        rebuildBtn.disabled = p.isIndexing;
        retryBtn.disabled   = p.isIndexing || p.failed === 0;

        // Model label
        const ms = this.plugin.settings;
        const modelLabels: Record<string, string> = {
          ollama:        `Ollama · ${ms.ollamaModel || "（未选择）"}`,
          openai:        `OpenAI · ${ms.openaiModel || "—"}`,
          openrouter:    `OpenRouter · ${ms.openrouterModel || "—"}`,
          gemini:        `Gemini · ${ms.geminiModel || "—"}`,
          "openai-compat": `兼容 · ${ms.compatModel || "—"}`,
        };
        modelRow.innerHTML = `<span>向量模型</span><span>${modelLabels[ms.provider] ?? ms.provider}</span>`;

        // Failed files list — rebuild only when count changes
        const failedFiles = p.failed > 0 ? indexer.getFailedFiles() : [];
        if (failedFiles.length !== lastFailedCount) {
          lastFailedCount = failedFiles.length;
          failedWrap.style.display = failedFiles.length > 0 ? "block" : "none";
          listEl.empty();
          for (const f of failedFiles) {
            listEl.createEl("li").createEl("code", { text: f, cls: "tacit-failed-file" });
          }
          if (failedFiles.length > 0) {
            failedLabel.textContent = `以下 ${failedFiles.length} 个文件处理失败：`;
          }
        }
      };

      update(); // initial paint

      // Poll at 600 ms; self-clean when el is detached from DOM
      const interval = setInterval(() => {
        if (!el.isConnected) { clearInterval(interval); return; }
        update();
      }, 600);

    } else {
      statsBlock.textContent = "索引尚未初始化";
    }

    el.createEl("h2", { text: "排除" });

    new Setting(el)
      .setName("排除文件夹")
      .setDesc("逗号分隔，例如：Templates, Attachments")
      .addText(t => t
        .setValue(s.excludeFolders.join(", "))
        .onChange(async v => {
          s.excludeFolders = v.split(",").map(x => x.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        })
      );

    // ── Live indexing ─────────────────────────────────────────
    new Setting(el)
      .setName("编辑时自动更新索引")
      .setDesc("开启后，编辑笔记时会自动触发索引更新。默认关闭，仅在重启 Obsidian 时检查新内容。")
      .addToggle(t => t.setValue(s.liveIndexing).onChange(async v => {
        s.liveIndexing = v;
        await this.plugin.saveSettings();
        this.display();
      }));

    if (s.liveIndexing) {
      new Setting(el)
        .setName("最低字数阈值")
        .setDesc("笔记字数低于此值时不触发索引，避免对草稿频繁请求。")
        .addSlider(sl => sl
          .setLimits(0, 2000, 50)
          .setValue(s.liveIndexingMinChars)
          .onChange(async v => { s.liveIndexingMinChars = v; await this.plugin.saveSettings(); })
          .setDynamicTooltip()
        );
    }

    // Advanced settings — collapsible with prominent heading
    const advDetails = el.createEl("details", { cls: "tacit-adv-details" });
    advDetails.createEl("summary", { cls: "tacit-adv-summary", text: "高级设置" });
    const advEl = advDetails.createDiv({ cls: "tacit-adv-body" });

    new Setting(advEl)
      .setName("分块大小（字符数）")
      .setDesc("中文建议 400-600；英文可调高至 1000+")
      .addSlider(sl => sl.setLimits(100, 1200, 50).setValue(s.chunkSize).onChange(async v => {
        s.chunkSize = v; await this.plugin.saveSettings();
      }).setDynamicTooltip());

    new Setting(advEl)
      .setName("分块重叠（字符数）")
      .addSlider(sl => sl.setLimits(0, 400, 20).setValue(s.chunkOverlap).onChange(async v => {
        s.chunkOverlap = v; await this.plugin.saveSettings();
      }).setDynamicTooltip());

    new Setting(advEl)
      .setName("并发数")
      .setDesc("同时发送的嵌入请求数（Ollama 建议 3，云端建议 8）")
      .addSlider(sl => sl.setLimits(1, 16, 1).setValue(s.concurrency).onChange(async v => {
        s.concurrency = v; await this.plugin.saveSettings();
      }).setDynamicTooltip());

    new Setting(advEl)
      .setName("将索引存储在 Vault 内")
      .setDesc("存储在 Vault 的 .tacit/ 目录，方便跨设备同步（默认开启）。切换时已有索引文件会自动迁移，无需重新索引。关闭后索引存在插件目录，删除插件时会一并清理。")
      .addToggle(t => t.setValue(s.storageInVault).onChange(async v => {
        try {
          const moved = await this.plugin.indexer?.migrateIndexStorage(v);
          if (moved) new Notice("Tacit：索引文件已迁移，无需重新索引。");
        } catch (e) {
          new Notice("Tacit：迁移索引文件时出错，下次启动时将自动重建。");
        }
        s.storageInVault = v;
        await this.plugin.saveSettings();
      }));
  }

  private renderRelatedSection(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("显示结果数量")
      .addSlider(sl => sl.setLimits(3, 20, 1).setValue(s.resultCount).onChange(async v => {
        s.resultCount = v; await this.plugin.saveSettings();
      }).setDynamicTooltip());

    new Setting(el)
      .setName("默认开启偶然性模式")
      .setDesc("浮现更旧、更意想不到的连接")
      .addToggle(t => t.setValue(s.serendipityDefault).onChange(async v => {
        s.serendipityDefault = v; await this.plugin.saveSettings();
      }));

    new Setting(el)
      .setName("悬停时显示相似度数值")
      .setDesc("默认只显示纹理条，开启后悬停可见具体数字")
      .addToggle(t => t.setValue(s.showScoreNumbers).onChange(async v => {
        s.showScoreNumbers = v; await this.plugin.saveSettings();
      }));

    new Setting(el)
      .setName("切换笔记时自动更新")
      .addToggle(t => t.setValue(s.autoUpdate).onChange(async v => {
        s.autoUpdate = v; await this.plugin.saveSettings();
      }));
  }

  private renderFindSection(el: HTMLElement) {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("默认模式")
      .addDropdown(d => d
        .addOption("retrieval", "检索（无 LLM，即时）")
        .addOption("synthesis", "AI 问答（需要对话模型）")
        .setValue(s.findDefaultMode)
        .onChange(async v => { s.findDefaultMode = v as "retrieval" | "synthesis"; await this.plugin.saveSettings(); })
      );

    new Setting(el)
      .setName("AI 问答 Provider")
      .setDesc("用于生成回答的对话服务，可与向量嵌入使用不同的 Provider")
      .addDropdown(d => d
        .addOption("ollama", "Ollama（本地）")
        .addOption("openai", "OpenAI")
        .addOption("openrouter", "OpenRouter")
        .addOption("gemini", "Gemini")
        .addOption("openai-compat", "通用 OpenAI 兼容")
        .setValue(s.findChatProvider)
        .onChange(async v => {
          s.findChatProvider = v as ProviderType;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    const chatPlaceholders: Record<string, string> = {
      ollama:          "例如：qwen2.5",
      openai:          "例如：gpt-4o-mini",
      openrouter:      "例如：anthropic/claude-haiku-4-5",
      gemini:          "例如：gemini-2.0-flash",
      "openai-compat": "例如：your-model-name",
    };

    new Setting(el)
      .setName("AI 问答模型")
      .setDesc("对话模型名称（与向量嵌入模型是独立配置，可以不同）")
      .addText(t => t
        .setPlaceholder(chatPlaceholders[s.findChatProvider] ?? "模型名称")
        .setValue(s.findChatModel)
        .onChange(async v => { s.findChatModel = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(el)
      .setName("最多返回笔记数")
      .addSlider(sl => sl.setLimits(3, 20, 1).setValue(s.findTopK).onChange(async v => {
        s.findTopK = v; await this.plugin.saveSettings();
      }).setDynamicTooltip());
  }

  private renderPrivacySection(el: HTMLElement) {
    const notice = el.createDiv({ cls: "tacit-settings-stats" });
    notice.innerHTML = `
      <p>🔒 <strong>本地 Ollama：</strong>所有处理在你的设备上完成，笔记内容不会发送给任何服务。</p>
      <p>☁️ <strong>云端 Provider（OpenAI / Gemini 等）：</strong>笔记文本会发送给对应服务以生成向量。请遵守该服务的隐私条款。</p>
      <p>🔑 <strong>API Key 存储：</strong>Key 以明文存储在插件数据文件中（Obsidian 不加密插件配置）。请确保你的设备安全。</p>
    `;
  }
}
