import type { EmbeddingProvider } from "./types";
import type { TacitSettings } from "../settings";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";

export function createProvider(settings: TacitSettings): EmbeddingProvider {
  switch (settings.provider) {
    case "ollama":
      return new OllamaProvider(settings.ollamaBaseUrl, settings.ollamaModel);

    case "openai":
      return new OpenAIProvider({
        id: "openai",
        baseUrl: "https://api.openai.com",
        apiKey: settings.openaiKey,
        model: settings.openaiModel,
        dimensions: 1024, // default dimension reduction for text-embedding-3-*
      });

    case "openrouter":
      return new OpenAIProvider({
        id: "openrouter",
        baseUrl: "https://openrouter.ai/api",
        apiKey: settings.openrouterKey,
        model: settings.openrouterModel,
      });

    case "openai-compat":
      return new OpenAIProvider({
        id: "openai-compat",
        baseUrl: settings.compatBaseUrl,
        apiKey: settings.compatKey,
        model: settings.compatModel,
      });

    case "gemini":
      return new GeminiProvider(settings.geminiKey, settings.geminiModel);

    default:
      throw new Error(`未知的 provider: ${settings.provider}`);
  }
}
