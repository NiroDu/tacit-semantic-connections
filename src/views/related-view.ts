import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type TacitPlugin from "../main";
import { ResultItem } from "../ui/result-item";
import type { SearchResult } from "../index/store";

export const RELATED_VIEW_TYPE = "tacit-related";

export class RelatedView extends ItemView {
  plugin: TacitPlugin;
  private serendipity: boolean;
  private pinned: boolean;
  private currentFile: TFile | null = null;

  // DOM refs
  private titleEl!: HTMLElement;
  private listEl!: HTMLElement;
  private progressBarFill!: HTMLElement;
  private stateEl!: HTMLElement;
  private pinBtn!: HTMLButtonElement;
  private serendipityBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: TacitPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.serendipity = plugin.settings.serendipityDefault;
    this.pinned = false;
  }

  getViewType() { return RELATED_VIEW_TYPE; }
  getDisplayText() { return "相关笔记"; }
  getIcon() { return "brain"; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("tacit-related-view");

    // ── Toolbar ──────────────────────────────────────────
    const toolbar = container.createDiv({ cls: "tacit-toolbar" });
    this.titleEl = toolbar.createDiv({ cls: "tacit-toolbar-title", text: "连接" });

    // Search button — opens Find modal
    const searchBtn = toolbar.createEl("button", { cls: "tacit-toolbar-btn" });
    searchBtn.title = "语义搜索（主动查找）";
    searchBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    searchBtn.addEventListener("click", () => this.plugin.openFind());

    // Pin/pause button
    this.pinBtn = toolbar.createEl("button", { cls: "tacit-toolbar-btn" });
    this.pinBtn.title = "固定（不随笔记切换而刷新）";
    this.pinBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
    this.pinBtn.addEventListener("click", () => {
      this.pinned = !this.pinned;
      this.pinBtn.classList.toggle("is-active", this.pinned);
    });

    // Serendipity toggle
    this.serendipityBtn = toolbar.createEl("button", { cls: "tacit-toolbar-btn" });
    this.serendipityBtn.title = "偶然性：浮现更旧、更意想不到的连接";
    this.serendipityBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7-.7.7M9 16a5 5 0 1 1 6 0 3.5 3.5 0 0 0-1 3 2 2 0 0 1-4 0 3.5 3.5 0 0 0-1-3"/><path d="M9.7 17H14.3"/></svg>`;
    this.serendipityBtn.classList.toggle("is-active", this.serendipity);
    this.serendipityBtn.addEventListener("click", () => {
      this.serendipity = !this.serendipity;
      this.serendipityBtn.classList.toggle("is-active", this.serendipity);
      this.refresh(true);
    });

    // Refresh button
    const refreshBtn = toolbar.createEl("button", { cls: "tacit-toolbar-btn" });
    refreshBtn.title = "刷新";
    refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
    refreshBtn.addEventListener("click", () => this.refresh(true));

    // Settings gear
    const gearBtn = toolbar.createEl("button", { cls: "tacit-toolbar-btn" });
    gearBtn.title = "设置";
    gearBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
    gearBtn.addEventListener("click", () => {
      (this.plugin.app as any).setting?.open();
      (this.plugin.app as any).setting?.openTabById("tacit");
    });

    // ── Progress bar (thin line below toolbar) ────────────
    const progressWrap = container.createDiv({ cls: "tacit-progress-bar-wrap" });
    progressWrap.style.display = "none";
    this.progressBarFill = progressWrap.createDiv({ cls: "tacit-progress-bar-fill" });
    this.progressBarFill.style.width = "0%";

    // ── State message (indexing / empty / error) ───────────
    this.stateEl = container.createDiv({ cls: "tacit-state-msg" });
    this.stateEl.style.display = "none";

    // ── Result list ────────────────────────────────────────
    this.listEl = container.createDiv({ cls: "tacit-result-list" });

    // ── Listen for file changes ────────────────────────────
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.pinned && this.plugin.settings.autoUpdate) {
          this.scheduleRefresh();
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!this.pinned && this.plugin.settings.autoUpdate) {
          this.scheduleRefresh();
        }
      })
    );

    // Initial render
    this.scheduleRefresh();
  }

  async onClose() {
    // nothing
  }

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 300);
  }

  async refresh(force = false) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.showState("empty", "打开一个笔记，相关连接会出现在这里。");
      return;
    }
    // Skip if same file is active — only refresh on actual file switch (unless forced)
    if (!force && this.currentFile?.path === file.path) return;
    this.currentFile = file;
    this.titleEl.textContent = file.basename;

    // If indexer is still building, show partial + progress
    const progress = this.plugin.indexer?.getProgress();
    if (progress && progress.isIndexing) {
      this.showProgress(progress.done, progress.total);
    }

    try {
      const results = await this.plugin.indexer?.query(file, {
        k: this.plugin.settings.resultCount,
        serendipity: this.serendipity,
      });

      if (!results || results.length === 0) {
        this.showState("empty", "还没有明确的连接，继续写作吧！");
        return;
      }

      this.hideState();
      this.renderResults(results);
    } catch (e) {
      this.showState("error", `连接暂时不可用 — ${(e as Error).message}`);
    }
  }

  private renderResults(results: SearchResult[]) {
    this.listEl.empty();
    for (let i = 0; i < results.length; i++) {
      const item = new ResultItem(this.listEl, results[i], this.plugin, this.serendipity);
      const el = item.render();
      el.style.setProperty("--tacit-i", String(i));
    }
  }

  private showProgress(done: number, total: number) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const progressWrap = this.containerEl.querySelector<HTMLElement>(".tacit-progress-bar-wrap");
    if (progressWrap) {
      progressWrap.style.display = "block";
      this.progressBarFill.style.width = `${pct}%`;
    }
    // Show inline message but don't block results
  }

  private showState(type: "empty" | "error" | "indexing", msg: string) {
    this.listEl.empty();
    this.stateEl.style.display = "block";
    this.stateEl.empty();
    this.stateEl.textContent = msg;

    if (type === "error") {
      const retryBtn = this.stateEl.createEl("button", { text: "重试", cls: "tacit-retry-btn" });
      retryBtn.addEventListener("click", () => this.refresh());
    }
  }

  private hideState() {
    this.stateEl.style.display = "none";
    const progressWrap = this.containerEl.querySelector<HTMLElement>(".tacit-progress-bar-wrap");
    if (progressWrap) progressWrap.style.display = "none";
  }

  /** Called by indexer when progress changes */
  onIndexProgress(done: number, total: number) {
    this.showProgress(done, total);
  }
}
