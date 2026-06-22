import type { TacitSettings } from "../settings";
import { httpJson } from "../util/http";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Send a chat completion request using whichever provider is configured for AI 问答.
 * Reuses all existing API keys and base-URLs from TacitSettings.
 */
export async function chatCompletion(
  settings: TacitSettings,
  messages: ChatMessage[],
): Promise<string> {
  const model = settings.findChatModel;
  if (!model) throw new Error("未配置 AI 问答模型，请前往设置 → 查找填写");

  switch (settings.findChatProvider) {
    case "ollama":
      return ollamaChat(settings.ollamaBaseUrl, model, messages);

    case "openai":
      if (!settings.openaiKey) throw new Error("未配置 OpenAI API Key");
      return openaiChat("https://api.openai.com/v1", settings.openaiKey, model, messages);

    case "openrouter":
      if (!settings.openrouterKey) throw new Error("未配置 OpenRouter API Key");
      return openaiChat("https://openrouter.ai/api/v1", settings.openrouterKey, model, messages, {
        "HTTP-Referer": "obsidian://tacit",
        "X-Title": "Tacit",
      });

    case "openai-compat": {
      const base = settings.compatBaseUrl.replace(/\/+$/, "");
      return openaiChat(base, settings.compatKey, model, messages);
    }

    case "gemini":
      if (!settings.geminiKey) throw new Error("未配置 Gemini API Key");
      return geminiChat(settings.geminiKey, model, messages);

    default:
      throw new Error(`AI 问答不支持此 Provider: ${settings.findChatProvider}`);
  }
}

// ── Ollama (/api/chat, non-streaming) ────────────────────

async function ollamaChat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const res = await httpJson({
    url: `${baseUrl.replace(/\/+$/, "")}/api/chat`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    timeoutMs: 120_000,
  });
  return res?.message?.content ?? "";
}

// ── OpenAI-compatible (/v1/chat/completions) ─────────────
// Covers OpenAI, OpenRouter, and generic-compat providers.

async function openaiChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const res = await httpJson({
    url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({ model, messages }),
    timeoutMs: 120_000,
  });
  return res?.choices?.[0]?.message?.content ?? "";
}

// ── Gemini (generateContent) ─────────────────────────────

async function geminiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const systemMsg = messages.find(m => m.role === "system");
  const turns = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = { contents: turns };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const res = await httpJson({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 120_000,
  });
  return res?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
