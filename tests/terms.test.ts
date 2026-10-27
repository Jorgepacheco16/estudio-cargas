import { ui } from "../src/domain/terms";
import { check, summary } from "./helpers";

/** Términos de la pantalla (D-74): «sede» pasa a «centro de operaciones» con el género correcto. */
async function main() {
  await check("Los encabezados del libro para el lugar de trabajo pasan a «Centro de operaciones (CO)»", () => {
    for (const h of ["Punto de venta, sede o centro de operación", "Sede / punto de venta"]) if (ui(h) !== "Centro de operaciones (CO)") throw new Error(ui(h));
    if (ui("Sede") !== "Centro de operaciones") throw new Error(ui("Sede"));
  });
  await check("Las frases con «sede» cambian con el género correcto (la sede → el centro de operaciones)", () => {
    const cases: [string, string][] = [
      ["Mismo nombre de cargo en todas las sedes para poder compararlas", "Mismo nombre de cargo en todos los centros de operaciones para poder compararlo"],
      ["Dispersión entre las sedes", "Dispersión entre los centros de operaciones"],
      ["Número de personas que ocupan el cargo en esa sede", "Número de personas que ocupan el cargo en ese centro de operaciones"],
      ["Horas/sem TOTALES de la actividad en la sede", "Horas/sem TOTALES de la actividad en el centro de operaciones"],
      ["Falta área o sede", "Falta área o centro de operaciones"],
      ["El cargo está registrado en una sola sede", "El cargo está registrado en un solo centro de operaciones"],
      ["Clave (área|sede|cargo|tipo)", "Clave (área|centro de operaciones|cargo|tipo)"],
    ];
    for (const [a, b] of cases) if (ui(a) !== b) throw new Error(`«${a}» → «${ui(a)}»`);
  });
}
main().then(summary);
