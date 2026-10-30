/** Motor de cálculo: reproduce las hojas 4a y 4b del Excel. Funciones puras, sin acceso a base de datos. */
export type PeriodKey = "day" | "week" | "fortnight" | "month" | "quarter" | "year";
export type ScenarioKey = "base" | "high_season" | "low_season" | "min_time" | "max_time";
export interface Params {
  /** Días a la semana en que el cargo está DISPONIBLE (la operación abre). */
  workDaysPerWeek: number; weeksPerMonth: number; weeksPerYear: number; reservePct: number; scenario: ScenarioKey;
  /** Jornada laboral diaria de un colaborador (horas). Si está, las actividades «por día» que hace cada colaborador se cuentan en los días que trabaja la persona (horas semanales ÷ jornada diaria), no en los días en que el cargo está disponible. Vacío = comportamiento del libro de Excel. */
  dailyWorkHours?: number | null;
}
export interface ActivityInput {
  code: string; dataKind: "real" | "demo"; area: string; site: string; position: string; employeeCode: string | null;
  calcMode: "per_event" | "per_unit" | null; scope: "per_employee" | "position_total" | null;
  executions: number | null; period: PeriodKey | null; unitsPerExecution: number | null;
  timeAvgMin: number | null; timeMinMin: number | null; timeMaxMin: number | null;
  seasonHigh: number | null; seasonLow: number | null; simultaneous: number | null; loadShare: number | null;
  secondaryPosition: string | null; planning: "planned" | "unplanned" | null;
  /** Área y sede REALES del cargo secundario (si no se informan, se asume la de la actividad, como en la hoja 4b del libro). */
  secondaryArea?: string | null; secondarySite?: string | null;
  waitMin: number | null; waitOccupies: boolean | null; travelMin: number | null; reworkPct: number | null; reworkMin: number | null;
}
export interface StaffingInput { dataKind: "real" | "demo"; area: string; site: string; position: string; headcount: number | null; weeklyHours: number | null }
export type StatusCode = "OK" | "MISSING_MODE" | "MISSING_EXECUTIONS" | "MISSING_PERIOD" | "MISSING_TIME" | "MISSING_UNITS" | "MISSING_POSITION" | "MISSING_SCOPE" | "MISSING_SECONDARY_POSITION" | "POSITION_NOT_REGISTERED";
/** Textos idénticos a los del Excel (columna "Estado de captura"). */
export const STATUS_ES: Record<StatusCode, string> = {
  OK: "OK", MISSING_MODE: "Falta modalidad de cálculo", MISSING_EXECUTIONS: "Falta cantidad de ejecuciones", MISSING_PERIOD: "Falta período de las ejecuciones",
  MISSING_TIME: "Falta tiempo promedio", MISSING_UNITS: "Falta unidades por ejecución", MISSING_POSITION: "Falta área, sede o cargo", MISSING_SCOPE: "Falta alcance de las ejecuciones",
  MISSING_SECONDARY_POSITION: "Falta el cargo que asume el resto de la carga", POSITION_NOT_REGISTERED: "Registre el cargo en la hoja 2 (se requiere el nº de ocupantes)",
};
export interface ActivityResult {
  status: StatusCode; execPerWeek?: number; hoursPerExec?: number; hsBase?: number; hsHigh?: number; hsLow?: number; hsMin?: number; hsMax?: number; hsSel?: number;
  mult?: number; hTotal?: number; hPrimary?: number; hSecondary?: number; hUnplanned?: number; hRework?: number; hWait?: number; hHighTotal?: number; hLowTotal?: number; hMonth?: number;
}
const n = (x: number | null | undefined) => x ?? 0;                      // equivale a N() de Excel: vacío = 0
export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase(); // Excel compara sin distinguir mayúsculas

export function periodFactor(p: PeriodKey, prm: Params): number {
  switch (p) {
    case "day": return prm.workDaysPerWeek; case "week": return 1; case "fortnight": return 0.5;
    case "month": return 1 / prm.weeksPerMonth; case "quarter": return 1 / (3 * prm.weeksPerMonth); case "year": return 1 / prm.weeksPerYear;
  }
}
export const occupantsOf = (staff: StaffingInput[], a: Pick<ActivityInput, "dataKind" | "area" | "site" | "position">) =>
  staff.filter((s) => s.dataKind === a.dataKind && norm(s.area) === norm(a.area) && norm(s.site) === norm(a.site) && norm(s.position) === norm(a.position))
    .reduce((acc, s) => acc + n(s.headcount), 0);

/**
 * Días a la semana que trabaja un colaborador del cargo = horas semanales ÷ jornada diaria (promedio de las filas de dotación del cargo ponderado por
 * ocupantes), sin pasar de los días en que el cargo está disponible. undefined si falta la jornada diaria, los ocupantes o las horas semanales.
 */
export function personDaysOf(staff: StaffingInput[], a: Pick<ActivityInput, "dataKind" | "area" | "site" | "position">, prm: Params): number | undefined {
  const d = prm.dailyWorkHours;
  if (!d || d <= 0) return undefined;
  const rows = staff.filter((s) => s.dataKind === a.dataKind && norm(s.area) === norm(a.area) && norm(s.site) === norm(a.site) && norm(s.position) === norm(a.position)
    && s.headcount !== null && s.headcount > 0 && s.weeklyHours !== null && s.weeklyHours > 0);
  const heads = rows.reduce((acc, s) => acc + (s.headcount ?? 0), 0);
  if (heads === 0) return undefined;
  const weekly = rows.reduce((acc, s) => acc + (s.headcount ?? 0) * (s.weeklyHours ?? 0), 0) / heads;
  return Math.min(prm.workDaysPerWeek, weekly / d);
}

/** `personDays`: ver personDaysOf; solo cambia las actividades «por día» de cada colaborador (alcance per_employee). */
export function computeActivity(a: ActivityInput, prm: Params, occupants: number, personDays?: number): ActivityResult {
  const share = a.loadShare ?? 1, people = a.simultaneous ?? 1;
  if (!a.calcMode) return { status: "MISSING_MODE" };
  if (a.executions === null) return { status: "MISSING_EXECUTIONS" };
  if (!a.period) return { status: "MISSING_PERIOD" };
  if (a.timeAvgMin === null) return { status: "MISSING_TIME" };
  if (a.calcMode === "per_unit" && a.unitsPerExecution === null) return { status: "MISSING_UNITS" };
  if (!a.area || !a.site || !a.position) return { status: "MISSING_POSITION" };
  if (!a.scope) return { status: "MISSING_SCOPE" };
  if (share < 1 && !a.secondaryPosition) return { status: "MISSING_SECONDARY_POSITION" };
  if (a.scope === "per_employee" && !a.employeeCode && occupants === 0) return { status: "POSITION_NOT_REGISTERED" };
  const units = a.calcMode === "per_unit" ? n(a.unitsPerExecution) : 1;
  const perPersonDaily = a.period === "day" && a.scope === "per_employee" && personDays !== undefined;
  const execPerWeek = a.executions * (perPersonDaily ? personDays : periodFactor(a.period, prm));
  const hpeWait = a.waitOccupies ? (n(a.waitMin) / 60) * people : 0;
  const hpeRework = ((n(a.reworkPct) * n(a.reworkMin)) / 60) * people;
  const hpeActive = ((a.timeAvgMin / 60) * units + n(a.travelMin) / 60) * people;
  const hoursPerExec = hpeActive + hpeWait + hpeRework;
  const hsBase = execPerWeek * hoursPerExec;
  const hsHigh = execPerWeek * (a.seasonHigh ?? 1) * hoursPerExec;
  const hsLow = execPerWeek * (a.seasonLow ?? 1) * hoursPerExec;
  const alt = (t: number | null) => execPerWeek * ((((t ?? a.timeAvgMin!) / 60) * units + n(a.travelMin) / 60) * people + hpeWait + hpeRework);
  const hsMin = alt(a.timeMinMin), hsMax = alt(a.timeMaxMin);
  const hsSel = { base: hsBase, high_season: hsHigh, low_season: hsLow, min_time: hsMin, max_time: hsMax }[prm.scenario];
  const mult = a.employeeCode ? 1 : a.scope === "per_employee" ? Math.max(1, occupants) : 1;
  const hTotal = hsSel * mult;
  return {
    status: "OK", execPerWeek, hoursPerExec, hsBase, hsHigh, hsLow, hsMin, hsMax, hsSel, mult, hTotal,
    hPrimary: hTotal * share, hSecondary: a.secondaryPosition ? hTotal * (1 - share) : 0,
    hUnplanned: a.planning === "unplanned" ? hTotal : 0, hRework: execPerWeek * hpeRework * mult, hWait: (execPerWeek * n(a.waitMin) / 60) * mult,
    hHighTotal: hsHigh * mult, hLowTotal: hsLow * mult, hMonth: hTotal * prm.weeksPerMonth,
  };
}
/** Capacidad = Σ cantidad × jornada × (1 − reserva), solo filas con ambos datos (igual que la hoja 2). */
export const capacityOf = (staff: StaffingInput[], reservePct: number) =>
  staff.reduce((acc, s) => acc + (s.headcount !== null && s.weeklyHours !== null ? s.headcount * s.weeklyHours * (1 - reservePct) : 0), 0);
