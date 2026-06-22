import { httpJson, withRetry } from "../util/http";
import type { EmbeddingProvider } from "./types";

export class OllamaProvider implements EmbeddingProvider {
  id = "ollama" as const;
  model: string;
  dimensions: number | null = null;
  maxBatch = 32;

  private baseUrl: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];

    // Process in batches of maxBatch
    for (let i = 0; i < texts.length; i += this.maxBatch) {
      const batch = texts.slice(i, i + this.maxBatch);
      const res = await withRetry(() =>
        httpJson({
          url: `${this.baseUrl}/api/embed`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, input: batch }),
          timeoutMs: 120000,
        })
      );

      const embeddings: number[][] = res.embeddings;
      if (!embeddings || embeddings.length === 0) {
        throw new Error("Ollama 返回了空的嵌入结果");
      }

      // Backfill dimensions from first response
      if (this.dimensions === null) {
        this.dimensions = embeddings[0].length;
      }

      for (const emb of embeddings) {
        results.push(new Float32Array(emb));
      }
    }

    return results;
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await httpJson({
        url: `${this.baseUrl}/api/tags`,
        method: "GET",
        timeoutMs: 10000,
      });
      return (res.models as Array<{ name: string }>)?.map(m => m.name) ?? [];
    } catch {
      return [];
    }
  }

  async test(): Promise<{ ok: boolean; message: string; dimensions?: number }> {
    if (!this.model) {
      return { ok: false, message: "请先选择一个模型" };
    }
    try {
      const res = await httpJson({
        url: `${this.baseUrl}/api/embed`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: ["tacit knowledge"] }),
        timeoutMs: 15000,
      });
      const dim = res.embeddings?.[0]?.length;
      this.dimensions = dim ?? null;
      return { ok: true, message: `已连接 · ${dim} 维`, dimensions: dim };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("refused") || msg.includes("ECONNREFUSED") || msg.includes("fetch")) {
        return { ok: false, message: "无法连接 Ollama，请确认服务正在运行" };
      }
      return { ok: false, message: msg };
    }
  }
}
