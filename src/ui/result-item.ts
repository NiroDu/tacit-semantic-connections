import { App } from "obsidian";
import type TacitPlugin from "../main";
import type { SearchResult } from "../index/store";

const FIRST_DRAG_KEY = "tacit-shown-drag-tip";

export class ResultItem {
  private container: HTMLElement;
  private result: SearchResult;
  private plugin: TacitPlugin;
  private serendipity: boolean;

  constructor(
    container: HTMLElement,
    result: SearchResult,
    plugin: TacitPlugin,
    serendipity: boolean
  ) {
    this.container = container;
    this.result = result;
    this.plugin = plugin;
    this.serendipity = serendipity;
  }

  render(): HTMLElement {
    const { record, score, isLongLost } = this.result;
    const showNumbers = this.plugin.settings.showScoreNumbers;

    const item = this.container.createDiv({ cls: "tacit-result-item" });

    // ── Title row ────────────────────────────────────────
    const titleRow = item.createDiv({ cls: "tacit-item-title-row" });
    const titleEl = titleRow.createDiv({ cls: "tacit-item-title", text: record.title });

    // Relatedness bar — 3-step fill
    const bar = titleRow.createDiv({ cls: "tacit-score-bar" });
    const steps = this.scoreToSteps(score);
    for (let i = 0; i < 3; i++) {
      const dot = bar.createDiv({ cls: "tacit-score-dot" });
      if (i < steps) {
        dot.addClass(steps === 3 ? "filled-high" : "filled");
      }
    }

    // Score number (hidden by default, show on hover if enabled)
    if (showNumbers) {
      titleRow.createDiv({
        cls: "tacit-score-num",
        text: (score * 100).toFixed(1) + "%"
      });
    }

    // ── Meta row ──────────────────────────────────────────
    const meta = item.createDiv({ cls: "tacit-item-meta" });

    // Relative time
    meta.createSpan({ text: this.relativeTime(record.mtime) });

    // Source badge
    if (record.sourceType === "canvas") {
      const badge = meta.createSpan({ cls: "tacit-item-badge badge-canvas" });
      badge.textContent = "canvas";
    }

    // Long-lost tag
    if (isLongLost && this.serendipity) {
      item.createDiv({ cls: "tacit-lost-tag", text: "↺ 久遗" });
    }

    // ── Snippet ───────────────────────────────────────────
    const snippet = item.createDiv({ cls: "tacit-item-snippet" });
    snippet.innerHTML = this.highlightSnippet(record.snippet);

    // ── Interactions ──────────────────────────────────────

    // Hover: Obsidian page preview
    item.addEventListener("mouseover", (e) => {
      const targetEl = item;
      this.plugin.app.workspace.trigger("hover-link", {
        event: e,
        source: "tacit",
        hoverParent: this.plugin,
        targetEl,
        linktext: record.source,
      });
    });

    // Click: open file
    item.addEventListener("click", (e) => {
      const file = this.plugin.app.vault.getAbstractFileByPath(record.source);
      if (!file) return;
      if (e.metaKey || e.ctrlKey) {
        this.plugin.app.workspace.openLinkText(record.source, "", true);
      } else {
        this.plugin.app.workspace.openLinkText(record.source, "");
      }
    });

    // Drag: insert [[link]]
    item.draggable = true;
    item.addEventListener("dragstart", (e) => {
      const linkText = `[[${record.title}]]`;
      e.dataTransfer?.setData("text/plain", linkText);
      item.addClass("is-dragging");

      // First-use tip
      if (!localStorage.getItem(FIRST_DRAG_KEY)) {
        localStorage.setItem(FIRST_DRAG_KEY, "1");
        const NoticeClass = (this.plugin.app as any).Notice;
        if (NoticeClass) new NoticeClass("提示：将连接拖入笔记即可创建链接");
      }
    });

    item.addEventListener("dragend", () => {
      item.removeClass("is-dragging");
      // Subtle landing highlight
      item.addClass("tacit-drop-land");
      setTimeout(() => item.removeClass("tacit-drop-land"), 300);
    });

    // Context menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // Use Obsidian's Menu via require (available in Electron context)
      const obsidianModule = (window as any).require?.("obsidian") ?? {};
      const { Menu } = obsidianModule;
      if (!Menu) return;
      const m = new Menu();
      m.addItem((i: any) => i.setTitle("在新窗格中打开").setIcon("external-link").onClick(() => {
        this.plugin.app.workspace.openLinkText(record.source, "", true);
      }));
      m.addItem((i: any) => i.setTitle("复制链接").setIcon("copy").onClick(() => {
        navigator.clipboard.writeText(`[[${record.title}]]`);
      }));
      m.showAtMouseEvent(e);
    });

    return item;
  }

  private scoreToSteps(score: number): number {
    if (score > 0.8) return 3;
    if (score > 0.6) return 2;
    return 1;
  }

  private relativeTime(mtime: number): string {
    const now = Date.now();
    const diff = now - mtime;
    const sec = diff / 1000;
    const min = sec / 60;
    const hr = min / 60;
    const day = hr / 24;
    const yr = day / 365;

    if (yr >= 1) return `${Math.floor(yr)} 年前写`;
    if (day >= 30) return `${Math.floor(day / 30)} 个月前写`;
    if (day >= 1) return `${Math.floor(day)} 天前写`;
    if (hr >= 1) return `${Math.floor(hr)} 小时前写`;
    return "刚刚写";
  }

  private highlightSnippet(snippet: string): string {
    let s = snippet;

    // Strip YAML front matter
    s = s.replace(/^---[\s\S]*?---\s*/, "");

    // Strip HTML: orphaned fragment at chunk boundary, then full tags, then entities
    s = s.replace(/^[^<>]*>+/, "");
    s = s.replace(/<[^>]+>/g, " ");
    s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"').replace(/&#\d+;/g, "");

    // Strip markdown syntax
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");              // images
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");     // [[target|alias]] → alias
    s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");                 // [[link]] → link
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");            // [text](url) → text
    s = s.replace(/```[\s\S]*?```/g, "");                     // fenced code blocks
    s = s.replace(/`([^`]+)`/g, "$1");                        // inline code
    s = s.replace(/^#{1,6}\s+/gm, "");                        // headings
    s = s.replace(/\*\*([^*]+)\*\*/g, "$1");                  // bold
    s = s.replace(/\*([^*\n]+)\*/g, "$1");                    // italic *
    s = s.replace(/_([^_\n]+)_/g, "$1");                      // italic _
    s = s.replace(/~~([^~]+)~~/g, "$1");                      // strikethrough
    s = s.replace(/^[>+\-*]\s+/gm, "");                       // blockquote / list markers
    s = s.replace(/^\d+\.\s+/gm, "");                         // numbered list

    // Collapse whitespace
    s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    // Safely escape for innerHTML
    const escaped = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return escaped.length > 300 ? escaped.slice(0, 300) + "…" : escaped;
  }
}
