# Tacit — Obsidian Semantic Connections Plugin

## Quick reference

**Build**: `npm run build` (TypeScript check + esbuild → `dist/`)  
**Dev**: `npm run dev` (watch mode; install at `<vault>/.obsidian/plugins/tacit/`)  
**Output**: `dist/main.js`, `dist/manifest.json`, `dist/styles.css`

## Where knowledge lives

Full product vision, architecture decisions, and implementation guidance live in the skill files:

- `.claude/skills/tacit-connections/SKILL.md` — product core, engineering overview, phased build plan
- `.claude/skills/tacit-connections/architecture.md` — scaffold boilerplate, vector store, index orchestration
- `.claude/skills/tacit-connections/implementation-notes.md` — **bugs fixed, UI decisions, CSS gotchas** (read this before touching store/indexer/find-modal/result-item)
- `.claude/skills/tacit-connections/providers.md` — provider endpoints, request shapes, auth
- `.claude/skills/tacit-connections/ux-and-philosophy.md` — interaction specs, microcopy, the six tacit-knowledge principles
- `.claude/skills/tacit-connections/canvas-and-chunking.md` — chunking algorithm, Canvas parsing

## Key constraints (never violate)

1. **All user-facing strings in Simplified Chinese.** English for code identifiers only.
2. **All HTTP via `util/http.ts` → `requestUrl()`**. Never use `fetch` (CORS).
3. **Never mix vectors from different fingerprints** — model switch must trigger full rebuild.
4. **Snippet display always uses chunk `::0`** (note beginning), not the highest-scoring chunk.
5. Obsidian default `<button>` overrides `background: transparent` — use `!important` to force it.
