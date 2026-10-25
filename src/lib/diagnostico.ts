/** Subsecciones de «Diagnóstico y rediseño»: título visible y para qué sirve cada una. */
export const SECCIONES: Record<string, { titulo: string; proposito: string }> = {
  medibilidad: { titulo: "Medibilidad", proposito: "Evalúa qué tan medible es cada actividad (indicadores, historia, estándar de tiempo) y qué indicador conviene usar." },
  pertinencia: { titulo: "Pertinencia", proposito: "Revisa si cada actividad corresponde al propósito del cargo y a las competencias de quien la hace." },
  riesgos: { titulo: "Riesgos", proposito: "Identifica qué pasa si una actividad no se ejecuta y si depende de pocas personas, para decidir respaldos." },
  oportunidades: { titulo: "Oportunidades", proposito: "Registra hallazgos y mejoras posibles con su impacto, facilidad y horas recuperables, y las prioriza." },
  rediseno: { titulo: "Rediseño", proposito: "Propone cómo redistribuir funciones de un cargo y muestra la carga que tendría después del cambio." },
  "plan-de-accion": { titulo: "Plan de acción", proposito: "Programa las acciones de mejora con fechas, responsable y meta, y mide su cumplimiento." },
};