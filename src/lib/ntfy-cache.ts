type Cached = { at: number; text: string; status: number };

const GET_CACHE = new Map<string, Cached>();
const MIN_GET_MS = 8000;
const MAX_STALE_MS = 120_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(res: Response, attempt: number) {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5000, seconds * 1000);
  }
  return Math.min(4000, 500 * 2 ** attempt);
}

/** Share ntfy GETs across listen / ranks / peek so the free plan is not 429'd. */
export async function pollNtfyJson(url: string, timeoutMs = 8000): Promise<string> {
  const hit = GET_CACHE.get(url);
  if (hit && Date.now() - hit.at < MIN_GET_MS) return hit.text;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const text = await res.text();
        GET_CACHE.set(url, { at: Date.now(), text, status: res.status });
        return text;
      }
      if (!RETRYABLE.has(res.status) || attempt === 2) break;
      await sleep(retryDelay(res, attempt));
    } catch {
      if (attempt === 2) break;
      await sleep(Math.min(4000, 500 * 2 ** attempt));
    }
  }

  if (hit && Date.now() - hit.at < MAX_STALE_MS) return hit.text;
  return "";
}

/** Server-side ntfy publish with short retry/backoff for rate limits and transient failures. */
export async function postNtfy(url: string, body: string, timeoutMs = 8000): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return true;
      if (!RETRYABLE.has(res.status) || attempt === 2) return false;
      await sleep(retryDelay(res, attempt));
    } catch {
      if (attempt === 2) return false;
      await sleep(Math.min(4000, 500 * 2 ** attempt));
    }
  }
  return false;
}
