# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2026-06-22

### Added

- **Related Notes Panel**: Automatically surfaces semantically related notes in the right sidebar whenever a note is opened — no action required
- **Serendipity Mode**: Boosts older, nearly-forgotten notes to help rediscover tacit connections
- **Pin Panel**: Pins the current result set so the reference stays fixed while navigating between notes
- **Active Search**: Natural-language semantic search via the command palette
- **Re-ranking** (optional): Two-stage retrieval — vector recall followed by a dedicated Reranker for significantly improved relevance; supports Jina Reranker and Cohere Rerank
- **AI Q&A**: Ask questions answered exclusively from your own vault; all source notes are cited below the answer
- **Canvas Support**: Indexes text cards inside `.canvas` files
- **Local-first**: Runs entirely on-device with Ollama by default; also supports OpenAI, OpenRouter, Gemini, and any OpenAI-compatible endpoint

### Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the Assets below
2. Create the directory `.obsidian/plugins/tacit/` inside your Vault
3. Place the three files in that directory
4. In Obsidian → Settings → Community Plugins, enable **Tacit — Semantic Connections**
