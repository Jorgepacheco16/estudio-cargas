/**
 * Módulos, niveles de acceso y dependencias de los roles (D-91). Funciones puras: las usan la base de datos (nombres), las pantallas y las pruebas.
 * Niveles: Sin acceso · Lectura · Edición (Edición incluye Lectura).
 */
export const MODULES = [
  "parametros", "cargos", "actividades", "medibilidad", "pertinencia", "riesgos", "oportunidades", "rediseno", "plan", "historia", "integraciones", "agente", "usuarios",
] as const;
export type AppModule = (typeof MODULES)[number];
export const LEVELS = ["none", "read", "edit"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<Level, string> = { none: "Sin acceso", read: "Lectura", edit: "Edición" };
export const MODULE_LABEL: Record<AppModule, string> = {
  parametros: "Parámetros", cargos: "Cargos y dotación", actividades: "Actividades", medibilidad: "Medibilidad", pertinencia: "Pertinencia", riesgos: "Riesgos",
  oportunidades: "Oportunidades", rediseno: "Rediseño", plan: "Plan de acción", historia: "Historia y mediciones", integraciones: "Integraciones con Google", agente: "Agente de IA", usuarios: "Usuarios y roles",
};

/** Módulos que exigen Lectura en otro para poder trabajar (por ejemplo, evaluar una actividad exige poder leerla). */
export const REQUIRES: Partial<Record<AppModule, Partial<Record<AppModule, Level>>>> = {
  cargos: { parametros: "read" },
  actividades: { cargos: "read" },
  medibilidad: { actividades: "read" }, pertinencia: { actividades: "read" }, riesgos: { actividades: "read" }, oportunidades: { actividades: "read" },
  rediseno: { cargos: "read" },
  plan: { oportunidades: "read" },
  historia: { actividades: "read" },
  agente: { actividades: "read" },
};

const rank = (l: Level) => LEVELS.indexOf(l);
export const atLeast = (have: Level, need: Level) => rank(have) >= rank(need);
export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);
export const isModule = (v: unknown): v is AppModule => typeof v === "string" && (MODULES as readonly string[]).includes(v);

export type Permissions = Record<AppModule, Level>;
export const emptyPermissions = (): Permissions => Object.fromEntries(MODULES.map((m) => [m, "none"])) as Permissions;
export const allPermissions = (level: Level): Permissions => Object.fromEntries(MODULES.map((m) => [m, level])) as Permissions;

/**
 * Completa lo que falta con «Sin acceso» y sube las dependencias a Lectura (por ejemplo, Medibilidad exige Lectura de Actividades, que a su vez exige la de Cargos).
 * Devuelve los cambios hechos para avisarlos en pantalla. «usuarios» no se toca aquí: solo lo tiene el rol del sistema.
 */
export function normalizePermissions(input: Partial<Record<AppModule, Level>>): { perms: Permissions; raised: { module: AppModule; to: Level; because: AppModule }[] } {
  const perms = { ...emptyPermissions(), ...Object.fromEntries(Object.entries(input).filter(([m, l]) => isModule(m) && isLevel(l))) } as Permissions;
  const raised: { module: AppModule; to: Level; because: AppModule }[] = [];
  for (let pass = 0; pass < MODULES.length; pass++) {
    let changed = false;
    for (const m of MODULES) {
      if (perms[m] === "none") continue;
      for (const [dep, need] of Object.entries(REQUIRES[m] ?? {}) as [AppModule, Level][]) {
        if (!atLeast(perms[dep], need)) { perms[dep] = need; raised.push({ module: dep, to: need, because: m }); changed = true; }
      }
    }
    if (!changed) break;
  }
  return { perms, raised };
}

/** Módulo que gobierna una ruta de la aplicación (null = cualquier persona con acceso al estudio). */
export function moduleOfPath(pathname: string): AppModule | AppModule[] | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  const hit = (base: string) => p === base || p.startsWith(base + "/");
  if (hit("/parametros")) return "parametros";
  if (hit("/cargos")) return "cargos";
  if (hit("/actividades")) return "actividades";
  if (hit("/diagnostico/medibilidad")) return "medibilidad";
  if (hit("/diagnostico/pertinencia")) return "pertinencia";
  if (hit("/diagnostico/riesgos")) return "riesgos";
  if (hit("/diagnostico/oportunidades")) return "oportunidades";
  if (hit("/diagnostico/rediseno")) return "rediseno";
  if (hit("/diagnostico/plan-de-accion")) return "plan";
  if (hit("/historia")) return "historia";
  if (hit("/integraciones")) return "integraciones";
  if (hit("/agente")) return "agente";
  if (hit("/usuarios")) return "usuarios";
  if (hit("/calculo") || hit("/drill") || hit("/sedes")) return ["cargos", "actividades"]; // se calculan con cargos y actividades
  return null;
}

/** Roles que se crean con cada estudio. El Super usuario es del sistema (no se edita ni se borra); Editor y Lector se pueden cambiar. */
export const SUPER_ROLE = "Super usuario";
export const DEFAULT_ROLES: { name: string; system: boolean; perms: Permissions }[] = [
  { name: SUPER_ROLE, system: true, perms: allPermissions("edit") },
  { name: "Editor", system: false, perms: { ...allPermissions("edit"), usuarios: "none" } },
  { name: "Lector", system: false, perms: { ...allPermissions("read"), usuarios: "none" } },
];

/** Resumen corto de lo que un rol permite, para listas y el cuadro de permisos. */
export function summarizePermissions(p: Permissions): string {
  const n = (l: Level) => MODULES.filter((m) => m !== "usuarios" && p[m] === l).length;
  const total = MODULES.length - 1;
  if (p.usuarios === "edit") return "Todo, incluida la administración de usuarios";
  if (n("edit") === total) return "Edición en todos los módulos";
  if (n("read") === total) return "Lectura en todos los módulos";
  const parts = [n("edit") && `Edición en ${n("edit")}`, n("read") && `Lectura en ${n("read")}`, n("none") && `Sin acceso a ${n("none")}`].filter(Boolean);
  return parts.join(" · ");
}

/** Módulo de cada hoja de captura (identificador de la hoja del libro → módulo). */
export const ENTRY_MODULE: Record<string, AppModule> = { "2": "cargos", "3": "actividades", "5": "medibilidad", "6": "pertinencia", "7": "riesgos", "8": "oportunidades", "9": "rediseno", "10": "plan" };
