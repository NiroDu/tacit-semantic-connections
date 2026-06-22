# Architecture — scaffold, vector store, index orchestration

> Sections: 1) Scaffold boilerplate · 2) HTTP wrapper · 3) Vector math · 4) Vector store (memory layout / persistence / quantization / Worker / ANN) · 5) Index orchestration and resume

---

## 1. Scaffold (copy verbatim to avoid boilerplate traps)

**manifest.json**
```json
{
  "id": "tacit",
  "name": "Tacit — Semantic Connections",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Semantic note connections with tacit knowledge at the core: passive Related Notes + Find, local Ollama first, with OpenAI/OpenRouter/Gemini support, plus indexing of Canvas text cards.",
  "author": "you",
  "isDesktopOnly": false
}
```

**package.json** (key devDeps; pin to current stable)
```json
{
  "name": "tacit",
  "version": "0.1.0",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run"
  },
  "devDependencies": {
    "obsidian": "latest",
    "esbuild": "^0.21.0",
    "typescript": "^5.4.0",
    "@types/node": "^20",
    "vitest": "^1.6.0",
    "builtin-modules": "^3.3.0"
  }
}
```

**esbuild.config.mjs** (equivalent to Obsidian's official sample; mark `obsidian`/electron/builtins external)
```js
import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "fs/promises";

const prod = process.argv[2] === "production";

await mkdir("./dist", { recursive: true });

async function copyAssets() {
  await copyFile("./manifest.json", "./dist/manifest.json");
  await copyFile("./styles.css", "./dist/styles.css");
}
await copyAssets();

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", ...builtins],
  format: "cjs",
  target: "es2020",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",   // ← dist/, NOT root
  minify: prod,
  plugins: [{ name: "copy-assets", setup(b) { b.onEnd(async r => { if (!r.errors.length) await copyAssets(); }); } }],
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); process.exit(0); }
else { await ctx.watch(); }
```

**tsconfig.json**
```json
{
  "compilerOptions": {
    "baseUrl": ".", "module": "ESNext", "target": "ES2020",
    "moduleResolution": "node", "lib": ["ES2020","DOM"],
    "strict": true, "noImplicitAny": true, "esModuleInterop": true,
    "skipLibCheck": true, "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

**Dev install**: put the repo at `<vault>/.obsidian/plugins/tacit/`, run `npm i && npm run dev`, enable it in Obsidian. Pair with the community *Hot-Reload* plugin for auto-refresh.

**styles.css**: keep all visual weight restrained — relatedness bars use `--text-faint`/`--text-muted`, match highlight uses `background: var(--text-highlight-bg)`, cards use `--background-secondary`. Always use Obsidian CSS variables so it adapts to the user's theme (never hardcode colors).

---

## 2. util/http.ts — single egress

All provider calls go through here, centralizing timeout / retry / concurrency / readable errors.

```ts
import { requestUrl, RequestUrlParam } from "obsidian";

export async function httpJson(p: RequestUrlParam & { timeoutMs?: number }) {
  // requestUrl has no AbortSignal; implement timeout via Promise.race
  const timeout = p.timeoutMs ?? 60000;
  const res = await Promise.race([
    requestUrl({ throw: false, ...p }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${timeout}ms`)), timeout)),
  ]);
  if (res.status >= 400) {
    // extract the provider error and build a readable message (401 -> auth; 404 -> bad model/path, ...)
    throw new HttpError(res.status, extractErr(res));
  }
  return res.json;
}
```

**Concurrency gate + backoff**: implement a `pLimit(n)` and `withRetry(fn, {retries, baseMs})` (exponential backoff + jitter; retry 429/5xx/timeout, do not retry non-429 4xx). The indexer wraps each embed batch with these.

**Ollama / localhost note**: on desktop, `requestUrl` reaches `http://localhost:11434` fine. Browser-style `fetch` would hit CORS — so **force requestUrl**. Mobile has no localhost; a remote address is required.

---

## 3. util/vec.ts — vector math

- `normalize(v)`: L2-normalize before storing → cosine reduces to a dot product, faster search.
- `dot(a,b)`: tight loop over `Float32Array`.
- **top-K**: maintain a size-K min-heap, one pass over the store, O(N·d + N·logK). With N up to tens of thousands and d ≤ 1024, a single search is a few to tens of milliseconds — sufficient.
- **MMR (the serendipity implementation)**:
  ```
  MMR: among candidates c not yet selected (set S), pick the one maximizing
       lambda * sim(q, c) - (1 - lambda) * max_{s in S} sim(c, s)
  Serendipity ON -> lower lambda (e.g. 0.5) and add a small bonus for older notes
  (earlier mtime), so "forgotten connections" rise more easily.
  lambda = 1 degenerates to pure similarity ranking.
  ```
- Note: when aggregating to the *note* level, first take chunk-level top-(K × expansion), then aggregate by source taking each source's best score, then apply MMR/truncation over *notes* — so a single note's many chunks can't dominate the list.

---

## 4. Vector store

### 4.1 Default impl: in-memory matrix + binary persistence
- Memory: `vectors: Float32Array` (one flat array; record i = `subarray(i*d, (i+1)*d)`) plus a parallel `meta: VecRecord[]` (without the vector).
- **Persistence format** (atomic write: write `index.tmp`, then rename over `index.bin`; metadata to `index.meta.json`):
  ```
  index.bin header: magic(4) | version(u16) | dim(u16) | count(u32) | fingerprintLen + bytes
  then: count × dim × float32 (little-endian)
  index.meta.json: { fingerprint, dim, records: VecRecord[](no vector), buildState }
  ```
- **Storage location**: default in the plugin dir `.obsidian/plugins/tacit/` (not synced with the vault, so a big binary isn't pushed to sync); allow changing it to a vault-internal `.tacit/` in settings (good for cross-device, but warn about size).

### 4.2 Large-vault optimizations (enable on demand when chunk count > ~50k; put behind "Advanced" settings)
- **int8 quantization**: quantize each vector to int8 with a per-vector scale → storage/memory ×¼; dequantize at search time or use an integer dot-product approximation. Recall loss is small; fine for Related Notes.
- **Web Worker**: move the search matmul into a Worker so the main thread never stutters (build a separate worker bundle with esbuild, or a simple postMessage protocol).
- **ANN upgrade**: only when chunk count > ~100k, consider `hnswlib-wasm` (satisfies the same `VectorStore` interface, hot-swappable). **Don't reach for ANN up front** — brute force is simpler and more accurate at personal-vault scale.

### 4.3 Optional backends (keep the same `VectorStore` interface)
- `sqlite-vec` (WASM build, avoids native ABI) / `LanceDB` (desktop-only, native). As "advanced backends," disabled by default. Same interface → the user can switch without touching upper layers.

---

## 5. Index orchestration (indexer.ts) — robustness core

### 5.1 Data structures
```ts
type ChunkState = 'pending' | 'inflight' | 'done' | 'error';
interface BuildState {
  version: number;          // increment BUILD_STATE_VERSION on schema change → triggers auto-wipe
  fingerprint: string;
  files: Record<string /*path*/, {
    mtime: number;          // from file.stat.mtime — used as fast-path change detector
    fileHash: string;       // whole-file hash for content diffing when mtime matches
    chunks: { id: string; hash: string; state: ChunkState; retries: number }[];
  }>;
}
```
`BuildState` is persisted alongside the index. Include a `version` number — when the schema changes, the loader detects a mismatch and wipes the persisted cache automatically before reconcile.

### 5.2 reconcile — mtime-first, file reads deferred
```
Scan phase (zero I/O — uses file.stat.mtime already in memory):
  For each .md / .canvas in the vault (getFiles(), already cached):
    if buildState has entry AND entry.mtime === file.stat.mtime:
      → skip read; restore any 'inflight' chunks to 'pending'
      → if any pending chunks remain, add file to fileQueue
    else:
      → add file to fileQueue (will be read later, in the embed queue)

  After scan: remove deleted files from store and buildState.
  Fingerprint mismatch (model changed) → clear everything, rebuild.
```

**Critical: NEVER read file content during the scan phase.** Even `cachedRead` for iCloud files triggers cloud I/O. With 2000+ files, doing any I/O in the scan loop causes visible freezes even with `await` between files.

**Yield strategy in scan loop**: use `requestIdleCallback` (falls back to `setTimeout(fn, 16)`) every 50 files. This gives the Obsidian renderer a full animation frame to process user input between batches. `sleep(0)` (microtask) is NOT sufficient — it doesn't release the main thread to the browser's rendering pipeline.

```ts
function yieldToIdle(timeoutMs = 300): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 16);
    }
  });
}
```

### 5.3 File queue — serial processing, one file at a time

**Do NOT use `Promise.all` on the file queue.** Creating 2000+ Promises simultaneously and scheduling them saturates the event loop. Instead:

```
processFileQueue():
  pop one entry from fileQueue
  processOneFile(entry).then(() => {
    setTimeout(() => processFileQueue(), INTER_FILE_MS)  // 100ms gap between files
  })
```

Each `processOneFile(entry)`:
1. `cachedRead(file)` — async I/O, yields naturally
2. `yieldToIdle()` — yield BEFORE CPU-intensive chunking
3. `getChunks(content, file)` — O(n) chunking (see §chunking gotcha)
4. Determine which chunks need embedding (diff against `buildState` by contentHash)
5. `provider.embed(pendingChunks.map(c => c.embedText))` — async network, yields naturally
6. `store.upsert(records, vectors)` — fast
7. Mark chunks `done` in buildState
8. Persist every N files (fire-and-forget, no `await`)

The 100ms `setTimeout` between files ensures Obsidian always has dedicated main-thread time for user interactions. The total extra time is ~3 min for 2000 files — acceptable for a background task.

### 5.4 Progress counters — O(1), never O(n)

**Do NOT iterate `buildState.files` to compute progress on every file.** With 2000 files × 14 chunks = 28,000 objects iterated per file = O(n²) total. Maintain cached counters instead:

```ts
private countDone = 0;    // incremented when chunks are marked done
private countTotal = 0;   // incremented when files are processed
private countFailed = 0;  // incremented when chunks fail permanently
```

Initialize from persisted state in `loadPersistedIndex` (one-time O(n) scan at startup). Reset to 0 in `rebuildAll`.

### 5.5 Incremental triggers (register via `this.registerEvent`)
- `vault.on('modify' | 'create')` → debounce 2s (not 1.5s — gives Obsidian time to finish writing), push to fileQueue, trigger processFileQueue if not already running.
- `vault.on('delete')` → `removeBySource` + clear state + persist.
- `vault.on('rename')` → rewrite the source path key (keep vectors, avoid re-embedding).
- On modify: first check if `file.stat.mtime` actually changed before re-indexing — Obsidian fires modify events even for no-op saves.

### 5.6 Progress and observability

**Status bar phases:**
- Scanning: `Tacit 扫描 N/T`
- Embedding: `Tacit ⟳ N/T`
- Done: `Tacit ✓ N` (auto-resets to idle after 5s)
- Failed: `Tacit ⚠ N 失败`

**Notices:**
- Use a persistent Notice (`new Notice(msg, 0)`) with `notice.setMessage(msg)` for live updates during indexing. This keeps one persistent notification instead of spamming many.
- Startup: delay initial scan by 5 seconds (`setTimeout(() => reconcile(), 5000)`) to let Obsidian fully load its workspace first.
- On completion with failures: use `timeout: 0` (persistent, user must dismiss) and include the retry instruction in the message body.

**Cache clearing (`clearPersistedIndex`):**
- Call on `rebuildAll()` and on fingerprint mismatch before rebuild.
- Deletes: `index.bin`, `index.meta.json`, `build-state.json`, `*.tmp`.
- Also call when `loadPersistedIndex` fails to parse — corrupted cache should not prevent the plugin from starting.

### 5.7 Storage locations
- Default: `.obsidian/plugins/tacit/` — not synced, avoids pushing a large binary to iCloud/git.
- Optional: `.tacit/` inside vault (user opt-in, good for cross-device, warn about size).

### 5.8 What was tried and rejected

| Approach | Why rejected |
|---|---|
| `Promise.all(2000 files)` | Creates 2000 Promises at once; saturates event loop even with pLimit |
| `sleep(0)` (microtask) between files | Does not release to browser rendering; UI still freezes on heavy files |
| `sleep(16)` every 50 files | Better, but doesn't account for CPU-heavy chunking within each file |
| Pre-reading all files during scan phase | iCloud `cachedRead` triggers cloud I/O; 2000 reads freeze for seconds |
| Per-file progress by iterating buildState | O(n²) = 57M iterations for 2000 files; causes stutter in settings panel |
| Backtracking regex for code fences | ReDoS on unclosed fences; hangs main thread for minutes on affected files |
