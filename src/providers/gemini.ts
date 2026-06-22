import { httpJson, withRetry } from "../util/http";
import type { EmbeddingProvider } from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements EmbeddingProvider {
  id = "gemini" as const;
  model: string;
  dimensions: number | null = null;
  maxBatch = 100; // Google's conservative limit

  private apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    // Normalize — accept "text-embedding-004" or "models/text-embedding-004"
    this.model = model.startsWith("models/") ? model : `models/${model}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += this.maxBatch) {
      const batch = texts.slice(i, i + this.maxBatch);

      const body = {
        requests: batch.map(text => ({
          model: this.model,
          content: { parts: [{ text }] },
        })),
      };

      const res = await withRetry(() =>
        httpJson({
          url: `${GEMINI_BASE}/${this.model}:batchEmbedContents`,
          method: "POST",
          // Auth via header, NEVER via query param (privacy rule)
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
          timeoutMs: 60000,
        })
      );

      const embeddings: Array<{ values: number[] }> = res.embeddings;
      if (!embeddings) throw new Error("Gemini 返回了空的嵌入结果");

      if (this.dimensions === null && embeddings.length > 0) {
        this.dimensions = embeddings[0].values.length;
      }

      for (const emb of embeddings) {
        results.push(new Float32Array(emb.values));
      }
    }

    return results;
  }

  async test(): Promise<{ ok: boolean; message: string; dimensions?: number }> {
    if (!this.apiKey) return { ok: false, message: "请填写 Gemini API Key" };
    if (!this.model) return { ok: false, message: "请填写模型名称" };
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
