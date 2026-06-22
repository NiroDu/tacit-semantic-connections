# UX & Philosophy — turning tacit knowledge into implementable interaction

> This is the soul file. Whenever an interaction tradeoff is contested, return to the six principles in §1.
> Sections: 1) Principles → implementation · 2) Related Notes panel spec · 3) Find spec · 4) Settings IA · 5) Microcopy

**Localization note:** the user's working language is Simplified Chinese. **Ship all user-facing strings in Simplified Chinese.** The English microcopy in §5 is the canonical reference for tone and content — translate it faithfully, keeping the same restrained, gentle, second-person register.

---

## 1. The six tacit-knowledge principles → concrete design actions

| Principle | One line | What it becomes in code |
|---|---|---|
| ① Surfacing over interrogation | Benefit without asking first | Related Notes panel on by default, auto-updates on note switch; the product's default value lives on the passive side |
| ② Peripheral attention / indwelling | Connections in your peripheral vision | Right sidebar; low-contrast cards; no intrusive animation; never steal focus or auto-popup |
| ③ Embrace forgetting & serendipity | Recover links you forgot | "Serendipity" toggle = lower MMR lambda + bonus for older mtime; mix in related-but-not-most-similar items |
| ④ The tacit→explicit moment | Make codification a deliberate choice | Drag a result into the body → creates a `[[link]]`, one gesture, with a subtle landing feedback |
| ⑤ Don't over-quantify | Don't harden a "feeling" into a metric | Relatedness shown as a 3-step soft bar/dots by default; numbers hidden behind an advanced toggle |
| ⑥ Low friction = trust | Config tax kills indwelling | Connections appear as soon as Ollama is installed; first run auto-selects a model and builds the index (with visible progress) |

**Anti-pattern (explicitly avoid)**: a traditional "search box + a list of results with percentages." That violates ①②⑤ and downgrades a "companionable rediscovery" product into a "retrieval tool."

---

## 2. Related Notes panel (RelatedView) spec — the heart

### 2.1 Layout
- Right-side `ItemView` (`getViewType()='tacit-related'`, icon `links-coming-in` or custom).
- A single minimal control row on top (left→right): current note title (de-emphasized) | pause/pin toggle | serendipity toggle | refresh | gear (open settings). Icon-only + tooltip, very light visual weight.
- Body: a vertical list of result cards.
- Bottom: a one-line status (show progress while indexing; otherwise hidden).

### 2.2 Result card (result-item, shared with Find)
A single card, top to bottom:
1. **Title row**: note title (clickable). On the right, a tiny **relatedness bar** (3-step fill for high/mid/low; show the number only on hover, and only if the numeric setting is on).
2. **Meta row**: relative time "written 3 years ago · 2022-08" + a source-type badge (note/canvas). Canvas items also show "from canvas: xxx · a card".
3. **Snippet**: 1–3 lines from the best-matching chunk, with the **matched region** in a soft `--text-highlight-bg` (not bright yellow — stay restrained). Collapse overflow; expand on hover.

Interaction:
- **hover**: trigger Obsidian's native Hover Preview (`app.workspace.trigger('hover-link', ...)`; requires the user's core Page Preview).
- **drag**: `draggable=true`, dragstart writes `text/plain = "[[Note Name]]"` (or with alias `[[Note Name|Title]]`); dropping into the editor inserts the link. This is principle ④'s highlight moment — give an 80ms subtle highlight on landing.
- **click**: open the note in the current pane; **⌘/Ctrl+click** new pane; middle-click new tab.
- context menu: open in new pane / copy link / exclude this note.

### 2.3 Update timing & representation
- Listen to `active-leaf-change` and `file-open`, **debounced 300ms**. Don't update while pinned.
- Current-note representation: **prefer the mean of its already-indexed chunk vectors** (no API call, instant); if the note isn't indexed yet, show "indexing…" and fill in once its chunks are ready (or fall back to an on-the-fly embedding, gated by a setting to save tokens).
- Retrieval: chunk top-(N×4) → exclude the current file → aggregate by source taking each source's best score → MMR/truncate to N notes (default N=8).

### 2.4 Three-state copy (never blank)
- Indexing: "Building connections… 1240/3800" + ready results shown as usual.
- Empty: "No clear connections yet. Keep writing — the links will surface on their own." (echoes the core, gentle, non-accusatory).
- Error: "Connections are temporarily unavailable — {readable reason}" + a "Retry" button.

### 2.5 The felt difference of Serendipity on/off
On: lambda drops to ~0.5, older notes get a bonus, and the results should visibly include "unexpected but genuinely related" old notes. Mark such items with a tiny "↺ long lost" tag to reinforce the "recover the forgotten" experience (principle ③).

---

## 3. Find (FindModal) spec — the assistant

### 3.1 Entry & skeleton
- Command: "Tacit: Find" + an optional hotkey; an optional ribbon icon.
- A `Modal` (or `SuggestModal`-style): a top input (focused, type immediately) + a mode toggle (retrieval/synthesis) + a results area. Keyboard-first: ↑↓ to select, Enter to open, ⌘Enter new pane, Esc to close. Input debounced 250ms.

### 3.2 Retrieval mode (default)
query → embed → (optional rerank) → aggregate by note → reuse the §2.2 result card. No LLM, instant, fully local. A thin top line shows "found M hits in N notes · 12ms" (latency shown quietly to build a "fast" trust).

### 3.3 Synthesis mode (optional, needs a chat model)
- Take top note snippets, feed them to a chat model (Ollama or any provider) with a **strict system prompt**:
  > Answer using only the user's own notes provided below. After each claim, cite the source with `[[Note Name]]`. Introduce no information beyond the notes; never fabricate. If the notes are insufficient, say plainly "Your notes have no record of this."
- **Stream the output**; below it, **always show the source note cards alongside** (so the user can open and verify).
- Frame everything with "Based on what you've written:" — emphasizing this recalls the user's **own tacit knowledge**, not a generic AI answer.
- Synthesis accelerates understanding; it must not replace reading one's own text — so sources are always present.

### 3.4 Memory & lightness
Remember the last several queries (local only); on empty input, show recent queries + a prompt "Ask a question, recover what you've written."

---

## 4. Settings IA (SettingTab)

Order = priority; the higher, the more frequent. Advanced items collapsed by default.

1. **Embeddings**
   - Provider dropdown: Ollama / OpenAI / OpenRouter / Gemini / OpenAI-compatible.
   - Ollama: Base URL (default localhost:11434) + model dropdown (auto from `/api/tags`) + [Test connection].
   - Cloud: API key (password input) + Base URL (prefilled) + model + [Test connection].
   - [Test connection] shows live green/red + dimension + readable message.
2. **Reranking (optional)**: toggle + provider/endpoint/model + [Test connection]. A note that it raises precision but adds one call.
3. **Indexing**
   - Include/exclude: folders, tags (default-exclude templates/attachments).
   - Stats block: notes / chunks / failures / last updated / current model fingerprint / storage size.
   - Buttons: [Rebuild index] [Retry failed].
   - Advanced (collapsed): chunk size/overlap, concurrency, storage location, vector backend, int8 quantization toggle.
4. **Related Notes**: result count, snippet lines, default Serendipity, show-number toggle, auto-update toggle.
5. **Find**: default mode, chat model for synthesis, top-K.
6. **Privacy**: state honestly — the API key is stored in plaintext in plugin data (Obsidian does not encrypt plugin config); with local Ollama, data never leaves the machine; with a cloud provider, the embedded text is sent to that service. Give the user informed consent; don't gloss over it.

**First-run onboarding**: if Ollama is online with an embedding model → auto-select it, show "Ready — building connections," and start indexing; if not detected → a light onboarding card: install Ollama, or paste a cloud key — either one gets you started.

---

## 5. Microcopy (canonical English reference — ship as Simplified Chinese, same register)

- Panel empty title: `Connections`
- Indexing progress: `Building connections… {done}/{total}`
- Indexing complete (brief Notice): `Connections ready`
- Empty result: `No clear connections yet. Keep writing — the links will surface on their own.`
- Retrieval error: `Connections are temporarily unavailable — {reason}`
- Retry button: `Retry` / failed items: `Retry failed ({n})`
- Pause tooltip: `Pin current connections (don't refresh while wandering)`
- Serendipity tooltip: `Serendipity: recover older, less obvious links`
- Long-lost tag: `↺ long lost`
- Drag has no prompt on landing (the action is its own feedback), but on first use give a one-time Notice: `Tip: drag a connection into your note to create a link`
- Find placeholder: `Ask a question, recover what you've written`
- Find latency line: `found {hits} hits in {notes} notes · {ms}ms`
- Synthesis prefix: `Based on what you've written:`
- Synthesis no-result: `Your notes have no record of this yet.`
- Test connection success: `Connected · {dim} dimensions`
- Test connection failure: `Connection failed · {readable reason}`
- Model-change confirm: `The embedding model changed. A rebuild is required for correct results. Rebuild now?`
- Privacy note (cloud): `With a cloud model, indexed note text is sent to that service to generate vectors.`

> Consistent register: second person, light, never nagging, never showing off. Error messages always offer the next step. Show numbers quietly and never let them dominate.
