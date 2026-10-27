/**
 * Acceso de invitado a la demostración (D-76). El invitado NO entra directo: debe escribir el usuario y la clave de la demostración, que viven en variables
 * de entorno (DEMO_USER y DEMO_PASSWORD_HASH, nunca en el código). Si son correctos se le entrega una cookie firmada (httpOnly, 12 horas) que solo permite ver
 * los datos de demostración: no es una cuenta, no escribe nada y no ve ningún estudio real.
 *
 * DEMO_PASSWORD_HASH tiene la forma «scrypt$<sal en hex>$<hash en hex>» (ver scripts/hash-password.ts). GUEST_SESSION_SECRET (≥ 32 caracteres) firma la cookie.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const GUEST_COOKIE = "ba_guest";
export const GUEST_TTL_SECONDS = 12 * 60 * 60;

const secret = () => process.env.GUEST_SESSION_SECRET ?? "";
/** ¿Están configurados el usuario, la clave y el secreto de la demostración? */
export const guestConfigured = () => Boolean(process.env.DEMO_USER && process.env.DEMO_PASSWORD_HASH && secret().length >= 32);

const mac = (exp: number) => createHmac("sha256", secret()).update(`guest.${exp}`).digest("base64url");
const same = (a: string, b: string) => { const [x, y] = [Buffer.from(a), Buffer.from(b)]; return x.length === y.length && timingSafeEqual(x, y); };

/** Valor de la cookie de invitado: «expiración.firma». */
export function signGuest(now = Date.now()): { value: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + GUEST_TTL_SECONDS;
  return { value: `${exp}.${mac(exp)}`, maxAge: GUEST_TTL_SECONDS };
}
/** ¿La cookie es auténtica y no ha vencido? */
export function verifyGuest(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || secret().length < 32) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!sig || !Number.isInteger(exp) || exp * 1000 < now) return false;
  return same(sig, mac(exp));
}

/** Hash de una clave (para guardarlo en DEMO_PASSWORD_HASH). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}
const VERIFY_DUMMY = hashPassword("sin-usuario");
/** Compara una clave con su hash en tiempo constante. */
export function checkPassword(password: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  if (want.length === 0) return false;
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
  return timingSafeEqual(got, want);
}

/** Usuario y clave de la demostración. Siempre calcula el hash (con o sin usuario correcto) para no revelar cuál de los dos falló por el tiempo de respuesta. */
export function checkDemoLogin(user: string, password: string): boolean {
  if (!guestConfigured()) return false;
  const userOk = same(user.trim().toLowerCase(), (process.env.DEMO_USER ?? "").trim().toLowerCase());
  const passOk = checkPassword(password, userOk ? process.env.DEMO_PASSWORD_HASH! : VERIFY_DUMMY);
  return userOk && passOk;
}
