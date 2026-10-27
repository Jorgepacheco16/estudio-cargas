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

/**
 * Límite solo de intentos FALLIDOS (ingreso, D-76): entrar bien no gasta intentos, así que quien ingresa correctamente muchas veces seguidas no se bloquea,
 * pero quien adivina claves queda detenido después de `max` fallos en la ventana.
 */
export function isBlocked(key: string, max: number, now = Date.now()): boolean {
  const h = hits.get(key);
  return !!h && h.reset > now && h.n >= max;
}
export function recordFailure(key: string, windowMs: number, now = Date.now()): void {
  const h = hits.get(key);
  if (!h || h.reset <= now) hits.set(key, { n: 1, reset: now + windowMs });
  else h.n++;
}
