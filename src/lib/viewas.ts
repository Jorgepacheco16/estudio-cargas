/**
 * «Ver como este usuario» (D-91): el Super usuario ve la aplicación tal como la vería otra persona, SOLO LECTURA. Una cookie firmada (httpOnly, 30 minutos) dice a quién
 * imita y quién lo pidió; getUser() devuelve a esa persona (así todas las consultas pasan por sus permisos reales) y la base de datos rechaza cualquier escritura
 * porque la transacción se abre en modo de solo lectura (ver withRls). La cookie solo sirve con la sesión del Super usuario que la creó.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const VIEWAS_COOKIE = "ba_viewas";
export const VIEWAS_TTL_SECONDS = 30 * 60;
const secret = () => process.env.GUEST_SESSION_SECRET ?? "";
export const viewAsConfigured = () => secret().length >= 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mac = (admin: string, target: string, exp: number) => createHmac("sha256", secret()).update(`viewas.${admin}.${target}.${exp}`).digest("base64url");
const same = (a: string, b: string) => { const [x, y] = [Buffer.from(a), Buffer.from(b)]; return x.length === y.length && timingSafeEqual(x, y); };

/** Valor de la cookie: «admin.persona.expiración.firma». */
export function signViewAs(adminId: string, targetId: string, now = Date.now()): { value: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + VIEWAS_TTL_SECONDS;
  return { value: `${adminId}.${targetId}.${exp}.${mac(adminId, targetId, exp)}`, maxAge: VIEWAS_TTL_SECONDS };
}
/** Devuelve a quién se imita si la cookie es auténtica, no venció y la pidió esta misma sesión; si no, null. */
export function verifyViewAs(token: string | undefined | null, sessionUserId: string | null, now = Date.now()): { adminId: string; targetId: string } | null {
  if (!token || !viewAsConfigured()) return null;
  const [admin, target, expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!admin || !target || !sig || !UUID.test(admin) || !UUID.test(target) || !Number.isInteger(exp) || exp * 1000 < now) return null;
  if (sessionUserId !== null && sessionUserId !== admin) return null;
  return same(sig, mac(admin, target, exp)) ? { adminId: admin, targetId: target } : null;
}
