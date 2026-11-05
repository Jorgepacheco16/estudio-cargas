import bcrypt from "bcryptjs";
import { PASSWORD_MAX, PASSWORD_MIN, validatePasswordChange } from "../src/lib/password-change";
import { TEMP_PASSWORD_LENGTH, generateTempPassword, hashPassword } from "../src/lib/temp-password";
import { check, summary } from "./helpers";

/** Cambio de clave desde «Mi cuenta» (reglas de la clave nueva) y clave temporal que genera la aplicación para el Super usuario (D-94). */
async function main() {
  await check("Una clave nueva válida (10 a 72 caracteres, repetida igual y distinta de la actual) se acepta", () => {
    if (validatePasswordChange("Actual-123456", "Nueva-clave-987", "Nueva-clave-987") !== null) throw new Error("rechazó una clave válida");
    if (validatePasswordChange("a", "x".repeat(PASSWORD_MIN), "x".repeat(PASSWORD_MIN)) !== null) throw new Error("rechazó el mínimo exacto");
    if (validatePasswordChange("a", "x".repeat(PASSWORD_MAX), "x".repeat(PASSWORD_MAX)) !== null) throw new Error("rechazó el máximo exacto");
  });
  await check("Se rechaza: sin clave actual, corta, larga, que no coincide o igual a la actual", () => {
    const malos: [string, string, string][] = [
      ["", "Nueva-clave-987", "Nueva-clave-987"],
      ["a", "x".repeat(PASSWORD_MIN - 1), "x".repeat(PASSWORD_MIN - 1)],
      ["a", "x".repeat(PASSWORD_MAX + 1), "x".repeat(PASSWORD_MAX + 1)],
      ["a", "Nueva-clave-987", "Nueva-clave-988"],
      ["Misma-clave-123", "Misma-clave-123", "Misma-clave-123"],
    ];
    for (const [c, n, r] of malos) if (validatePasswordChange(c, n, r) === null) throw new Error(`aceptó ${JSON.stringify([c.length, n.length, r.length])}`);
  });

  await check("Clave temporal (D-94): 14 caracteres sin letras ni cifras confundibles, distinta cada vez y válida según las reglas de Mi cuenta", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = generateTempPassword();
      if (t.length !== TEMP_PASSWORD_LENGTH || !/^[A-HJ-NP-Za-km-z2-9]+$/.test(t)) throw new Error("formato: " + t);
      seen.add(t);
    }
    if (seen.size !== 500) throw new Error("se repitió una clave en 500 intentos");
    const t = generateTempPassword();
    if (validatePasswordChange("Actual-123456", t, t) !== null) throw new Error("la clave temporal debe cumplir las reglas de Mi cuenta");
  });
  await check("El cifrado es bcrypt (el formato que acepta la base y Supabase), con sal propia, y solo la clave correcta coincide", async () => {
    const t = generateTempPassword(), [a, b] = [await hashPassword(t), await hashPassword(t)];
    if (a === b) throw new Error("sin sal");
    if (!/^\$2[aby]\$(0[4-9]|[1-3][0-9])\$[./A-Za-z0-9]{53}$/.test(a)) throw new Error("formato: " + a);
    if (!(await bcrypt.compare(t, a)) || (await bcrypt.compare(t + "x", a))) throw new Error("coincidencia");
  });
}
main().then(summary);
