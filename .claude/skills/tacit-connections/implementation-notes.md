# Implementation Notes — bugs, pitfalls, and UI decisions

Durable lessons from building Tacit. Update as new issues are discovered.

---

## Bugs found and fixed

### 1. `store.ts persist()` silently failed to write `index.bin`
**Symptom**: every Obsidian restart triggered a full re-index.  
**Root cause**: `persist()` had dead code `(window as any).require("obsidian")` that could throw before `_pendingBinData` was set, so `index.bin` was never written.  
**Fix**: remove the dead code entirely. `_pendingBinData`/`_pendingMetaData` are set unconditionally; the Indexer reads them and writes the files via `vault.adapter`.

### 2. Consistency gap — store empty but buildState says "done"
**Symptom**: after bug #1 (or any write failure), `index.bin` is absent but `build-state.json` shows all chunks as `done` → reconcile found "nothing to do" → store stayed empty → no results ever.  
**Fix**: in `reconcileAndRun()`, after fingerprint check, if `store.size() === 0` but any chunk has `state === "done"`, automatically clear persisted state and force a full rebuild. Guard lives in `indexer.ts`.

### 3. Snippet showed mid-note fragments instead of note beginning
**Symptom**: Related Notes panel showed random middle chunks, often garbled partial sentences.  
**Root cause**: `search()` returned the snippet of the **highest-scoring chunk**, which could be chunk 3 or 7 from the middle of the note.  
**Fix**: in `InMemoryVectorStore.search()`, after selecting results, always look up `${source}::0` (chunk 0) and use its snippet for display. Ranking still uses the best-chunk score — only the display snippet changes.

### 4. Orphaned HTML closing fragments in snippets
**Symptom**: snippets starting with `Regular:">` or similar garbage when notes contain inline HTML.  
**Root cause**: chunk boundaries split mid-HTML-tag, leaving the closing `>` at the start of the next chunk.  
**Fix**: `highlightSnippet()` opens with `replace(/^[^<>]*>+/, "")` to strip any orphaned closing fragment before the first `<`.

### 5. Markdown/HTML not stripped from snippet display
**Fix**: `highlightSnippet()` now strips (in order): YAML front matter (`---...---`), orphaned HTML fragments, full HTML tags + entities, then markdown — images, wikilinks `[[x|y]]`/`[[x]]`, external links `[t](url)`, fenced code blocks, inline code, headings, bold/italic/strikethrough, blockquote and list markers. Result is plain text safe to set as `innerHTML` after HTML-entity-escaping.

---

## UI decisions made

### Mode toggle: segmented pill control
The Find modal mode switcher was initially two `<button>` elements with `is-active` class. Changed to a segmented pill:
- Wrapper `.tacit-mode-seg` with no background (buttons sit flush)
- Inactive: `background: transparent !important` — the `!important` is necessary to override Obsidian's default button background that bleeds through
- Active: `color: var(--interactive-accent); font-weight: 500` — accent color text, no background fill, no border
- Using `color-mix()` background tints was tried but user found them visually noisy

### AI 问答: Enter-only trigger
Retrieval mode auto-searches on debounce (fast, local). AI 问答 only fires on Enter key press. This avoids hammering the LLM with every keystroke. The `input` event handler checks `if (this.mode === "retrieval")` before scheduling debounce.

### AI 问答: no inline `[[link]]` citations
Original prompt required the LLM to insert `[[笔记名]]` after every claim. User found them distracting mixed into the response text. New prompt: "直接用流畅的语言回答，不要在回复中插入任何引用标注或链接符号." Source notes are shown as a separate section below the response. Output additionally has `/\[\[([^\]]+)\]\]/g` stripped as a safety net.

### Mode switching re-runs search
`updateMode()` was originally updating button visuals only — clicking "AI 问答" after a retrieval search did nothing. Fixed: `updateMode()` calls `this.search(q)` if there's already a query in the input.

### Related Notes refresh guard
`refresh()` gained a `force: boolean = false` parameter. Without force, it skips if `currentFile?.path === activeFile.path`. This prevents re-querying when the user clicks the same file twice. The serendipity button and manual refresh button pass `force=true`. `scheduleRefresh()` (called from `active-leaf-change`/`file-open` events) uses `force=false`.

### Snippet display: always show note beginning
`InMemoryVectorStore.search()` always resolves to chunk `::0` for the displayed snippet, regardless of which chunk scored best. Ranking accuracy is preserved (uses best chunk's score for MMR/sorting), only the visual snippet changes.

### Stagger entrance animation
When `renderResults()` rebuilds the list, items enter top-to-bottom with a 35ms stagger. Implementation:
- CSS: `@keyframes tacit-item-in` (opacity 0→1, translateY 6px→0, 200ms)
- `.tacit-result-item` gets `animation: tacit-item-in ... backwards; animation-delay: calc(var(--tacit-i, 0) * 35ms)`
- `backwards` fill mode: item is invisible during its delay, then animates in; after completion it reverts to stylesheet values (not the animation `to` state) so `:hover` transform works normally
- `renderResults()` calls `el.style.setProperty("--tacit-i", String(i))` on each item

---

## New files added

### `src/providers/chat.ts`
`chatCompletion(settings, messages)` — dispatches a chat completion request to whichever provider is configured in `settings.findChatProvider`. Covers:
- `ollama`: POST `/api/chat`, `stream: false`
- `openai`: POST `/v1/chat/completions` with `openaiKey`
- `openrouter`: same endpoint at `openrouter.ai` with `openrouterKey` + `HTTP-Referer: obsidian://tacit`
- `openai-compat`: POST `compatBaseUrl/chat/completions` with optional `compatKey`
- `gemini`: POST `generateContent`, maps system message to `systemInstruction`, `assistant`→`model` roles

Reuses all existing keys/base-URLs from `TacitSettings`. `findChatProvider: ProviderType` added to settings.

---

## CSS gotchas

- Obsidian's default `<button>` has a visible background. To get a truly transparent button, `background: transparent !important` is required — normal `background: transparent` is overridden by Obsidian's stylesheet.
- `color-mix(in srgb, var(--interactive-accent) X%, transparent)` works in Electron/Chromium and is the right way to tint the accent color with opacity. Supported in Obsidian.
- Stagger animations: use `animation-fill-mode: backwards` (not `both`/`forwards`) to avoid the animation's final transform blocking `:hover` CSS transitions after the animation completes.
