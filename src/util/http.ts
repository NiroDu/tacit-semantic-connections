import { requestUrl, RequestUrlParam } from "obsidian";

// ── HTTP Error ──────────────────────────────────────────
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function extractErr(res: { status: number; text?: string; json?: any }): string {
  try {
    const j = res.json;
    return j?.error?.message ?? j?.message ?? j?.error ?? `HTTP ${res.status}`;
  } catch {
    return res.text?.slice(0, 200) ?? `HTTP ${res.status}`;
  }
}

function readableHttpError(status: number, msg: string): string {
  if (status === 401) return `无效的 API Key（401）`;
  if (status === 403) return `权限不足（403）`;
  if (status === 404) return `模型或地址不存在（404）—— ${msg}`;
  if (status === 429) return `请求速率限制（429），稍后重试`;
  if (status >= 500) return `服务器错误（${status}）`;
  return `${msg}（${status}）`;
}

// ── Core HTTP wrapper ───────────────────────────────────
export async function httpJson(
  p: RequestUrlParam & { timeoutMs?: number }
): Promise<any> {
  const timeout = p.timeoutMs ?? 60000;

  const res = await Promise.race([
    requestUrl({ throw: false, ...p }),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`请求超时（${timeout}ms）`)), timeout)
    ),
  ]);

  if (res.status >= 400) {
    const msg = extractErr(res);
    throw new HttpError(res.status, readableHttpError(res.status, msg));
  }
  return res.json;
}

// ── pLimit — simple concurrency gate ───────────────────
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const fn = queue.shift()!;
    fn();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          active--;
          next();
        }
      });
      next();
    });
  };
}

// ── withRetry — exponential backoff + jitter ───────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {}
): Promise<T> {
  const { retries = 3, baseMs = 500 } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const isRetryable =
        e instanceof HttpError
          ? e.status === 429 || e.status >= 500
          : true; // timeout / network

      if (!isRetryable || attempt === retries) throw e;

      const delay = baseMs * Math.pow(2, attempt) + Math.random() * 200;
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
