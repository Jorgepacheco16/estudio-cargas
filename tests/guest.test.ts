import { GUEST_TTL_SECONDS, checkDemoLogin, checkPassword, guestConfigured, hashPassword, signGuest, verifyGuest } from "../src/lib/guest";
import { isBlocked, recordFailure } from "../src/lib/ratelimit";
import { check, summary } from "./helpers";

/** Acceso de invitado (D-76): cookie firmada, vencimiento, hash de la clave y comprobación del usuario y la clave de la demostración. */
const SECRET = "x".repeat(40);

async function main() {
  const env = { ...process.env };
  await check("Sin configuración (usuario, hash o secreto) el acceso de invitado NO funciona y ninguna cookie es válida", () => {
    delete process.env.DEMO_USER; delete process.env.DEMO_PASSWORD_HASH; delete process.env.GUEST_SESSION_SECRET;
    if (guestConfigured() || checkDemoLogin("demo", "x") || verifyGuest("1999999999.abc")) throw new Error("abrió sin configuración");
    process.env.GUEST_SESSION_SECRET = "corto";
    if (guestConfigured()) throw new Error("aceptó un secreto corto");
  });

  process.env.GUEST_SESSION_SECRET = SECRET; process.env.DEMO_USER = "Invitado.Demo"; process.env.DEMO_PASSWORD_HASH = hashPassword("Clave-de-prueba-123");

  await check("La clave se guarda con scrypt y sal propia (dos hashes de la misma clave son distintos) y solo la clave correcta coincide", () => {
    const [a, b] = [hashPassword("abc"), hashPassword("abc")];
    if (a === b || !a.startsWith("scrypt$")) throw new Error("sin sal");
    if (!checkPassword("abc", a) || checkPassword("abd", a) || checkPassword("", a) || checkPassword("abc", "no-es-un-hash")) throw new Error("coincidencia");
  });

  await check("Usuario y clave de la demostración: sin distinguir mayúsculas en el usuario ni espacios sobrantes; clave o usuario erróneos se rechazan", () => {
    if (!guestConfigured()) throw new Error("debía estar configurado");
    if (!checkDemoLogin("  invitado.demo ", "Clave-de-prueba-123")) throw new Error("rechazó las credenciales correctas");
    for (const [u, p] of [["invitado.demo", "clave-de-prueba-123"], ["otro", "Clave-de-prueba-123"], ["", ""], ["invitado.demo", ""]]) if (checkDemoLogin(u, p)) throw new Error(`aceptó «${u}» / «${p}»`);
  });

  await check("Cookie de invitado: válida 12 horas; vencida, alterada, de otro secreto o mal formada se rechazan", () => {
    const t0 = 1_800_000_000_000;
    const { value, maxAge } = signGuest(t0);
    if (maxAge !== GUEST_TTL_SECONDS || !verifyGuest(value, t0 + 1000) || !verifyGuest(value, t0 + (GUEST_TTL_SECONDS - 5) * 1000)) throw new Error("debía ser válida");
    if (verifyGuest(value, t0 + (GUEST_TTL_SECONDS + 5) * 1000)) throw new Error("aceptó una cookie vencida");
    const [exp, sig] = value.split(".");
    if (verifyGuest(`${Number(exp) + 3600}.${sig}`, t0)) throw new Error("aceptó una expiración alterada");
    if (verifyGuest(`${exp}.${sig.slice(0, -2)}AA`, t0)) throw new Error("aceptó una firma alterada");
    for (const bad of ["", "abc", "1.2.3", `.${sig}`, `x.${sig}`, undefined, null]) if (verifyGuest(bad as string, t0)) throw new Error(`aceptó «${bad}»`);
    process.env.GUEST_SESSION_SECRET = "y".repeat(40);
    if (verifyGuest(value, t0 + 1000)) throw new Error("aceptó una cookie firmada con otro secreto");
  });
  await check("Límite de intentos fallidos: se bloquea tras 8 fallos en la ventana, entrar bien no gasta intentos y la ventana vence", () => {
    const k = `prueba-${Math.random()}`, t0 = 1_000_000;
    for (let i = 0; i < 7; i++) recordFailure(k, 60_000, t0 + i);
    if (isBlocked(k, 8, t0 + 10)) throw new Error("bloqueó antes de tiempo");
    for (let i = 0; i < 40; i++) if (isBlocked(k, 8, t0 + 20)) throw new Error("consultar no debe gastar intentos");
    recordFailure(k, 60_000, t0 + 30);
    if (!isBlocked(k, 8, t0 + 40)) throw new Error("no bloqueó al octavo fallo");
    if (isBlocked(k, 8, t0 + 61_000)) throw new Error("la ventana debía vencer");
    if (isBlocked("otro-origen", 8, t0)) throw new Error("bloqueó a otro origen");
  });
  process.env = env;
}
main().then(summary);
