import { bumpRequestEpoch, memo, requestEpoch, sessionKeyOf } from "../src/lib/request-cache";
import { check, summary } from "./helpers";

/**
 * Caché por petición (rendimiento). Aquí se prueba lo que no depende del servidor de Next: la clave de la sesión y que, fuera de una petición de Next, NADA se recuerda
 * (cada llamada se ejecuta de verdad). Que dentro de una petición se valide la sesión una sola vez, y que ingresar, salir, «ver como» o crear un estudio nunca muestren
 * datos viejos, lo comprueba e2e/usuarios.spec.ts en un navegador real contra la aplicación compilada.
 */
async function main() {
  await check("La clave de sesión solo usa las cookies de Supabase (sb-…), en orden estable, y cambia si cambia cualquier valor", () => {
    const base = [{ name: "sb-x-auth-token.1", value: "B" }, { name: "otra", value: "1" }, { name: "sb-x-auth-token.0", value: "A" }, { name: "estudio_id", value: "9" }];
    const k = sessionKeyOf(base);
    if (k !== "sb-x-auth-token.0=A;sb-x-auth-token.1=B") throw new Error("clave: " + k);
    if (sessionKeyOf([...base].reverse()) !== k) throw new Error("el orden de las cookies no debe cambiar la clave");
    if (sessionKeyOf(base.map((c) => (c.name === "sb-x-auth-token.0" ? { ...c, value: "A2" } : c))) === k) throw new Error("un token renovado debe cambiar la clave");
    if (sessionKeyOf([{ name: "estudio_id", value: "9" }]) !== "") throw new Error("sin sesión la clave es vacía");
    if (sessionKeyOf([{ name: "ba_guest", value: "x" }, { name: "sb-x-auth-token", value: "T" }]) === sessionKeyOf([{ name: "sb-x-auth-token", value: "OTRO" }])) throw new Error("dos sesiones distintas dieron la misma clave");
  });
  await check("Fuera de una petición de Next nada se recuerda: cada llamada se ejecuta, y el contador de cambios no sube", async () => {
    let calls = 0;
    const f = memo(async (x: number) => { calls++; return x * 2; });
    if ((await f(2)) !== 4 || (await f(2)) !== 4 || calls !== 2) throw new Error("recordó fuera de una petición: " + calls);
    const before = requestEpoch();
    bumpRequestEpoch(); bumpRequestEpoch();
    if (requestEpoch() !== before) throw new Error("el contador debe ser inerte fuera de una petición");
  });
}
main().then(summary);
