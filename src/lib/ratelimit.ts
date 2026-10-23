/**
 * Límite de tasa por ventana fija, en memoria. En Vercel cada instancia lleva su propio contador: frena ráfagas desde
 * un mismo origen, pero no es un límite global. Un límite global exigiría un almacén compartido (decisión pendiente).
 */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfter: number } {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); return { ok: true, retryAfter: 0 }; }
  h.n++;
  return h.n <= max ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.ceil((h.reset - now) / 1000) };
}
