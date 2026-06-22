# Tacit — Semantic Connections

> 📖 [中文文档](./README-zh.md)

> "We can know more than we can tell." — Michael Polanyi

Tacit is an Obsidian plugin that surfaces **connections in your vault you didn't know existed**. Manual `[[wikilinks]]` only capture relationships you're already aware of — but the half-forgotten associations lurking at the edges of a years-long vault are often the most valuable.

Tacit's design philosophy is rooted in Polanyi's theory of _tacit knowledge_:

- **Passive emergence, not active querying.** Related notes appear quietly in the sidebar as you write. Connections surface from the periphery of your vision — no question required.
- **Embrace forgetting and serendipity.** Serendipity mode deliberately surfaces old notes you've nearly forgotten — precisely where the most valuable tacit connections hide.
- **Drag to link.** Drag a result into your current note to automatically insert a `[[link]]`, making the implicit explicit.

---

## Features

- **Related Notes Panel** (core): Open any note and instantly see a semantically ranked list of related notes in the right sidebar — no action needed
- **Serendipity Mode**: Reduces similarity weighting and boosts older notes, letting forgotten connections resurface
- **Pin Panel**: Pin the current results so your reference stays fixed as you navigate between notes
- **Active Search**: Invoke the command palette to open a natural-language semantic search box
- **Re-ranking** (optional): After vector retrieval, a dedicated Reranker re-scores and re-orders results for significantly improved relevance; supports Jina Reranker and Cohere Rerank
- **AI Q&A**: Ask questions answered exclusively from your own notes — no external information introduced; all sources shown
- **Canvas Support**: Indexes text cards inside `.canvas` files so nothing is missed
- **Local-first**: Uses local Ollama by default — data never leaves your device; also supports OpenAI, OpenRouter, Gemini, and any OpenAI-compatible endpoint

---

## Installation

Not yet listed on the Obsidian Community Plugins marketplace. Install manually:

1. Go to [Releases](https://github.com/nirodu/tacit/releases) and download the latest `main.js`, `manifest.json`, and `styles.css`
2. Create the directory `.obsidian/plugins/tacit/` inside your Vault
3. Place the three files in that directory
4. In Obsidian → Settings → Community Plugins, enable **Tacit — Semantic Connections**

---

## Embedding Provider Configuration

The plugin requires an embedding model to convert notes into vectors. The following providers are supported:

### Ollama (Local)

The simplest option — data stays entirely on your machine, no API key required.

1. Install [Ollama](https://ollama.ai)
2. Pull an embedding model. `bge-m3` is recommended for balanced multilingual support:
   ```
   ollama pull bge-m3:latest
   ```
3. In plugin settings, select Provider → Ollama, choose your model from the dropdown, and click "Test Connection"

> For primarily Chinese notes, `bge-m3:latest` or `shaw/dmeta-embedding-zh` is recommended.

### OpenAI

Enter your API Key in settings and select a model (e.g., `text-embedding-3-small`).

### OpenRouter

Enter your OpenRouter API Key and select a model that supports embeddings.

### Gemini

Enter your Google API Key and select a model such as `text-embedding-004`.

### Generic OpenAI-Compatible Endpoint

Enter a Base URL and optional API Key. Works with DeepSeek, SiliconFlow, Qwen, or any OpenAI-format-compatible embedding endpoint.

---

## Re-ranking Configuration (Optional)

Re-ranking is an optional enhancement layer on top of vector retrieval: the embedding index quickly recalls candidate notes, then a dedicated Reranker model precisely scores and re-orders the candidates for significantly improved relevance. Enabling this adds one extra API call per query.

Enable it in Plugin Settings → **Re-ranking (Optional)** and choose a provider:

### Jina Reranker

1. Sign up and get an API Key at [jina.ai](https://jina.ai)
2. In plugin settings, select Service → **Jina Reranker** and enter your API Key
3. Recommended model: `jina-reranker-v2-base-multilingual` (excellent for both Chinese and English)

### Cohere Rerank

1. Sign up and get an API Key at [cohere.com](https://cohere.com)
2. In plugin settings, select Service → **Cohere Rerank** and enter your API Key
3. Recommended model: `rerank-v3.5`

> Re-ranking only affects the Related Notes Panel and Active Search results — it does not affect embedding generation or storage.

---

## AI Q&A Configuration

AI Q&A is an optional feature requiring an additional chat model (which can differ from the embedding provider).

Supports: Ollama (local chat models), OpenAI, OpenRouter, Gemini, and generic compatible endpoints.

> AI Q&A uses only note excerpts retrieved via vector search as context — no information outside your vault is introduced. All source notes are displayed below the answer.

---

## Privacy

- All API Keys are stored in plaintext in the Obsidian plugin data file (`.obsidian/plugins/tacit/data.json`) — do not sync this file to a public repository
- When using cloud providers, note text excerpts are sent to the respective provider's API; when using Ollama, data stays entirely on your machine
- Vector index files (`index.bin`, `index.meta.json`, `build-state.json`) are saved in the plugin directory by default and **will not** sync with your Vault

---

## Development

```bash
git clone https://github.com/nirodu/tacit
cd tacit
npm install

# Development mode (hot reload)
npm run dev

# Production build
npm run build
```

Symlink or copy the plugin directory to `<your-vault>/.obsidian/plugins/tacit/`. Combined with the [Hot-Reload](https://github.com/pjeby/hot-reload) community plugin, changes will reload automatically on save.

Build output goes to `dist/`.

---

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/):

- **Attribution**: Any use or modification must credit the original author (nirodu) and link to the source repository
- **NonCommercial**: May not be used for commercial purposes
- **ShareAlike**: Derivative works must be released under the same license

Copyright (c) nirodu &lt;nirodu1219@outlook.com&gt;
