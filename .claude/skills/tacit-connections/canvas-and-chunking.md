# Chunking & Canvas — chunking and Canvas parsing

> Sections: 1) Chunking goals & version · 2) Markdown-aware chunking algorithm · 3) Context-prefix strategy · 4) `.canvas` structure & extraction · 5) Provenance & display

The `CHUNKING_VERSION` constant participates in the fingerprint (SKILL §4). **Any change to chunking logic must increment it** to trigger an automatic rebuild and avoid mixing old and new chunks in one index.

---

## 1. Goals
- Unit: a semantically coherent small segment (so we can pinpoint *which* part is related, not the whole note).
- Target size: **Chinese notes: ~400–600 chars** (Chinese characters are semantically denser than English; 1 char ≈ 0.5–0.7 tokens). **English notes: ~800–1200 chars** (~300–400 tokens at ~4 chars/token). Overlap: ~60–80 chars (Chinese) / ~100 chars (English). **Default in settings: 500 chars** — reasonable for mixed-language vaults.
- Never split mid **code block**, **table**, or **Canvas text card**.
- Each chunk carries: `source, sourceType, title, heading, snippet(raw), contentHash, ordinal`.
- **Hard cap: 80,000 chars of content per file** — truncate before chunking. Large files (exported conversations, long logs) can otherwise block the main thread for seconds.

## 2. Markdown-aware chunking algorithm

> ⚠️ **Critical gotcha: Do NOT use backtracking regexes to find code fences.** The pattern `/[\s\S]*?\n\1/gm` causes catastrophic backtracking on files with unclosed code fences (a common note-in-progress pattern), hanging the main thread for minutes. Use an **O(n) line-scanner state machine** instead:

```
Correct approach (line scanner, no regex backtracking):
  inFence = false; fencePrefix = ''; rangeStart = 0;
  for each line:
    if !inFence and line starts with ``` or ~~~: inFence=true, record rangeStart
    if inFence and line starts with fencePrefix[0].repeat(3): inFence=false, push range
  if inFence at EOF: push range to end-of-file (handle unclosed fences gracefully)
```

Full algorithm:
```
1. Parse frontmatter: extract title (fallback to filename) and tags; the frontmatter itself
   does not go into the body embedding.
2. Pre-scan and mark protected ranges using the O(n) line scanner above.
   Protected: fenced code, tables (lines starting with |), $$ math.
3. Split the body by headings (#..######) into sections; record each section's heading path
   (e.g. "Project > Architecture > Indexing").
4. Within a section, window-split:
   - Accumulate paragraphs until near the target size; if a protected range is hit, include it
     whole (even if it exceeds the target — never split it).
   - Overlap adjacent chunks by ~1 paragraph or ~60–100 chars.
5. Text cleanup (only for the embedding copy; does NOT change the snippet's raw text):
   - `[[link|alias]]` -> use the alias or link name's readable text; `![[embed]]` -> drop or
     keep its filename text.
   - Remove pure-symbol Markdown noise (*, #, >, -, ...) while keeping the readable words.
   - Collapse extra whitespace.
6. Compute contentHash (over the cleaned text) for incremental diffing.
7. Store snippet as the raw (pre-cleanup) text segment (for display — preserve readable
   formatting and highlight positioning).
```
**Short notes** (a single chunk below target size): the whole note is one chunk. **Long, heading-less** notes: fall back to character-window splitting.


## 3. Context-prefix strategy (improves recall, doesn't pollute display)
Before embedding, prepend a **light context header** to each chunk's text, **used only to generate the vector**; `snippet` still stores the raw original:
```
embed input = `"{title}" > {heading}\n{cleaned body}`
```
Rationale: an isolated segment lacks a topic anchor; adding "title > section" markedly improves relevance (contextual chunking). Never show this prefix in the UI.

## 4. `.canvas` structure & extraction (the differentiating capability)
Obsidian Canvas is JSON:
```jsonc
{
  "nodes": [
    { "id": "a1", "type": "text", "text": "content written directly in the card…", "x":0,"y":0,"width":250,"height":120 },
    { "id": "b2", "type": "file", "file": "notes/some-note.md" },
    { "id": "c3", "type": "link", "url": "https://..." },
    { "id": "d4", "type": "group", "label": "group name" }
  ],
  "edges": [ { "id":"e1","fromNode":"a1","toNode":"b2" } ]
}
```
Extraction rules:
- `type === "text"` → **core**: treat `text` as content with `sourceType:'canvas'`, chunked per §2 (usually one card = one chunk). `source = <canvasPath>`, record `nodeId` in id/meta, title from the Canvas filename. **This is the capability most off-the-shelf plugins lack and the user explicitly wants.**
- `type === "file"` → its content is already covered by indexing the referenced `.md`; **do not re-embed**. Optionally record "this note appears in canvas X" for richer display, but don't duplicate in the store.
- `type === "link"` → store only the url text; usually not embedded (unless the user opts in).
- `type === "group"` → use `label` as extra heading context for its contained nodes (optional enhancement).
- Watch `.canvas` create/modify/delete/rename, going through the same incremental pipeline as `.md`.

## 5. Provenance & display
- A Canvas-sourced result card shows: "from canvas: {canvasName} · card"; clicking it opens the `.canvas` (ideally scrolled to the node; if that API is awkward, at least open the canvas and show a Notice).
- A note-sourced card shows the title and time.
- Everything is carried uniformly via `VecRecord`'s `sourceType/source/title/heading/snippet`; the UI switches badge and open-behavior based on `sourceType`.
