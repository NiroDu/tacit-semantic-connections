import type TacitPlugin from "../main";

export class StatusBar {
  private el: HTMLElement;
  private plugin: TacitPlugin;

  constructor(el: HTMLElement, plugin: TacitPlugin) {
    this.el = el;
    this.plugin = plugin;
    this.el.addClass("tacit-status-bar");
    this.el.title = "点击打开 Tacit 设置";
    this.el.addEventListener("click", () => {
      (this.plugin.app as any).setting?.open();
      (this.plugin.app as any).setting?.openTabById("tacit");
    });
    this.setIdle();
  }

  setIdle() {
    this.el.textContent = "Tacit ✓";
    this.el.title = "点击打开 Tacit 设置";
  }

  /** Phase 1: scanning vault files */
  setScanning(done: number, total: number) {
    this.el.textContent = `Tacit 扫描 ${done}/${total}`;
    this.el.title = `正在扫描笔记 ${done}/${total}`;
  }

  /** Phase 2: embedding */
  setIndexing(done: number, total: number) {
    this.el.textContent = `Tacit ⟳ ${done}/${total}`;
    this.el.title = `正在建立向量索引 ${done}/${total}`;
  }

  setDone(total: number) {
    this.el.textContent = `Tacit ✓ ${total}`;
    this.el.title = `已建立 ${total} 个文本块的连接`;
    setTimeout(() => this.setIdle(), 5000);
  }

  setFailed(count: number) {
    this.el.textContent = `Tacit ⚠ ${count} 失败`;
    this.el.title = `${count} 个文本块处理失败，点击打开设置重试`;
  }

  setError(msg: string) {
    this.el.textContent = `Tacit ✕`;
    this.el.title = `错误：${msg}`;
  }
}
