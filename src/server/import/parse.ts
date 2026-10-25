/** Lectura del libro de Excel (§10.1 del brief). Solo columnas de ENTRADA; las columnas grises (fórmulas) se ignoran y la 4a se usa como oráculo. */
import ExcelJS from "exceljs";
import type { LABELS } from "../../domain/labels";
import { Report, bool, date, int, isFormula, label, num, pct, plain, range, scale15, text, type Loc } from "./normalize";

type Cell = string | number | boolean | null;
type Kind = "text" | "num" | "pct" | "date" | "bool" | "scale" | { label: keyof typeof LABELS } | { int: [number, number] } | { range: [number, number] };
export type Spec = Record<string, [col: string, kind: Kind]>;

export class Row {
  constructor(readonly row: number, private d: Record<string, Cell>) {}
  s(f: string) { const v = this.d[f]; return typeof v === "string" ? v : null; }
  n(f: string) { const v = this.d[f]; return typeof v === "number" ? v : null; }
  b(f: string) { const v = this.d[f]; return typeof v === "boolean" ? v : null; }
  has(...fields: string[]) { return fields.some((f) => this.d[f] !== null && this.d[f] !== undefined); }
}

export const SHEETS = {
  staff: "2_Caracterizacion", activities: "3_Actividades", meas: "5_Medibilidad", suit: "6_Pertinencia", risk: "7_Riesgos",
  opp: "8_Oportunidades", redesign: "9_Rediseno", plan: "10_Plan_accion", params: "Parametros", calc: "4a_Calculo_tiempos",
} as const;

export const STAFF: Spec = {
  kind: ["A", { label: "L_TipoDato" }], area: ["B", "text"], site: ["C", "text"], regional: ["D", "text"], position: ["E", "text"], headcount: ["F", { int: [0, 500] }], employeeCode: ["G", "text"],
  boss: ["H", "text"], objective: ["I", "text"], functions: ["J", "text"], weeklyHours: ["K", { range: [0, 84] }], surveyDate: ["L", "date"], surveyor: ["M", "text"],
  infoSource: ["N", { label: "L_FuenteInfo" }], notes: ["O", "text"],
};
export const ACTIVITY: Spec = {
  kind: ["A", { label: "L_TipoDato" }], code: ["B", "text"], area: ["D", "text"], site: ["E", "text"], position: ["F", "text"], employeeCode: ["G", "text"], name: ["H", "text"], description: ["I", "text"],
  process: ["J", "text"], objective: ["K", "text"], otherPositions: ["L", "text"], documented: ["M", { label: "L_Documentada" }], frequency: ["N", { label: "L_Frecuencia" }],
  calcMode: ["O", { label: "L_Modalidad" }], executions: ["P", { range: [0, 1e9] }], period: ["Q", { label: "L_Periodo" }], scope: ["R", { label: "L_Alcance" }], units: ["S", { range: [0, 1e9] }],
  timeAvg: ["T", { range: [0, 1e9] }], timeMin: ["U", { range: [0, 1e9] }], timeMax: ["V", { range: [0, 1e9] }], seasonHigh: ["W", { range: [0, 10] }], seasonLow: ["X", { range: [0, 10] }],
  source: ["Y", { label: "L_Fuente" }], confidence: ["Z", { label: "L_Confianza" }], simultaneous: ["AA", { int: [1, 50] }], loadShare: ["AB", "pct"], secondaryPosition: ["AC", "text"],
  planning: ["AD", { label: "L_Planificada" }], tools: ["AE", "text"], inputs: ["AF", "text"], deliverable: ["AG", "text"], dependencies: ["AH", "text"], waitMin: ["AI", { range: [0, 1e9] }],
  waitOccupies: ["AJ", "bool"], travelMin: ["AK", { range: [0, 1e9] }], reworkPct: ["AL", "pct"], reworkMin: ["AM", { range: [0, 1e9] }], consequences: ["AN", "text"], controls: ["AO", "text"],
  activityType: ["AP", { label: "L_TipoAct" }], valueClass: ["AQ", { label: "L_Valor" }], mandatory: ["AR", "bool"], stdPotential: ["AS", { label: "L_Potencial" }], simplPotential: ["AT", { label: "L_Potencial" }],
  autoPotential: ["AU", { label: "L_Potencial" }], integration: ["AV", { label: "L_SiNoNE" }], evidence: ["AW", "text"], notes: ["AX", "text"], pending: ["AY", "text"],
};
export const MEAS: Spec = {
  code: ["B", "text"], direct: ["G", { label: "L_SiParcialNo" }], hasIndicators: ["H", "bool"], hasHistory: ["I", { label: "L_SiParcialNo" }], hasStandard: ["J", "bool"],
  reliability: ["K", { label: "L_AMB" }], external: ["L", { label: "L_AMB" }], verifiable: ["M", { label: "L_SiParcialNo" }], unit: ["N", { label: "L_Unidad" }], indicator: ["O", { label: "L_Indicador" }], criterion: ["P", "text"],
};
export const SUIT: Spec = {
  code: ["B", "text"], correspondence: ["F", { label: "L_Corresp" }], knowledge: ["G", "text"], training: ["H", "text"], experience: ["I", "text"], techComp: ["J", "text"], behavComp: ["K", "text"],
  authorizations: ["L", "text"], autonomy: ["M", { label: "L_Autonomia" }], compatibility: ["N", { label: "L_Compat" }], currentComp: ["O", "text"], gaps: ["P", "text"],
  trainingPossible: ["Q", { label: "L_SiParcialNo" }], reassign: ["R", { label: "L_Reasig" }], specialization: ["S", "bool"], situation: ["T", { label: "L_Situacion" }],
  sensitive: ["U", "bool"], separation: ["V", "bool"],
};
export const RISK: Spec = {
  code: ["B", "text"], risk: ["F", "text"], consequences: ["G", "text"], impOp: ["H", "scale"], impEco: ["I", "scale"], impLab: ["J", "scale"], impLegal: ["K", "scale"], impService: ["L", "scale"],
  probability: ["M", "scale"], controls: ["N", "text"], evidence: ["O", "text"], dependencies: ["P", "text"], people: ["Q", { int: [0, 100000] }], duplications: ["R", "text"], incompat: ["S", "bool"],
};
export const OPP: Spec = {
  kind: ["A", { label: "L_TipoDato" }], code: ["B", "text"], type: ["C", { label: "L_TipoOport" }], finding: ["D", { label: "L_Hallazgo" }], problem: ["E", "text"], activityCode: ["F", "text"], evidence: ["G", "text"],
  cause: ["H", "text"], proposal: ["I", "text"], area: ["J", "text"], position: ["K", "text"], benefit: ["L", "text"], hours: ["M", { range: [0, 1e6] }], assumptions: ["O", "text"], risks: ["P", "text"],
  impact: ["Q", "scale"], ease: ["R", "scale"], effort: ["S", "scale"], cost: ["T", "scale"], riskScore: ["U", "scale"], owner: ["V", "text"], due: ["W", "date"], indicator: ["X", "text"], validation: ["Y", { label: "L_EstadoValid" }],
};
export const REDESIGN: Spec = {
  kind: ["A", { label: "L_TipoDato" }], area: ["B", "text"], position: ["C", "text"], objective: ["D", "text"], functions: ["E", "text"], kept: ["F", "text"], modified: ["G", "text"], removed: ["H", "text"],
  transferred: ["I", "text"], receiving: ["J", "text"], newResp: ["K", "text"], limits: ["L", "text"], competencies: ["M", "text"], training: ["N", "text"], indicators: ["O", "text"], reporting: ["P", "text"],
  hoursOut: ["T", { range: [0, 1e6] }], hoursIn: ["U", { range: [0, 1e6] }], hoursRecovered: ["V", { range: [0, 1e6] }], justification: ["Z", "text"], benefits: ["AA", "text"], risks: ["AB", "text"], approval: ["AC", { label: "L_Aprob" }],
};
export const PLAN: Spec = {
  kind: ["A", { label: "L_TipoDato" }], code: ["B", "text"], finding: ["C", "text"], action: ["D", "text"], area: ["E", "text"], position: ["F", "text"], resources: ["G", "text"], cost: ["H", { range: [0, 1e13] }],
  priority: ["I", { label: "L_AMB" }], initiative: ["J", { label: "L_TipoIniciativa" }], start: ["K", "date"], end: ["L", "date"], dependencies: ["M", "text"], risks: ["N", "text"], indicator: ["O", "text"],
  target: ["P", "num"], status: ["Q", { label: "L_EstadoPlan" }], actual: ["R", "num"],
};

export interface Expected4a { status: string | null; v: Record<string, number | null> }
const CALC_COLS: Record<string, string> = {
  execPerWeek: "AL", hoursPerExec: "AP", hsBase: "AQ", hsHigh: "AR", hsLow: "AS", hsMin: "AT", hsMax: "AU", hsSel: "AV", occupants: "AW", mult: "AX", hTotal: "AY",
  hPrimary: "AZ", hSecondary: "BA", hUnplanned: "BB", hRework: "BE", hWait: "BF", hHighTotal: "BG", hLowTotal: "BH", hMonth: "BI",
};

export interface Expected4bArea { area: string; acts: number; complete: number; hours: number; capacity: number; pct: number | null }
export interface Expected4bPosition { area: string; site: string; position: string; kind: string; occupants: number; capacity: number; hours: number; pct: number | null }
export interface ParsedParams { workDaysPerWeek: number | null; weeksPerMonth: number | null; weeksPerYear: number | null; reservePct: number | null; overload: number | null; low: number | null; hourlyCost: number | null; scenario: string | null; validated: boolean | null; weights: (number | null)[] }
export interface Parsed {
  params: ParsedParams | null;
  staff: Row[]; activities: Row[]; meas: Row[]; suit: Row[]; risk: Row[]; opp: Row[]; redesign: Row[]; plan: Row[];
  expected4a: Map<string, Expected4a>;
  expected4b: { areas: Expected4bArea[]; positions: Expected4bPosition[] };
  /** Filas con clave por hoja (para el cuadre del informe): clave presente = insertadas + omitidas + con error. */
  keyed: Record<string, number>;
  report: Report;
}

function readRow(ws: ExcelJS.Worksheet, sheet: string, r: number, spec: Spec, rep: Report): Row {
  return readRowFrom((col) => ws.getCell(`${col}${r}`).value, sheet, r, spec, rep);
}

/** Normaliza una fila a partir de una función que entrega el valor crudo de cada columna (libro de Excel o valores de Google Sheets). */
export function readRowFrom(get: (col: string) => unknown, sheet: string, r: number, spec: Spec, rep: Report): Row {
  const d: Record<string, Cell> = {};
  for (const [field, [col, kind]] of Object.entries(spec)) {
    const raw = get(col);
    const loc: Loc = { sheet, row: r, field };
    if (isFormula(raw)) { d[field] = null; continue; } // columna calculada: no es dato
    if (kind === "text") d[field] = text(raw);
    else if (kind === "num") d[field] = num(rep, loc, raw);
    else if (kind === "pct") d[field] = pct(rep, loc, raw);
    else if (kind === "date") d[field] = date(rep, loc, raw);
    else if (kind === "bool") d[field] = bool(rep, loc, raw);
    else if (kind === "scale") d[field] = scale15(rep, loc, raw);
    else if ("label" in kind) d[field] = label(rep, loc, kind.label, raw);
    else if ("int" in kind) d[field] = int(rep, loc, raw, kind.int[0], kind.int[1]);
    else d[field] = range(rep, loc, raw, kind.range[0], kind.range[1]);
  }
  return new Row(r, d);
}

function sheetRows(wb: ExcelJS.Workbook, name: string, spec: Spec, rep: Report, keyOf: (ws: ExcelJS.Worksheet, r: number) => boolean): { rows: Row[]; keyed: number } {
  const ws = wb.getWorksheet(name);
  if (!ws) { rep.add({ sheet: name, row: 0, field: "", }, "SHEET_MISSING", "error", `Falta la hoja ${name}`); return { rows: [], keyed: 0 }; }
  const rows: Row[] = []; let keyed = 0;
  for (let r = 7; r <= ws.rowCount; r++) {
    if (!keyOf(ws, r)) continue;
    keyed++; rows.push(readRow(ws, name, r, spec, rep));
  }
  return { rows, keyed };
}

const filled = (ws: ExcelJS.Worksheet, r: number, ...cols: string[]) => cols.some((c) => text(ws.getCell(`${c}${r}`).value) !== null);

export async function parseWorkbook(source: string | Buffer): Promise<Parsed> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === "string") await wb.xlsx.readFile(source); else await wb.xlsx.load(source as unknown as ArrayBuffer);
  const rep = new Report();
  const keyed: Record<string, number> = {};
  const take = (id: keyof typeof SHEETS, spec: Spec, keyOf: (ws: ExcelJS.Worksheet, r: number) => boolean) => {
    const out = sheetRows(wb, SHEETS[id], spec, rep, keyOf); keyed[SHEETS[id]] = out.keyed; return out.rows;
  };
  const staff = take("staff", STAFF, (ws, r) => filled(ws, r, "B", "C", "E"));
  const activities = take("activities", ACTIVITY, (ws, r) => filled(ws, r, "B"));
  const meas = take("meas", MEAS, (ws, r) => filled(ws, r, "B"));
  const suit = take("suit", SUIT, (ws, r) => filled(ws, r, "B"));
  const risk = take("risk", RISK, (ws, r) => filled(ws, r, "B"));
  const opp = take("opp", OPP, (ws, r) => filled(ws, r, "B"));
  const redesign = take("redesign", REDESIGN, (ws, r) => filled(ws, r, "C"));
  const plan = take("plan", PLAN, (ws, r) => filled(ws, r, "B"));

  let params: ParsedParams | null = null;
  const wp = wb.getWorksheet(SHEETS.params);
  if (wp) {
    const L = (cell: string): Loc => ({ sheet: SHEETS.params, row: Number(cell.slice(1)), field: cell });
    const v = (cell: string) => wp.getCell(cell).value;
    params = {
      workDaysPerWeek: range(rep, L("C5"), v("C5"), 1, 7), weeksPerMonth: range(rep, L("C6"), v("C6"), 1, 6), weeksPerYear: int(rep, L("C7"), v("C7"), 1, 60), reservePct: pct(rep, L("C8"), v("C8")),
      overload: pct(rep, L("C9"), v("C9")), low: pct(rep, L("C10"), v("C10")), hourlyCost: range(rep, L("C11"), v("C11"), 0, 1e9), scenario: label(rep, L("C12"), "L_Escenario", v("C12")),
      validated: bool(rep, L("C13"), v("C13")), weights: ["C19", "C20", "C21", "C22", "C23"].map((c) => int(rep, L(c), v(c), 1, 10)),
    };
  } else rep.add({ sheet: SHEETS.params, row: 0, field: "" }, "SHEET_MISSING", "error", "Falta la hoja Parametros");

  // Oráculo: valores de las columnas calculadas de la hoja 4a, tal como quedaron guardados en el libro.
  const expected4a = new Map<string, Expected4a>();
  const wc = wb.getWorksheet(SHEETS.calc);
  if (wc) {
    for (let r = 7; r <= wc.rowCount; r++) {
      const code = text(wc.getCell(`C${r}`).value);
      if (!code) continue;
      const vals: Record<string, number | null> = {};
      for (const [f, col] of Object.entries(CALC_COLS)) { const p = plain(wc.getCell(`${col}${r}`).value); vals[f] = typeof p === "number" ? p : null; }
      expected4a.set(code.toLowerCase(), { status: text(wc.getCell(`AI${r}`).value), v: vals });
    }
  }
  // Oráculo 4b: tabla 1 (por área, desde la fila 7 hasta el título «2. …») y tabla 2 (por cargo y sede, desde la fila 36).
  const expected4b: Parsed["expected4b"] = { areas: [], positions: [] };
  const wb4 = wb.getWorksheet("4b_Cargas");
  if (wb4) {
    const nv = (cell: string) => { const v = plain(wb4.getCell(cell).value); return typeof v === "number" ? v : null; };
    let inPositions = false;
    for (let r = 7; r <= wb4.rowCount; r++) {
      const a = text(wb4.getCell(`A${r}`).value);
      if (a && /^2\./.test(a)) { inPositions = true; continue; }
      if (!inPositions) {
        if (a && !/^1\./.test(a)) expected4b.areas.push({ area: a, acts: nv(`B${r}`) ?? 0, complete: nv(`C${r}`) ?? 0, hours: nv(`D${r}`) ?? 0, capacity: nv(`E${r}`) ?? 0, pct: nv(`F${r}`) });
      } else {
        const pos = text(wb4.getCell(`C${r}`).value), site = text(wb4.getCell(`B${r}`).value), kind = text(wb4.getCell(`D${r}`).value);
        if (a && pos && site && (kind === "REAL" || kind === "DEMO")) expected4b.positions.push({ area: a, site, position: pos, kind, occupants: nv(`E${r}`) ?? 0, capacity: nv(`G${r}`) ?? 0, hours: nv(`H${r}`) ?? 0, pct: nv(`I${r}`) });
      }
    }
  }
  return { params, staff, activities, meas, suit, risk, opp, redesign, plan, expected4a, expected4b, keyed, report: rep };
}

export const hasAnyInput = (r: Row, fields: string[]) => r.has(...fields);
export const FIELDS = { MEAS: Object.keys(MEAS).filter((k) => k !== "code"), SUIT: Object.keys(SUIT).filter((k) => k !== "code"), RISK: Object.keys(RISK).filter((k) => k !== "code") };
