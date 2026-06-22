import { httpJson, withRetry } from "../util/http";
import type { EmbeddingProvider } from "./types";

/**
 * Covers OpenAI, OpenRouter, and any generic OpenAI-compatible endpoint.
 * Differentiated solely by baseUrl + headers.
 */
export class OpenAIProvider implements EmbeddingProvider {
  id: "openai" | "openrouter" | "openai-compat";
  model: string;
  dimensions: number | null = null;
  maxBatch = 64;

  private baseUrl: string;
  private headers: Record<string, string>;
  private dimensionParam: number | undefined;

  constructor(opts: {
    id: "openai" | "openrouter" | "openai-compat";
    baseUrl: string;
    apiKey: string;
    model: string;
    dimensions?: number;
  }) {
    this.id = opts.id;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    this.dimensionParam = opts.dimensions;

    this.headers = {
      "Content-Type": "application/json",
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    };

    if (opts.id === "openrouter") {
      this.headers["HTTP-Referer"] = "https://github.com/tacit-plugin";
      this.headers["X-Title"] = "Tacit — Semantic Connections";
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += this.maxBatch) {
      const batch = texts.slice(i, i + this.maxBatch);
      const body: Record<string, unknown> = {
        model: this.model,
        input: batch,
      };
      // Only text-embedding-3-* supports the dimensions param
      if (this.dimensionParam && this.model.startsWith("text-embedding-3")) {
        body.dimensions = this.dimensionParam;
      }

      const res = await withRetry(() =>
        httpJson({
          url: `${this.baseUrl}/v1/embeddings`,
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
          timeoutMs: 60000,
        })
      );

      // Sort by index to guarantee order
      const sorted = (res.data as Array<{ embedding: number[]; index: number }>)
        .sort((a, b) => a.index - b.index);

      if (this.dimensions === null && sorted.length > 0) {
        this.dimensions = sorted[0].embedding.length;
      }

      for (const item of sorted) {
        results.push(new Float32Array(item.embedding));
      }
    }

    return results;
  }

  async test(): Promise<{ ok: boolean; message: string; dimensions?: number }> {
    if (!this.model) {
      return { ok: false, message: "请填写模型名称" };
    }
    try {
      const vecs = await this.embed(["tacit knowledge"]);
      const dim = vecs[0]?.length;
      this.dimensions = dim ?? null;
      return { ok: true, message: `已连接 · ${dim} 维`, dimensions: dim };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}
