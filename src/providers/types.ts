// ── Provider interfaces ──────────────────────────────────

export interface EmbeddingProvider {
  id: "ollama" | "openai" | "openrouter" | "gemini" | "openai-compat";
  model: string;
  dimensions: number | null;   // unknown until first response backfills it
  maxBatch: number;            // max items per request

  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
  listModels?(): Promise<string[]>;
  test(): Promise<{ ok: boolean; message: string; dimensions?: number }>;
}

export interface RerankResult {
  index: number;
  score: number;
}

export interface RerankProvider {
  id: string;
  model: string;
  rerank(
    query: string,
    docs: string[],
    signal?: AbortSignal
  ): Promise<RerankResult[]>;
}
