import { PASSWORD_MAX, PASSWORD_MIN, validatePasswordChange } from "../src/lib/password-change";
import { check, summary } from "./helpers";

/** Cambio de clave desde «Mi cuenta»: reglas de la clave nueva. */
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
}
main().then(summary);
