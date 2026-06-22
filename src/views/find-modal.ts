import { App, Modal } from "obsidian";
import type TacitPlugin from "../main";
import { ResultItem } from "../ui/result-item";
import type { SearchResult } from "../index/store";
import { normalize } from "../util/vec";

const RECENT_QUERIES_KEY = "tacit-recent-queries";
const MAX_RECENT = 8;

export class FindModal extends Modal {
  private plugin: TacitPlugin;
  private mode: "retrieval" | "synthesis";
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private synthesisEl: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private recentQueries: string[];

  constructor(app: App, plugin: TacitPlugin) {
    super(app);
    this.plugin = plugin;
    this.mode = plugin.settings.findDefaultMode;
    this.recentQueries = this.loadRecent();
  }

  onOpen() {
    const { modalEl } = this;
    modalEl.addClass("tacit-find-modal");
    modalEl.style.width = "640px";
    modalEl.style.maxWidth = "90vw";

    const content = this.contentEl;
    content.empty();
    content.style.padding = "0";

    // ── Input row ─────────────────────────────────────────
    const inputWrap = content.createDiv({ cls: "tacit-find-input-wrap" });
    const searchIcon = inputWrap.createSpan();
    searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

    this.inputEl = inputWrap.createEl("input", {
      cls: "tacit-find-input",
      attr: { placeholder: "提问，找回你写过的内容", autofocus: "true" },
    });

    // ── Mode toggle (segmented control) ──────────────────
    const modeRow = content.createDiv({ cls: "tacit-find-mode-toggle" });
    const seg = modeRow.createDiv({ cls: "tacit-mode-seg" });
    const retrievalBtn = seg.createEl("button", { cls: "tacit-mode-btn", text: "检索模式" });
    const synthesisBtn = seg.createEl("button", { cls: "tacit-mode-btn", text: "AI 问答模式" });

    const updateMode = (m: "retrieval" | "synthesis") => {
      if (this.mode === m) return;
      this.mode = m;
      retrievalBtn.classList.toggle("is-active", m === "retrieval");
      synthesisBtn.classList.toggle("is-active", m === "synthesis");
      // Re-run with existing query when switching modes
      const q = this.inputEl.value.trim();
      if (q) this.search(q);
    };
    retrievalBtn.classList.toggle("is-active", this.mode === "retrieval");
    synthesisBtn.classList.toggle("is-active", this.mode === "synthesis");

    retrievalBtn.addEventListener("click", () => updateMode("retrieval"));
    synthesisBtn.addEventListener("click", () => updateMode("synthesis"));

    // ── Stats line ────────────────────────────────────────
    this.statsEl = content.createDiv({ cls: "tacit-find-stats" });

    // ── Results ───────────────────────────────────────────
    this.resultsEl = content.createDiv({ cls: "tacit-find-results" });

    // Show recent queries on empty
    this.showRecent();

    // Input handler — retrieval mode auto-searches on debounce; AI 问答 waits for Enter
    this.inputEl.addEventListener("input", () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      const q = this.inputEl.value.trim();
      if (!q) {
        this.showRecent();
        return;
      }
      if (this.mode === "retrieval") {
        this.debounceTimer = setTimeout(() => this.search(q), 250);
      }
    });

    // Keyboard navigation
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { this.close(); return; }
      if (e.key === "ArrowDown") { this.focusResult(0); return; }
      if (e.key === "Enter") {
        const q = this.inputEl.value.trim();
        if (q) { if (this.debounceTimer) clearTimeout(this.debounceTimer); this.search(q); }
        return;
      }
    });

    this.inputEl.focus();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async search(query: string) {
    const t0 = performance.now();

    if (!this.plugin.indexer || this.plugin.settings.provider === "ollama" && !this.plugin.settings.ollamaModel) {
      this.statsEl.textContent = "索引未就绪，请等待索引完成";
      return;
    }

    this.statsEl.textContent = "搜索中…";
    this.resultsEl.empty();

    try {
      const { createProvider } = await import("../providers/factory");
      const provider = createProvider(this.plugin.settings);
      const vectors = await provider.embed([query]);
      const qVec = normalize(vectors[0]);

      const fp = (this.plugin.indexer as any).fingerprint as string;
      const k = this.plugin.settings.findTopK;

      const results = (this.plugin.indexer as any).store.search(qVec, k, {
        fingerprint: fp,
        serendipity: false,
      }) as SearchResult[];

      const elapsed = Math.round(performance.now() - t0);
      this.statsEl.textContent = `找到 ${results.length} 条相关结果，用时 ${elapsed}ms`;

      this.resultsEl.empty();

      if (results.length === 0) {
        this.resultsEl.createDiv({
          cls: "tacit-state-msg",
          text: "你的笔记中暂无此内容的记录。",
        });
        return;
      }

      if (this.mode === "retrieval") {
        for (const r of results) {
          const item = new ResultItem(this.resultsEl, r, this.plugin, false);
          item.render();
        }
      } else {
        // Synthesis mode
        await this.runSynthesis(query, results);
      }

      this.saveRecent(query);
    } catch (e) {
      this.statsEl.textContent = `错误：${(e as Error).message}`;
    }
  }

  private async runSynthesis(query: string, sources: SearchResult[]) {
    const synthesisWrap = this.resultsEl.createDiv({ cls: "tacit-synthesis-wrap" });
    synthesisWrap.createDiv({
      cls: "tacit-synthesis-prefix",
      text: "根据你写过的内容：",
    });
    const outputEl = synthesisWrap.createDiv({ cls: "tacit-synthesis-output" });
    outputEl.textContent = "正在生成…";

    // Build context from note snippets
    const context = sources
      .slice(0, 5)
      .map(r => `[[${r.record.title}]]：${r.record.snippet}`)
      .join("\n\n");

    const systemPrompt = `你是一个帮助用户回忆自己笔记内容的助手。
仅使用下方提供的笔记内容来回答问题。
直接用流畅的语言回答，不要在回复中插入任何引用标注或链接符号。
不要引入笔记以外的任何信息。
如果笔记内容不足以回答，请直接说"你的笔记中暂无此内容的记录。"

笔记内容：
${context}`;

    try {
      const { chatCompletion } = await import("../providers/chat");
      const text = await chatCompletion(this.plugin.settings, [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ]);
      outputEl.textContent = (text || "未收到回复").replace(/\[\[([^\]]+)\]\]/g, "");
    } catch (e) {
      outputEl.textContent = `AI 问答失败：${(e as Error).message}`;
    }

    // Always show source notes below
    const sourcesDiv = synthesisWrap.createDiv({ cls: "tacit-synthesis-sources" });
    sourcesDiv.createDiv({ cls: "tacit-synthesis-sources-label", text: "来源笔记：" });
    for (const r of sources.slice(0, 5)) {
      const item = new ResultItem(sourcesDiv, r, this.plugin, false);
      item.render();
    }
  }

  private showRecent() {
    this.resultsEl.empty();
    this.statsEl.textContent = this.recentQueries.length > 0
      ? "最近搜索："
      : "提问，找回你写过的内容";

    for (const q of this.recentQueries) {
      const el = this.resultsEl.createDiv({
        cls: "tacit-result-item",
        text: q,
      });
      el.style.color = "var(--text-muted)";
      el.style.fontSize = "var(--font-small)";
      el.addEventListener("click", () => {
        this.inputEl.value = q;
        this.search(q);
      });
    }
  }

  private focusResult(idx: number) {
    const items = this.resultsEl.querySelectorAll<HTMLElement>(".tacit-result-item");
    items[idx]?.focus();
  }

  private loadRecent(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY) ?? "[]");
    } catch { return []; }
  }

  private saveRecent(query: string) {
    const updated = [query, ...this.recentQueries.filter(q => q !== query)].slice(0, MAX_RECENT);
    this.recentQueries = updated;
    localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(updated));
  }
}
