import { createHmac, timingSafeEqual } from "node:crypto";
/** Firma = HMAC-SHA256(secreto, `${timestamp}.${cuerpoCrudo}`) en hexadecimal. Rechaza eventos viejos (anti-replay). */
export function sign(rawBody: string, timestampMs: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestampMs}.${rawBody}`).digest("hex");
}
export function verifySignature(rawBody: string, signatureHex: string, timestampMs: number, secret: string, nowMs = Date.now(), toleranceMs = 5 * 60_000): boolean {
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > toleranceMs) return false;
  const expected = Buffer.from(sign(rawBody, timestampMs, secret), "hex"); const got = Buffer.from(signatureHex, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
