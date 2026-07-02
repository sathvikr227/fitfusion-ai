const DEFAULT_TIMEOUT_MS = 2000

export type MLCallResult<T> = {
  data: T
  fromFallback: boolean
  reason?: string
}

function getConfig() {
  const url = process.env.ML_SERVICE_URL
  const key = process.env.ML_SERVICE_API_KEY
  return { url, key }
}

export async function callMLService<TReq, TRes>(
  path: string,
  body: TReq,
  fallback: (reason: string) => Promise<TRes> | TRes,
  opts: { timeoutMs?: number } = {}
): Promise<MLCallResult<TRes>> {
  const { url, key } = getConfig()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!url || !key) {
    const reason = "ml-service-not-configured"
    console.warn(`[ml-service] fallback: ${reason}`)
    return { data: await fallback(reason), fromFallback: true, reason }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    })
    if (!res.ok) {
      const reason = `http-${res.status}`
      console.warn(`[ml-service] fallback: ${reason} at ${path}`)
      return { data: await fallback(reason), fromFallback: true, reason }
    }
    const data = (await res.json()) as TRes
    return { data, fromFallback: false }
  } catch (err: unknown) {
    const reason =
      err instanceof DOMException && err.name === "AbortError"
        ? "timeout"
        : err instanceof Error
          ? `fetch-error:${err.message}`
          : "fetch-error:unknown"
    console.warn(`[ml-service] fallback: ${reason} at ${path}`)
    return { data: await fallback(reason), fromFallback: true, reason }
  } finally {
    clearTimeout(timer)
  }
}

export async function pingMLService(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { url } = getConfig()
  if (!url) return { ok: false, error: "ML_SERVICE_URL not set" }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(`${url}/healthz`, { signal: ctrl.signal, cache: "no-store" })
    clearTimeout(timer)
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" }
  }
}
