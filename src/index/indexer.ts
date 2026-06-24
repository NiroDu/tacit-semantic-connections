import { App, TFile, TAbstractFile, Notice } from "obsidian";
import type TacitPlugin from "../main";
import type { StatusBar } from "../ui/status";
import { InMemoryVectorStore, BuildState, ChunkState, SearchResult } from "./store";
import { chunkMarkdown } from "./chunker";
import { chunkCanvas } from "./canvas";
import type { Chunk } from "./chunker";
import { currentFingerprint } from "./fingerprint";
import { createProvider } from "../providers/factory";
import type { EmbeddingProvider } from "../providers/types";
import { sleep } from "../util/http";
import { normalize } from "../util/vec";
import { hashStr } from "../util/hash";

// ── Constants ─────────────────────────────────────────────
/** Increment whenever BuildState schema changes — triggers cache wipe */
const BUILD_STATE_VERSION = 2;
/** Files to mtime-compare per idle tick (very cheap, zero I/O) */
const SCAN_BATCH_SIZE = 50;
/** Persist every N files embedded */
const PERSIST_EVERY_N = 15;

// ── Types ─────────────────────────────────────────────────
export interface IndexProgress {
  done: number;
  total: number;
  chunks: number;
  notes: number;
  failed: number;
  isIndexing: boolean;
  isStopping: boolean;
  lastUpdated: string | null;
  filesDone: number;
  filesTotal: number;
  queueLen: number;
}

interface FileQueueEntry {
  filePath: string;
  mtime: number;
}

/** Yield to the browser's idle scheduler; falls back to setTimeout */
function yieldToIdle(timeoutMs = 300): Promise<void> {
  return new Promise(resolve => {
    if (typeof (window as any).requestIdleCallback === "function") {
      (window as any).requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 16);
    }
  });
}

// ── Indexer ───────────────────────────────────────────────
export class Indexer {
  private app: App;
  private plugin: TacitPlugin;
  private statusBar: StatusBar;
  private store: InMemoryVectorStore;
  private buildState: BuildState & { version?: number };
  private provider: EmbeddingProvider | null = null;
  private fingerprint = "";
  private isRunning = false;
  private isStopping = false;
  private stopped = false;
  private lastUpdated: string | null = null;

  private fileQueue: FileQueueEntry[] = [];
  private modifyTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private progressNotice: Notice | null = null;
  private persistCounter = 0;
  // Cached progress counters — updated incrementally (no full-scan per file)
  private countDone = 0;
  private countTotal = 0;
  private countFailed = 0;
  /** Tracks how many files from the current queue have been processed */
  private filesDone = 0;
  private filesTotal = 0;
  /** Number of currently active concurrent workers */
  private activeWorkers = 0;

  constructor(app: App, plugin: TacitPlugin, statusBar: StatusBar) {
    this.app = app;
    this.plugin = plugin;
    this.statusBar = statusBar;
    this.store = new InMemoryVectorStore();
    this.buildState = { fingerprint: "", files: {}, version: BUILD_STATE_VERSION };
  }

  async init() {
    await this.loadPersistedIndex();

    this.plugin.registerEvent(this.app.vault.on("modify", f => this.onFileChange(f)));
    this.plugin.registerEvent(this.app.vault.on("create", f => this.onFileChange(f)));
    this.plugin.registerEvent(this.app.vault.on("delete", f => this.onFileDelete(f)));
    this.plugin.registerEvent(this.app.vault.on("rename", (f, o) => this.onFileRename(f, o)));

    // Delay startup scan — let Obsidian fully settle first
    setTimeout(() => { if (!this.stopped) this.reconcileAndRun(); }, 5000);
  }

  dispose() {
    this.stopped = true;
    this.isRunning = false;
    this.activeWorkers = 0;
    this.progressNotice?.hide();
    this.progressNotice = null;
    for (const t of this.modifyTimers.values()) clearTimeout(t);
    this.fileQueue = [];
  }

  // ── Public API ────────────────────────────────────────────

  async query(file: TFile, opts: { k: number; serendipity: boolean }): Promise<SearchResult[]> {
    if (this.store.size() === 0) return [];
    const fp = this.fingerprint;
    let queryVec = this.store.meanVector(file.path, fp);

    if (!queryVec && this.provider) {
      try {
        const content = await this.app.vault.cachedRead(file);
        const vecs = await this.provider.embed([content.slice(0, 600)]);
        queryVec = normalize(vecs[0]);
      } catch { return []; }
    }
    if (!queryVec) return [];

    return this.store.search(queryVec, opts.k, {
      fingerprint: fp,
      excludeSource: file.path,
      serendipity: opts.serendipity,
    });
  }

  async rebuildAll() {
    this.isRunning = false;
    this.activeWorkers = 0;
    this.fileQueue = [];
    await sleep(200);

    // Clear persisted index files
    await this.clearPersistedIndex();

    this.buildState = { fingerprint: this.fingerprint, files: {}, version: BUILD_STATE_VERSION };
    this.store = new InMemoryVectorStore();
    this.countDone = 0;
    this.countTotal = 0;
    this.countFailed = 0;
    this.filesDone = 0;
    this.filesTotal = 0;

    await this.reconcileAndRun(true);
  }

  async retryFailed() {
    const filesToRetry = new Set<string>();
    for (const [filePath, fe] of Object.entries(this.buildState.files)) {
      for (const c of fe.chunks) {
        if (c.state === "error") {
          c.state = "pending";
          c.retries = 0;
          filesToRetry.add(filePath);
        }
      }
    }
    if (filesToRetry.size === 0) {
      new Notice("Tacit：没有失败的文本块需要重试");
      return;
    }
    for (const fp of filesToRetry) {
      const fe = this.buildState.files[fp];
      if (fe) this.fileQueue.push({ filePath: fp, mtime: fe.mtime });
    }
    new Notice(`Tacit：正在重试 ${filesToRetry.size} 个文件…`);
    if (!this.isRunning) this.processFileQueue();
  }

  getProgress(): IndexProgress {
    return {
      done: this.countDone,
      total: this.countTotal,
      chunks: this.countTotal,
      notes: Object.keys(this.buildState.files).length,
      failed: this.countFailed,
      isIndexing: this.isRunning,
      isStopping: this.isStopping,
      lastUpdated: this.lastUpdated,
      filesDone: this.filesDone,
      filesTotal: this.filesTotal,
      queueLen: this.fileQueue.length,
    };
  }

  /** Drain the queue so workers finish their current file then stop. */
  stopIndexing() {
    if (!this.isRunning) return;
    this.fileQueue = [];
    this.isStopping = true;
  }

  /**
   * Copy index files from the old storage location to the new one.
   * Called when the user toggles storageInVault — avoids a full rebuild.
   * Returns true if any files were copied.
   */
  async migrateIndexStorage(toVault: boolean): Promise<boolean> {
    const fromDir = toVault ? ".obsidian/plugins/tacit" : ".tacit";
    const toDir   = toVault ? ".tacit"                  : ".obsidian/plugins/tacit";
    const adapter  = this.app.vault.adapter;
    const files    = ["build-state.json", "index.meta.json", "index.bin"];

    const exists = await Promise.all(files.map(f => adapter.exists(`${fromDir}/${f}`)));
    if (!exists.some(Boolean)) return false;

    if (!await adapter.exists(toDir)) await adapter.mkdir(toDir);

    for (let i = 0; i < files.length; i++) {
      if (!exists[i]) continue;
      const src  = `${fromDir}/${files[i]}`;
      const dest = `${toDir}/${files[i]}`;
      if (files[i] === "index.bin") {
        await adapter.writeBinary(dest, await adapter.readBinary(src));
      } else {
        await adapter.write(dest, await adapter.read(src));
      }
    }
    return true;
  }

  /** File paths that have at least one chunk in error state */
  getFailedFiles(): string[] {
    return Object.entries(this.buildState.files)
      .filter(([, fe]) => fe.chunks.some(c => c.state === "error"))
      .map(([path]) => path);
  }

  // ── Reconcile: mtime-only scan, zero file reads ──────────

  private async reconcileAndRun(forceRebuild = false) {
    if (this.stopped) return;

    // Setup provider
    try {
      this.provider = createProvider(this.plugin.settings);
    } catch (e) {
      this.statusBar.setError("Provider 配置无效");
      new Notice(`Tacit：Provider 配置无效 — ${(e as Error).message}`);
      return;
    }

    // Get fingerprint (1 small test embed if dimensions unknown)
    const testFp = await this.getFingerprint();
    if (!testFp) {
      const hasConfig = this.plugin.settings.ollamaModel || this.plugin.settings.openaiKey;
      if (hasConfig) {
        this.statusBar.setError("无法连接嵌入服务");
        new Notice("Tacit：无法连接嵌入服务，请在设置中检查「测试连接」", 8000);
      }
      return;
    }

    // Model changed → confirm rebuild
    if (!forceRebuild && this.buildState.fingerprint && this.buildState.fingerprint !== testFp) {
      const ok = confirm("Tacit：嵌入模型已变更，需要重建索引。现在重建？");
      if (!ok) return;
      await this.clearPersistedIndex();
      this.buildState = { fingerprint: testFp, files: {}, version: BUILD_STATE_VERSION };
      this.store = new InMemoryVectorStore();
      forceRebuild = true;
    }

    this.fingerprint = testFp;
    this.buildState.fingerprint = testFp;

    // ── Consistency guard: vectors missing despite "done" buildState ──
    // Happens when a previous persist() bug left index.bin unwritten.
    // Detect it early and force a clean rebuild rather than silently serving empty results.
    if (!forceRebuild && this.store.size() === 0) {
      const hasDoneChunks = Object.values(this.buildState.files)
        .some(fe => fe.chunks.some(c => c.state === "done"));
      if (hasDoneChunks) {
        console.info("Tacit: 向量数据丢失但 buildState 显示已完成 — 自动重建索引");
        await this.clearPersistedIndex();
        this.buildState = { fingerprint: testFp, files: {}, version: BUILD_STATE_VERSION };
        this.store = new InMemoryVectorStore();
        this.countDone = 0; this.countTotal = 0; this.countFailed = 0;
        this.filesDone = 0; this.filesTotal = 0;
        forceRebuild = true;
      }
    }

    // ── Phase 1: Scan vault via idle-time batches ─────────────
    // Uses only file.stat.mtime — already in memory, ZERO I/O
    const allFiles = this.app.vault.getFiles().filter(f =>
      (f.extension === "md" || f.extension === "canvas") &&
      !this.isExcluded(f.path)
    );

    const total = allFiles.length;
    this.fileQueue = [];
    // First build (no cached data): show progress notice.
    // Incremental: scan silently — the status bar is enough, no floating notices.
    const isFirstBuild = this.store.size() === 0;
    if (isFirstBuild) {
      this.setProgress(`正在扫描 vault… 0 / ${total}`);
    }
    this.statusBar.setScanning(0, total);

    for (let i = 0; i < total; i++) {
      if (this.stopped) return;

      const file = allFiles[i];
      const existing = this.buildState.files[file.path];
      const mtime = file.stat.mtime;

      if (!forceRebuild && existing && existing.mtime === mtime) {
        // Unchanged — recover any interrupted pending/inflight chunks
        let needsWork = false;
        for (const c of existing.chunks) {
          if (c.state === "inflight") { c.state = "pending"; needsWork = true; }
          if (c.state === "pending") needsWork = true;
        }
        if (needsWork) this.fileQueue.push({ filePath: file.path, mtime });
      } else {
        // New or changed file
        this.fileQueue.push({ filePath: file.path, mtime });
      }

      // Yield every SCAN_BATCH_SIZE files using idle scheduler
      if ((i + 1) % SCAN_BATCH_SIZE === 0) {
        this.statusBar.setScanning(i + 1, total);
        if (isFirstBuild) this.setProgress(`正在扫描 vault… ${i + 1} / ${total}`);
        await yieldToIdle();
      }
    }

    // Remove deleted files
    for (const path of Object.keys(this.buildState.files)) {
      if (!this.app.vault.getAbstractFileByPath(path)) {
        this.store.removeBySource(path);
        delete this.buildState.files[path];
      }
    }

    // Final scan yield before starting queue
    await yieldToIdle();

    if (this.fileQueue.length === 0) {
      this.clearProgress();
      const { done } = this.getProgress();
      this.statusBar.setDone(done);
      // No files changed — cached index is current; refresh views if not already showing
      this.plugin.refreshRelatedViews();
      return;
    }

    if (isFirstBuild) {
      this.setProgress(`扫描完成。开始处理 ${this.fileQueue.length} 个文件…`);
    }
    this.filesTotal = this.fileQueue.length;
    this.filesDone = 0;

    // ── Phase 2: Process file queue with concurrent workers ────
    this.processFileQueue();
  }

  // ── Concurrent file queue: N workers pull from shared queue ──
  // Workers run concurrently (N = settings.concurrency).
  // Each worker is async — the CPU-only work (chunking) is O(n) and
  // bounded; the heavy lifting (embed network call) is async and non-blocking.

  private processFileQueue() {
    if (this.stopped || this.isStopping) return;

    if (this.fileQueue.length === 0) {
      if (this.isRunning && this.activeWorkers === 0) this.finishQueue();
      return;
    }

    if (!this.isRunning) {
      this.isRunning = true;
      this.persistCounter = 0;
      this.activeWorkers = 0;
    }

    const concurrency = Math.max(1, this.plugin.settings.concurrency);
    while (this.activeWorkers < concurrency && this.fileQueue.length > 0) {
      this.spawnWorker();
    }
  }

  /** One worker: pulls files from queue until empty, then exits */
  private spawnWorker() {
    const entry = this.fileQueue.shift();
    if (!entry) return;

    this.activeWorkers++;
    this.statusBar.setIndexing(this.filesDone, this.filesTotal);

    this.processOneFile(entry)
      .catch(e => {
        console.error(`Tacit: processOneFile unhandled — ${entry.filePath}`, e);
      })
      .finally(() => {
        this.activeWorkers--;
        this.filesDone++;
        if (this.stopped) return;

        if (this.fileQueue.length > 0 && !this.isStopping) {
          setTimeout(() => this.spawnWorker(), 0);
        } else if (this.activeWorkers === 0 && this.isRunning) {
          this.isRunning = false;
          if (this.isStopping) {
            // User requested stop — persist partial progress, no completion notice
            this.isStopping = false;
            this.persistIndex();
            this.statusBar.setDone(this.countDone);
          } else {
            this.finishQueue();
          }
        }
      });
  }

  private async processOneFile(entry: FileQueueEntry): Promise<void> {
    if (this.stopped) return;

    const file = this.app.vault.getAbstractFileByPath(entry.filePath) as TFile | null;
    if (!file) {
      delete this.buildState.files[entry.filePath];
      return;
    }

    try {
      // 1. Read file
      const content = await this.app.vault.cachedRead(file);
      const fileHash = hashStr(content);

      // 2. Yield to idle BEFORE CPU-intensive chunking
      await yieldToIdle();

      // 3. Chunk (CPU work — but we just yielded)
      const chunks = this.getChunks(content, file);

      // 4. Determine which chunks need embedding
      const existing = this.buildState.files[entry.filePath];
      const doneHashes = new Set(
        (existing?.chunks ?? [])
          .filter(c => c.state === "done")
          .map(c => c.hash)
      );

      // Determine if this is a RESUME (same file, interrupted) vs a CHANGE (content differs)
      const isResume = !!(existing && existing.mtime === entry.mtime);

      // For resume: skip chunks already done. For changed files: embed ALL chunks
      // because removeBySource will wipe all old vectors, and chunk ordinals may shift.
      const toEmbed = isResume
        ? chunks.filter(c => !doneHashes.has(c.contentHash))
        : chunks;

      // Update buildState
      this.buildState.files[entry.filePath] = {
        mtime: entry.mtime,
        fileHash,
        chunks: chunks.map(c => ({
          id: c.id,
          hash: c.contentHash,
          state: (isResume && doneHashes.has(c.contentHash) ? "done" : "pending") as ChunkState,
          retries: 0,
        })),
      };

      // Update countTotal: add new chunks count, subtract old if replacing
      const oldChunkCount = existing?.chunks.length ?? 0;
      this.countTotal += chunks.length - oldChunkCount;

      if (toEmbed.length === 0) {
        // All chunks already done — no embedding needed (resume case)
        return;
      }

      // 5. Clear old vectors before inserting new ones.
      //    For RESUME: keep existing vectors; only remove for changed/new files
      //    (removing during resume would delete already-done vectors before we can re-add them)
      if (!isResume && existing) this.store.removeBySource(entry.filePath);

      // 6. Embed all pending chunks for this file in one batch call
      //    (provider handles internal batching; Ollama maxBatch=32)
      const texts = toEmbed.map(c => c.embedText);
      const vectors = await this.provider!.embed(texts);

      // Backfill dimensions from first embed
      if (vectors[0] && this.provider!.dimensions === null) {
        this.provider!.dimensions = vectors[0].length;
        this.fingerprint = currentFingerprint(
          this.provider!.id, this.provider!.model, vectors[0].length
        );
      }

      // 7. Upsert into store + mark done
      const records = toEmbed.map((chunk) => ({
        id: chunk.id,
        fingerprint: this.fingerprint,
        source: chunk.source,
        sourceType: chunk.sourceType,
        title: chunk.title,
        heading: chunk.heading,
        snippet: chunk.snippet,
        mtime: entry.mtime,
        contentHash: chunk.contentHash,
      }));
      this.store.upsert(records, vectors);

      const fe = this.buildState.files[entry.filePath];
      for (const chunk of toEmbed) {
        const ce = fe?.chunks.find(c => c.id === chunk.id);
        if (ce) ce.state = "done";
      }

      // Update cached counters
      this.countDone += toEmbed.length;

      // 8. Periodic persist (non-blocking: fire and forget)
      this.persistCounter++;
      if (this.persistCounter % PERSIST_EVERY_N === 0) {
        this.persistIndex(); // intentionally no await — background
      }

      // 9. Update progress notice using O(1) cached counters
      const remaining = this.fileQueue.length;
      if (remaining % 10 === 0 || remaining < 10) {
        this.setProgress(
          `正在建立连接… 还剩 ${remaining} 个文件（${this.countDone} / ${this.countTotal} 块）`
        );
      }

    } catch (e) {
      // Mark all pending chunks as error and update failure counter
      const fe = this.buildState.files[entry.filePath];
      if (fe) {
        for (const c of fe.chunks) {
          if (c.state === "pending" || c.state === "inflight") {
            c.state = "error";
            c.retries++;
            this.countFailed++;
          }
        }
      }
      console.warn(`Tacit: 处理文件失败 — ${entry.filePath}`, (e as Error).message);
    }
  }

  private async finishQueue() {
    this.isRunning = false;
    await this.persistIndex();
    this.lastUpdated = new Date().toLocaleString("zh-CN");
    this.clearProgress();

    const progress = this.getProgress();
    if (progress.failed > 0) {
      this.statusBar.setFailed(progress.failed);
      new Notice(
        `Tacit：索引完成。成功 ${progress.done} 块，失败 ${progress.failed} 块。\n` +
        `请前往设置 → 索引 → 「重试失败」`,
        0 // persistent
      );
    } else {
      this.statusBar.setDone(progress.done);
      new Notice(`Tacit：连接已就绪 ✓（${progress.done} 个文本块）`, 4000);
    }

    // Refresh views now that new embeddings are available
    this.plugin.refreshRelatedViews();
  }

  // ── Helpers ──────────────────────────────────────────────

  private getChunks(content: string, file: TFile): Chunk[] {
    const s = this.plugin.settings;
    return file.extension === "canvas"
      ? chunkCanvas(content, file.path, { maxSize: s.chunkSize, overlap: s.chunkOverlap })
      : chunkMarkdown(content, file.basename, {
          source: file.path,
          sourceType: "note",
          maxSize: s.chunkSize,
          overlap: s.chunkOverlap,
        });
  }

  private isExcluded(path: string): boolean {
    return this.plugin.settings.excludeFolders.some(folder =>
      path.startsWith(folder + "/") || path === folder
    );
  }

  private async getFingerprint(): Promise<string | null> {
    if (!this.provider) return null;
    if (this.provider.dimensions !== null) {
      return currentFingerprint(this.provider.id, this.provider.model, this.provider.dimensions);
    }
    try {
      const result = await this.provider.test();
      if (!result.ok || !result.dimensions) return null;
      this.provider.dimensions = result.dimensions;
      return currentFingerprint(this.provider.id, this.provider.model, result.dimensions);
    } catch { return null; }
  }

  private setProgress(msg: string) {
    if (!this.progressNotice) {
      this.progressNotice = new Notice(msg, 0);
    } else {
      this.progressNotice.setMessage(msg);
    }
  }

  private clearProgress() {
    this.progressNotice?.hide();
    this.progressNotice = null;
  }

  // ── Incremental watchers ─────────────────────────────────

  private onFileChange(file: TAbstractFile) {
    if (!(file instanceof TFile)) return;
    if (file.extension !== "md" && file.extension !== "canvas") return;
    if (this.isExcluded(file.path)) return;

    const t = this.modifyTimers.get(file.path);
    if (t) clearTimeout(t);
    this.modifyTimers.set(file.path, setTimeout(async () => {
      this.modifyTimers.delete(file.path);
      const existing = this.buildState.files[file.path];
      if (existing && existing.mtime === file.stat.mtime) return; // no real change
      this.fileQueue.push({ filePath: file.path, mtime: file.stat.mtime });
      if (!this.isRunning) this.processFileQueue();
    }, 2000));
  }

  private onFileDelete(file: TAbstractFile) {
    if (!(file instanceof TFile)) return;
    this.store.removeBySource(file.path);
    delete this.buildState.files[file.path];
    this.persistIndex();
  }

  private onFileRename(file: TAbstractFile, oldPath: string) {
    if (!(file instanceof TFile)) return;
    if (this.buildState.files[oldPath]) {
      this.buildState.files[file.path] = this.buildState.files[oldPath];
      delete this.buildState.files[oldPath];
    }
    // Sync store records so search excludeSource works with the new path
    this.store.renameSource(oldPath, file.path);
    this.persistIndex();
  }

  // ── Persistence ──────────────────────────────────────────

  private getIndexDir(): string {
    // Default: inside the plugin folder — deleted automatically when plugin is removed.
    // storageInVault=true: vault root .tacit/ — survives plugin removal (useful for sync).
    return this.plugin.settings.storageInVault ? ".tacit" : ".obsidian/plugins/tacit";
  }

  /** Non-blocking persist — call without await for background writes */
  private async persistIndex() {
    try {
      const dir = this.getIndexDir();
      const adapter = this.app.vault.adapter;
      if (!await adapter.exists(dir)) await adapter.mkdir(dir);

      await this.store.persist(dir);
      const binData: ArrayBuffer | undefined = (this.store as any)._pendingBinData;
      const metaData: string | undefined = (this.store as any)._pendingMetaData;
      if (binData) await adapter.writeBinary(`${dir}/index.bin`, binData);
      if (metaData) await adapter.write(`${dir}/index.meta.json`, metaData);

      this.buildState.version = BUILD_STATE_VERSION;
      await adapter.write(`${dir}/build-state.json`, JSON.stringify(this.buildState));
    } catch (e) {
      console.error("Tacit: 索引持久化失败", e);
    }
  }

  private async clearPersistedIndex() {
    try {
      const dir = this.getIndexDir();
      const adapter = this.app.vault.adapter;
      const files = ["index.bin", "index.meta.json", "build-state.json", "index.tmp", "build-state.tmp"];
      for (const f of files) {
        const p = `${dir}/${f}`;
        if (await adapter.exists(p)) await adapter.remove(p);
      }
    } catch (e) {
      console.warn("Tacit: 清理旧索引文件失败", e);
    }
  }

  private async loadPersistedIndex() {
    try {
      const dir = this.getIndexDir();
      const adapter = this.app.vault.adapter;

      const bsPath = `${dir}/build-state.json`;
      if (!await adapter.exists(bsPath)) return;

      const raw = JSON.parse(await adapter.read(bsPath));

      // ── Version check: clear stale cache if format changed ──
      if (!raw.version || raw.version < BUILD_STATE_VERSION) {
        console.info("Tacit: 检测到旧版索引格式，清理缓存并重建…");
        await this.clearPersistedIndex();
        return; // start fresh
      }

      this.buildState = raw;
      this.fingerprint = this.buildState.fingerprint ?? "";

      // Reset any interrupted inflight chunks to pending
      for (const fe of Object.values(this.buildState.files)) {
        for (const c of fe.chunks) {
          if (c.state === "inflight") c.state = "pending";
          if (c.state === "done") this.countDone++;
          if (c.state === "error") this.countFailed++;
          this.countTotal++;
        }
      }

      // Load vectors
      const binPath = `${dir}/index.bin`;
      const metaPath = `${dir}/index.meta.json`;
      if (await adapter.exists(binPath) && await adapter.exists(metaPath)) {
        const binData = await adapter.readBinary(binPath);
        const metaJson = await adapter.read(metaPath);
        this.store.loadFromBuffers(binData, metaJson);
      }
    } catch (e) {
      console.error("Tacit: 加载持久化索引失败，将重建", e);
      this.buildState = { fingerprint: "", files: {}, version: BUILD_STATE_VERSION };
      await this.clearPersistedIndex();
    }
  }
}
