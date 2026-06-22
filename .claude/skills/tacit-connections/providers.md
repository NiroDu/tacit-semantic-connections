# Providers — embedding & reranking adapters (exact request/response)

> All requests go through the `requestUrl` wrapper in `util/http.ts`. **Put keys in headers, never in URL query** (privacy constraint).
> Shared interface is in SKILL.md §3. Each provider implements `embed/test/(listModels)`.
> When `dimensions` is unknown, backfill it from the length of the first response vector and write it into the fingerprint.

Sections: 1) Ollama · 2) OpenAI · 3) OpenRouter · 4) Generic OpenAI-compatible · 5) Gemini · 6) Reranking · 7) Common rules (dimensions/batching/test)

---

## 1. Ollama (default, local-first)
- Base URL default `http://localhost:11434` (mobile needs a remote address).
- **Embedding**: `POST {base}/api/embed`
  ```json
  { "model": "<model>", "input": ["text 1", "text 2"] }   // input accepts string or string[]
  ```
  Response: `{ "embeddings": [[...],[...]], "model": "...", ... }` → take `embeddings`.
  (The old `/api/embeddings` endpoint takes a single `prompt` and returns `embedding`; prefer `/api/embed` for batching.)
- **List models**: `GET {base}/api/tags` → `{ "models":[{"name":"...","model":"..."}] }`.
  Populate the settings dropdown directly from this; do not hardcode model names.
- **Recommended models** (let the user pick from the dropdown; actual available tags come from `/api/tags`, so **don't assume a fixed tag name**):
  - Strong Chinese/multilingual: the Qwen3-Embedding family (community tag naming may be `qwen3-embedding` or carry an author prefix — defer to the machine's `ollama list`).
  - Safe general fallbacks: `bge-m3` (multilingual), `nomic-embed-text` (English-leaning, lightweight).
  - If no embedding model is detected on first run, show a Notice: `No embedding model found — try: ollama pull bge-m3` (bge-m3 is a safe example that also handles Chinese).
- **Concurrency**: Ollama embeddings are VRAM-bound / often serial; default concurrency 3; configurable.

## 2. OpenAI
- **Embedding**: `POST https://api.openai.com/v1/embeddings`
  Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`
  ```json
  { "model": "text-embedding-3-small", "input": ["a","b"], "dimensions": 1024 }
  ```
  `dimensions` is supported only by `text-embedding-3-*` (lets you shrink dims to save storage). Response: `{ "data":[{"embedding":[...],"index":0}, ...] }` → sort by `index`, take `embedding`.
- `maxBatch` can be large (e.g. 64–128).

## 3. OpenRouter
- Same shape as OpenAI: Base `https://openrouter.ai/api/v1`, Header `Authorization: Bearer <key>`, optionally `HTTP-Referer` and `X-Title` (used by OpenRouter for attribution). Request/response identical to OpenAI `/embeddings`.
- ⚠️ **Honest caveat**: OpenRouter is chat/completions-first, and **embedding-model availability is limited and changes over time**. Implement it as "OpenAI-compatible," but add a note in settings: "OpenRouter's embedding support is limited; confirm the chosen model supports /embeddings." Let the user verify — don't make false guarantees.

## 4. Generic OpenAI-compatible (LM Studio / vLLM / Ollama's /v1 / self-hosted)
- Identical to OpenAI; only the Base URL and headers are configurable (key may be empty). This is the escape hatch: anything that follows the OpenAI `/embeddings` protocol can connect. `openai.ts` covers §2/§3/§4 with one implementation, differentiated by config.

## 5. Gemini (Google Generative Language API)
- **Auth via header**: `x-goog-api-key: <key>` (**do not** use `?key=` in the query — violates the privacy constraint).
- **Batch embedding**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents`
  ```json
  { "requests": [
      { "model": "models/text-embedding-004", "content": { "parts": [ { "text": "a" } ] } },
      { "model": "models/text-embedding-004", "content": { "parts": [ { "text": "b" } ] } }
  ] }
  ```
  Response: `{ "embeddings": [ { "values":[...] }, { "values":[...] } ] }` → take each `values`.
- Models: `text-embedding-004` (768 dims); the newer `gemini-embedding-001` supports custom `outputDimensionality` (larger default). Take the dimension from the actual response and backfill the fingerprint.
- `maxBatch`: respect its per-request item cap (conservatively ~100; split further if too large).

## 6. Reranking (optional, off by default)
Unified interface `RerankProvider.rerank(query, docs) → [{index, score}]`. Local and cloud both map to "query + documents → per-document score."
- **Jina**: `POST https://api.jina.ai/v1/rerank` Header `Authorization: Bearer <key>`
  ```json
  { "model": "jina-reranker-v2-base-multilingual", "query": "...", "documents": ["d1","d2"], "top_n": 20 }
  ```
  Response: `{ "results":[ { "index":0, "relevance_score":0.93 }, ... ] }`.
- **Cohere**: `POST https://api.cohere.com/v2/rerank`, similar shape (`results[].relevance_score`).
- **Local Qwen3-Reranker**: Ollama has no native rerank endpoint. The pragmatic route is a small local service (llama.cpp / FastAPI wrapping a cross-encoder) exposing a **Jina-compatible** `/rerank`, then plugged in as a Jina provider. Make "local rerank" a config option pointing at a self-hosted rerank endpoint — no need to embed the model.
- Usage: retrieve embedding top-(K×3), then rerank to the top K. This step is exactly the capability Smart Connections moved behind Pro — in Tacit it's optional and free.

## 7. Common rules
- **Dimension discovery**: after the first `embed`, backfill `dimensions` from `result[0].length` and write it into the fingerprint; if a later length mismatch is detected → throw and prompt a rebuild (guards against "incomplete embedding / dimension drift").
- **Batching**: `embed(texts)` slices internally by `maxBatch` (serial/concurrent under `util/http.ts`'s pLimit), then stitches results back in order.
- **test()**: send one tiny sample (e.g. `["tacit knowledge"]`) → on success return `{ok:true, dimensions}`; on failure map the HTTP status to a readable reason (401 → invalid key; 404 → bad model name or address; connection refused → service not running / wrong address; timeout → no response). The settings "Test connection" shows this message directly.
- **Error normalization**: every provider throws `HttpError(status, message)`; upper layers know only this one type, simplifying display and retry decisions (429/5xx/timeout retryable, other 4xx not).
