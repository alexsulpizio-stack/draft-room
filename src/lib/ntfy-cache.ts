type Cached = { at: number; text: string; status: number };

const GET_CACHE = new Map<string, Cached>();
const MIN_GET_MS = 8000;

/** Share ntfy GETs across listen / ranks / peek so the free plan is not 429'd. */
export async function pollNtfyJson(url: string, timeoutMs = 8000): Promise<string> {
  const hit = GET_CACHE.get(url);
  if (hit && Date.now() - hit.at < MIN_GET_MS) return hit.text;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429) {
      return hit?.text ?? "";
    }
    const text = res.ok ? await res.text() : "";
    GET_CACHE.set(url, { at: Date.now(), text, status: res.status });
    return text;
  } catch {
    return hit?.text ?? "";
  }
}

export async function postNtfy(url: string, body: string, timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
