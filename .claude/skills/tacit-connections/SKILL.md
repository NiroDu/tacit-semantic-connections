---
name: build-tacit-obsidian-plugin
description: Build an Obsidian plugin called Tacit from scratch — replicating flomo's "Related Notes" (passive semantic surfacing) and "Find" (semantic retrieval + optional AI synthesis), with local Ollama as the default provider, plus OpenAI / OpenRouter / Gemini / any OpenAI-compatible endpoint for embeddings and reranking, and native indexing of Canvas text cards. Load and follow this skill whenever the user mentions building/developing this plugin, "the Tacit plugin", a "semantic related-notes plugin", "flomo related notes / find for Obsidian", an "Obsidian semantic search plugin", or asks to continue any phase of this plugin (scaffold, providers, indexing, related-notes panel, find, settings). Trigger even if the user only says "keep working on the plugin."
---

# Build Tacit — an Obsidian semantic-connection plugin with tacit knowledge at its core

Your role here is a **product engineer who cares deeply about interaction quality**. You are not building a "semantic search tool" — you are building a product that lets a person **re-encounter their own forgotten thinking**. Every technical decision serves one goal: surface the hidden connections between notes with near-zero friction.

> Read this whole file before writing any code. Load the matching file under `references/` only when you need it. This file is the conductor; the detail lives in the references.

---

## 0. Product core: Polanyi's tacit knowledge (internalize this first)

Michael Polanyi's central claim is **"We know more than we can tell."** A vault built up over years holds a large web of connections the author **cannot actively recall and cannot explicitly articulate**. Manual `[[wikilinks]]` only encode the links you were *aware* of; most valuable links are tacit — sitting at the edge of awareness.

Tacit's entire purpose is to make that tacit web **re-encounterable** — through surfacing, not interrogation. This core **directly dictates** every UI decision below. Treat it as the product constitution, not decorative copy. The design principles it yields (follow them rigorously):

1. **Surfacing over interrogation (ambient over interrogative).** The user should not have to formulate a query to benefit. The passive Related Notes panel is therefore the heart of the product; Find is the assistant.
2. **Peripheral attention / indwelling.** Connections appear at the edge of vision (a sidebar), with very light visual weight. You *dwell* in the current note and connections emerge in the periphery — exactly Polanyi's subsidiary awareness.
3. **Embrace forgetting and serendipity.** Deliberately surface older, less-obvious notes. The most valuable tacit links are precisely the ones you've forgotten you made. A pure "most-recent / most-similar" ranking buries them.
4. **The tacit→explicit moment.** The one action that lets the user turn implicit into explicit is **drag-to-link**. Make it a single, satisfying gesture — codification is valuable, but it should be the user's deliberate choice, never forced.
5. **Don't over-quantify the signal.** Show relatedness as *texture* (a soft bar / dots), not a raw cosine number. A precise number tempts the user to mistake a *felt* resemblance for a hard metric — false precision. (Advanced users can opt into numbers in settings.)
6. **Low friction = trust.** Defaults that just work. Any configuration tax kills the indwelling the whole product depends on.

`references/ux-and-philosophy.md` expands these six into implementable interaction specs and microcopy. **Whenever a UI tradeoff is contested, return to these six to settle it.**

---

## 1. Engineering overview

| Dimension | Decision | Rationale (one line) |
|---|---|---|
| Form | Obsidian community plugin, TypeScript + esbuild | Standard, hot-reloadable, desktop + mobile |
| HTTP | Always Obsidian `requestUrl()` | Bypasses CORS, consistent desktop/mobile |
| Embedding providers | Ollama (default) / OpenAI / OpenRouter / Gemini / generic OpenAI-compatible | Local-first + full third-party; one interface |
| Reranking (optional) | Same provider abstraction, off by default | No overhead when recall suffices; available when precision matters |
| Vector store | Default pure-TS in-memory matrix + binary persistence; optional sqlite-vec / hnswlib | Zero native deps, mobile-capable, avoids the "incomplete embedding" crash class |
| Indexing | Incremental + resumable + retryable | **Directly fixes the "incomplete embedding" pain from Open Connections** |
| Canvas | Parse `.canvas` JSON, index text cards | **Off-the-shelf plugins generally don't — this is the differentiator** |
| Mental model | Related Notes (passive) = heart; Find (active) = assistant | Derived from the tacit-knowledge core |

Working name **Tacit** (id `tacit`, display name "Tacit — Semantic Connections"). Renaming costs almost nothing — change the `manifest.json` id, the folder name, and class names. The user can rename anytime.

---

## 2. Target directory structure

```
tacit/
├── manifest.json
├── esbuild.config.mjs
├── tsconfig.json
├── package.json
├── styles.css
└── src/
    ├── main.ts                  # entry: register view / command / settings / lifecycle
    ├── settings.ts              # settings model + defaults + SettingTab
    ├── providers/
    │   ├── types.ts             # EmbeddingProvider / RerankProvider interfaces
    │   ├── factory.ts           # instantiate provider from config
    │   ├── ollama.ts
    │   ├── openai.ts            # OpenAI + OpenRouter + generic compat (shared; differ by baseURL/headers)
    │   └── gemini.ts
    ├── index/
    │   ├── chunker.ts           # markdown-aware chunking
    │   ├── canvas.ts            # .canvas parsing
    │   ├── store.ts             # VectorStore interface + in-memory impl + persistence
    │   ├── fingerprint.ts       # model fingerprint / dimension safety
    │   └── indexer.ts           # index orchestration: incremental / resume / retry / progress
    ├── views/
    │   ├── related-view.ts      # Related Notes sidebar (the heart)
    │   └── find-modal.ts        # Find
    ├── ui/
    │   ├── result-item.ts       # shared result card (highlight / drag / hover)
    │   └── status.ts            # status bar + progress
    └── util/
        ├── http.ts              # requestUrl wrapper + concurrency queue + backoff retry
        ├── hash.ts              # content hashing
        └── vec.ts               # normalize / cosine / top-K heap / MMR
```

The **exact contents** of the scaffold files (`manifest.json` / `esbuild.config.mjs` / `tsconfig.json` / `package.json`) are in the "Scaffold" section of `references/architecture.md` — copy them verbatim to avoid wasting time on fiddly boilerplate.

---

## 3. Core interface contracts (follow strictly to keep modules consistent)

```ts
// providers/types.ts
export interface EmbeddingProvider {
  id: 'ollama' | 'openai' | 'openrouter' | 'gemini' | 'openai-compat';
  model: string;
  dimensions: number | null;        // unknown until first response backfills it
  maxBatch: number;                  // max items per request
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
  listModels?(): Promise<string[]>;  // Ollama: /api/tags
  test(): Promise<{ ok: boolean; message: string; dimensions?: number }>;
}

export interface RerankProvider {
  id: string;
  model: string;
  rerank(query: string, docs: string[], signal?: AbortSignal):
    Promise<{ index: number; score: number }[]>;
}

// index/store.ts
export interface VecRecord {
  id: string;            // `${source}::${chunkOrdinal}`; source = note or canvas path
  vector: Float32Array;  // L2-normalized
  fingerprint: string;   // see §4
  source: string;        // file path
  sourceType: 'note' | 'canvas';
  title: string;
  heading?: string;
  snippet: string;       // raw, human-readable text for display (NOT the embed-prefixed text)
  mtime: number;
  contentHash: string;
}

export interface VectorStore {
  upsert(records: VecRecord[]): void;
  removeBySource(source: string): void;
  search(query: Float32Array, k: number, opts?: {
    fingerprint: string;
    excludeSource?: string;          // exclude current file in Related Notes
    diversity?: number;              // 0..1, MMR diversity (serendipity)
  }): { record: VecRecord; score: number }[];
  size(): number;
  persist(): Promise<void>;          // atomic write: temp + rename
  load(): Promise<void>;
}
```

Implementation detail and each provider's exact request/response shapes are in `references/providers.md`; chunking and Canvas in `references/canvas-and-chunking.md`.

---

## 4. Three robustness constraints you must get right (this is where you beat off-the-shelf plugins)

1. **Model fingerprint / dimension safety**
   `fingerprint = hash(provider.id + ':' + model + ':' + dimensions + ':' + CHUNKING_VERSION)`.
   Every vector carries its fingerprint; `search` only compares vectors with a matching fingerprint. Switching model/provider changes the dimension, so it **must prompt a full rebuild**. **Never silently mix dimensions** — mixing produces garbage results or crashes, which is exactly the trap the user has hit before.

2. **Resumable indexing** (fixes "incomplete embedding")
   Each chunk has a state: `pending → inflight → done | error(retryCount)`.
   - The queue and state are **persisted**: after a kill / Obsidian restart, reconcile on startup (re-embed changed, drop deleted, enqueue new) and resume from `pending`.
   - Bounded concurrency (default Ollama=3, cloud=8, configurable); exponential backoff on errors; after N retries mark `failed`, aggregate in the UI, and offer a "Retry failed" button.
   - Use Web Workers or carefully chunked task execution (requestIdleCallback) to keep the UI main thread responsive.
   - Debounced persistence (every N chunks or T seconds), atomic write.

3. **Unified provider calls**
   Everything goes through `util/http.ts`: `requestUrl()` + timeout + AbortSignal + concurrency gate + backoff. No provider implementation issues requests directly, so 401 / timeout / rate-limit handling is centralized and surfaces a **human-readable** error (the settings "Test connection" button must show the specific reason).

`references/architecture.md` §5 gives the full design for index orchestration — including the validated file-queue design, correct yield strategy, O(1) progress counters, cache version scheme, and a table of approaches tried and rejected.

---

## 5. Implementation notes for the two features (full spec in ux-and-philosophy.md)

### 5.1 Related Notes (passive, the heart)
- Right-side `ItemView`. Listen to `active-leaf-change` / `file-open`, **debounced ~300ms**.
- Current-note representation: **prefer the mean of its already-indexed chunk vectors** (zero extra API call); fall back to an on-the-fly embedding if not yet indexed.
- `search(k)` excluding the current file → aggregate by source (take each file's best-scoring chunk) → rank → take top N.
- Each result: title + time ("written …") + **beginning of note snippet** (always chunk `::0`, regardless of which chunk ranked highest) + **textural relatedness** (a small bar, not a number).
- Interaction: hover triggers Obsidian preview; **drag to insert `[[link]]`** (the tacit→explicit moment); click opens, ⌘/Ctrl-click new pane.
- Minimal top controls: search icon (opens Find), pause/pin (freeze on one note while you wander), serendipity toggle, refresh, settings gear.
- **Refresh guard**: `refresh(force = false)` — skips if `currentFile?.path === activeFile.path` to prevent re-querying when the user clicks the same file. Pass `force=true` from the serendipity toggle and manual refresh button.
- Three states: indexing (show progress + partial results), empty (gentle copy, never blank), error.

### 5.2 Find (active, the assistant)
- Command + hotkey opens a search box. Two result modes (mode toggle is a **segmented pill control**, not two buttons):
  - **Retrieval mode (default)**: query → embed → aggregate by note → display. No LLM, instant, fully local. Auto-fires on debounce as the user types.
  - **AI 问答 mode** (was called "Synthesis"): feed top-5 note snippets to LLM → answer in the user's own words, sourced from notes. **Only fires on Enter key press** (expensive LLM call). Source notes always shown below the response. System prompt instructs the LLM to answer cleanly without `[[link]]` citations in the text (source notes section replaces inline citations). LLM output additionally has `[[...]]` stripped as a safety net. Implemented in `src/providers/chat.ts`.
- Switching modes with a query already typed **re-runs the search** immediately.
- `chat.ts` dispatches to Ollama / OpenAI / OpenRouter / openai-compat / Gemini, reusing all existing keys/URLs from `TacitSettings`. Provider selected via `settings.findChatProvider`.
- Keyboard-first: ↑↓ to select, Enter to open (or trigger AI 问答), Esc to close; remember recent queries.

---

## 6. Phased build plan (execute in order; pass acceptance before moving on)

> Track with a TodoList. End each phase with a self-check + a click-through on a real vault.

**Phase 0 — Scaffold & skeleton**
Build all scaffold files per `references/architecture.md`; `npm run dev` hot reload works; register an empty right-side view, an empty settings tab, a status-bar placeholder.
✅ Accept: plugin enables in Obsidian, an empty panel appears in the sidebar, no errors.

**Phase 1 — Provider layer**
Implement `types/factory/ollama/openai (incl. openrouter + compat)/gemini`, all via `util/http.ts`; settings expose provider selection + a "Test connection" button (live green/red + dimensions). Ollama model dropdown auto-populated from `/api/tags`.
✅ Accept: each provider's "Test connection" succeeds and reports the correct dimension; a wrong key/URL shows a **readable** error.

**Phase 2 — Chunking & content fingerprint**
`chunker.ts` (markdown-aware, protect code blocks, split by headings + windowed overlap, inject a light context prefix for embedding but store raw `snippet`); `canvas.ts` (parse text cards); `hash.ts`.
✅ Accept: for sample .md/.canvas, chunk counts are reasonable, nothing splits mid code-block/card, Canvas text cards are extracted with correct provenance.

**Phase 3 — Vector store + fingerprint**
`store.ts` in-memory matrix + normalization + top-K heap + MMR; binary atomic persistence + load; `fingerprint.ts`.
✅ Accept: upsert/search/remove correct; index loads after restart; vectors of different fingerprints don't contaminate each other's search.

**Phase 4 — Index orchestration (robustness core)**
`indexer.ts`: full + incremental (watch create/modify/delete/rename, debounced) + resumable + retry + progress (status bar + Notice + settings stats).
✅ Accept: (1) full-index a vault; (2) restart Obsidian mid-index — it resumes and **ends with no pending/missing**; (3) induce failures by dropping the network, then "Retry failed" recovers; (4) UI never freezes during indexing.

**Phase 5 — Related Notes panel (the heart)**
Implement per §5.1 + the UX spec, including drag-to-link, hover, textural relatedness, pause/pin, serendipity, three states.
✅ Accept: panel updates smoothly on note switch; drag inserts the correct `[[link]]`; "Serendipity" demonstrably brings back older/more diverse results; visual weight is restrained (honors the ambient principle).

**Phase 6 — Find**
Implement retrieval mode + synthesis mode per §5.2 (synthesis strictly cited, no fabrication, streamed, sources alongside).
✅ Accept: retrieval mode returns the user's notes instantly; synthesis mode output is grounded **only** in the notes and every claim carries a `[[link]]` source.

**Phase 7 — Settings polish & edges**
All five settings groups present (provider / rerank / indexing / related / find); privacy disclosure (state honestly that keys are stored in plaintext plugin data); graceful degradation on mobile for localhost-Ollama (prompt to use a remote/cloud provider); first-run Ollama defaults + an `ollama pull` hint.
✅ Accept: cold start on a machine with Ollama installed surfaces connections with "near-zero config"; mobile doesn't error and gives clear guidance.

**Phase 8 — Tests / README / performance**
Light unit tests for pure functions (chunker, vec, provider request builders with mocked requestUrl); README covering install, provider config, Canvas behavior, privacy; one performance pass on a large vault (enable int8/Worker if needed, see architecture).
✅ Accept: tests pass; a stranger can install it from the README alone; relatedness quality on Chinese notes is subjectively acceptable.

---

## 7. Standing principles for the implementer
- **Don't re-litigate settled decisions** (table §1 and contracts §3 are fixed); if there's a strong reason to change one, state it first, then change it.
- **Make the "heart" exceptional first.** The feel of the Related Notes panel (highlight, drag, restraint, serendipity) is the soul of this product — worth extra time.
- **Errors are always readable, always recoverable.** The user has been burned by "silent failure / incomplete embedding"; the selling point of this plugin is that they never get burned again.
- The user's working language is **Simplified Chinese**: **ship all user-facing strings, Notices, settings descriptions, and README in Simplified Chinese.** Use English for code identifiers and API names. The English microcopy in the UX file is the **canonical reference for tone and content** — translate it faithfully, preserving the restrained, gentle, second-person register.

---

## 8. Reference index (load on demand)
- `references/architecture.md` — scaffold boilerplate, index orchestration and reconcile, vector-store memory layout / persistence format / quantization / Worker / ANN upgrade, concurrency and retry.
- `references/providers.md` — exact endpoints, request bodies, response parsing, auth headers, dimension discovery, and reranking for Ollama / OpenAI / OpenRouter / Gemini / generic compatible.
- `references/ux-and-philosophy.md` — the six tacit-knowledge principles expanded into implementable specs, item-by-item interaction specs for both views, settings information architecture, full microcopy.
- `references/canvas-and-chunking.md` — markdown-aware chunking algorithm, context-prefix strategy, `.canvas` JSON structure and extraction rules, provenance display.
