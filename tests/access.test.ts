import { DEFAULT_ROLES, LEVEL_LABEL, MODULES, REQUIRES, SUPER_ROLE, allPermissions, atLeast, moduleOfPath, normalizePermissions, summarizePermissions } from "../src/domain/access";
import { check, summary } from "./helpers";

/** D-91 — módulos, niveles y dependencias de los roles. Funciones puras. */
async function main() {
  await check("Los niveles se llaman Sin acceso, Lectura y Edición, y Edición incluye Lectura", () => {
    if (LEVEL_LABEL.none !== "Sin acceso" || LEVEL_LABEL.read !== "Lectura" || LEVEL_LABEL.edit !== "Edición") throw new Error(JSON.stringify(LEVEL_LABEL));
    if (!atLeast("edit", "read") || !atLeast("read", "read") || atLeast("none", "read") || atLeast("read", "edit")) throw new Error("orden de niveles");
  });

  await check("Las dependencias suben a Lectura lo que falta, en cadena, y avisan por qué; lo que ya alcanza no se toca ni se baja", () => {
    const r = normalizePermissions({ medibilidad: "edit" });
    if (r.perms.actividades !== "read" || r.perms.cargos !== "read" || r.perms.parametros !== "read") throw new Error(JSON.stringify(r.perms));
    if (!r.raised.some((x) => x.module === "actividades" && x.because === "medibilidad") || !r.raised.some((x) => x.module === "cargos" && x.because === "actividades")) throw new Error(JSON.stringify(r.raised));
    const keep = normalizePermissions({ actividades: "edit", cargos: "edit", parametros: "read", plan: "read" });
    if (keep.perms.actividades !== "edit" || keep.perms.cargos !== "edit" || keep.perms.oportunidades !== "read" || keep.perms.plan !== "read") throw new Error(JSON.stringify(keep.perms)); // plan exige Lectura de oportunidades
    const none = normalizePermissions({});
    if (MODULES.some((m) => none.perms[m] !== "none") || none.raised.length) throw new Error("un rol vacío no debía pedir nada");
    const bad = normalizePermissions({ cargos: "nada", inexistente: "edit" } as never);
    if (MODULES.some((m) => bad.perms[m] !== "none")) throw new Error("valores desconocidos debían ignorarse");
  });

  await check("Ninguna dependencia es circular ni apunta a un módulo que no existe", () => {
    for (const [m, deps] of Object.entries(REQUIRES)) for (const d of Object.keys(deps!)) {
      if (!(MODULES as readonly string[]).includes(d)) throw new Error(`${m} → ${d} no existe`);
      if (REQUIRES[d as keyof typeof REQUIRES]?.[m as keyof typeof REQUIRES]) throw new Error(`dependencia circular ${m} ↔ ${d}`);
    }
  });

  await check("Cada ruta de la aplicación se asocia a su módulo (los cálculos exigen cargos y actividades; el inicio, cualquier acceso)", () => {
    const want: [string, unknown][] = [["/parametros", "parametros"], ["/cargos/nuevo", "cargos"], ["/cargos/abc", "cargos"], ["/actividades", "actividades"], ["/diagnostico/medibilidad", "medibilidad"],
      ["/diagnostico/pertinencia/x", "pertinencia"], ["/diagnostico/riesgos", "riesgos"], ["/diagnostico/oportunidades", "oportunidades"], ["/diagnostico/rediseno", "rediseno"], ["/diagnostico/plan-de-accion", "plan"],
      ["/historia", "historia"], ["/integraciones", "integraciones"], ["/agente", "agente"], ["/usuarios", "usuarios"], ["/usuarios/roles", "usuarios"], ["/", null], ["/estudio", null]];
    for (const [p, m] of want) if (moduleOfPath(p) !== m) throw new Error(`${p}: ${JSON.stringify(moduleOfPath(p))} ≠ ${m}`);
    if (JSON.stringify(moduleOfPath("/calculo")) !== '["cargos","actividades"]' || JSON.stringify(moduleOfPath("/drill")) !== '["cargos","actividades"]') throw new Error("cálculos");
    if (moduleOfPath("/cargosextra") !== null) throw new Error("una ruta que solo empieza igual no debía coincidir");
  });

  await check("Los roles iniciales: Super usuario (del sistema, Edición en todo incluida la administración), Editor (sin administración) y Lector (solo Lectura)", () => {
    const by = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, r]));
    if (!by[SUPER_ROLE].system || by.Editor.system || by.Lector.system) throw new Error("solo el Super usuario es del sistema");
    if (MODULES.some((m) => by[SUPER_ROLE].perms[m] !== "edit")) throw new Error("super usuario");
    if (by.Editor.perms.usuarios !== "none" || by.Editor.perms.actividades !== "edit" || by.Lector.perms.usuarios !== "none" || by.Lector.perms.actividades !== "read") throw new Error("editor/lector");
    for (const r of DEFAULT_ROLES) { const n = normalizePermissions(r.perms); if (n.raised.length) throw new Error(`${r.name} incumple dependencias: ${JSON.stringify(n.raised)}`); }
  });

  await check("El resumen de un rol es legible", () => {
    if (summarizePermissions(allPermissions("edit")) !== "Todo, incluida la administración de usuarios") throw new Error(summarizePermissions(allPermissions("edit")));
    if (summarizePermissions({ ...allPermissions("read"), usuarios: "none" }) !== "Lectura en todos los módulos") throw new Error("lectura");
    const mixed = summarizePermissions({ ...allPermissions("none"), actividades: "edit", cargos: "read", parametros: "read" });
    if (mixed !== "Edición en 1 · Lectura en 2 · Sin acceso a 9") throw new Error(mixed);
  });
}
main().then(summary);
