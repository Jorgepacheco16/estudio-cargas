/** Menú principal: orden, nombres visibles y rutas. Las etiquetas son lo único que ve la persona; las rutas y claves internas no cambian de significado. */
export const GRUPO_DIAGNOSTICO = "Diagnóstico y rediseño";

export interface NavLink { href: string; label: string }
export type NavEntry = NavLink | { group: string; items: NavLink[] };

export const MENU: NavEntry[] = [
  { href: "/", label: "Inicio" },
  { href: "/datos/parametros", label: "Parámetros" },
  { href: "/estudio", label: "Estudio" },
  { href: "/cargos", label: "Cargos y dotación" },
  { href: "/actividades", label: "Actividades" },
  { href: "/calculo", label: "Cálculo de tiempos" },
  { href: "/drill", label: "Drill-down: Carga por áreas" },
  {
    group: GRUPO_DIAGNOSTICO,
    items: [
      { href: "/datos/5", label: "Medibilidad" },
      { href: "/datos/6", label: "Pertinencia" },
      { href: "/datos/7", label: "Riesgos" },
      { href: "/datos/8", label: "Oportunidades" },
      { href: "/datos/9", label: "Rediseño" },
      { href: "/datos/10", label: "Plan de acción" },
    ],
  },
  { href: "/sedes", label: "Comparador sedes" },
  { href: "/historia", label: "Historia y desviaciones" },
  { href: "/integraciones", label: "Integraciones" },
  { href: "/agente", label: "Agente de IA" },
];

export const isActive = (path: string, href: string) => path === href || (href !== "/" && path.startsWith(href + "/"));