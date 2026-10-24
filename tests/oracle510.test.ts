import { readFileSync } from "node:fs";
import { computeMeasurability, computeOpportunity, computePlan, computeRedesign, computeRisk, computeSuitability, SUGGESTED_INDICATORS } from "../src/domain/calculators";
import { readRowFrom, MEAS, SUIT, RISK, OPP, PLAN } from "../src/server/import/parse";
import { Report } from "../src/server/import/normalize";
import { measFields, oppFields, planFields, riskFields, suitFields } from "../src/server/import/rowmaps";
import { LABELS } from "../src/domain/labels";
import { check, summary } from "./helpers";

/**
 * Oráculo de las hojas 5 a 10 (brief §17): cada fila del fixture trae entradas sintéticas y las columnas calculadas que LibreOffice obtuvo al
 * recalcular el libro de referencia (tests/fixtures/oracle_5_10.json, generado por scripts/make-oracle-5-10.ts). Las entradas pasan por el mismo
 * lector del importador y por las calculadoras de la aplicación; el resultado debe ser idéntico al del libro.
 */
type Raw = Record<string, string | number | null>;
interface Item { in: Raw; out: Raw; pair?: number }
interface Batch { params: { costoHora: number | null; semanasAnio: number; pesos: number[]; fechaCorte: string }; meas: Item[]; suggested: { type: string; S: string | null }[]; suit: Item[]; risk: Item[]; opp: Item[]; plan: Item[]; redesign: Item[] }
const fx = JSON.parse(readFileSync("tests/fixtures/oracle_5_10.json", "utf8")) as { generatedWith: string; batches: Batch[] };

const blank = (v: unknown) => (v === "" || v === undefined ? null : v);
const tri = (x: unknown) => (x === "yes" || x === "partial" || x === "no" ? x : null);
const lvl = (x: unknown) => (x === "high" || x === "medium" || x === "low" ? x : null);
const numOrNull = (x: unknown) => (x === null || x === undefined ? null : Number(x));
const same = (a: unknown, b: unknown) => { a = blank(a); b = blank(b); return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : a === b; };

let compared = 0;
function run(sheet: string, items: Item[], cols: Record<string, (row: ReturnType<typeof readRowFrom>, i: Item) => unknown>, read: (i: Item) => ReturnType<typeof readRowFrom>) {
  const bad: string[] = [];
  items.forEach((it, n) => {
    const row = read(it);
    for (const [col, calc] of Object.entries(cols)) {
      compared++;
      const got = calc(row, it), want = it.out[col];
      if (!same(got, want)) bad.push(`${sheet} fila ${n + 1} col ${col}: app=${JSON.stringify(blank(got))} Excel=${JSON.stringify(blank(want))} entradas=${JSON.stringify(it.in)}`);
    }
  });
  if (bad.length) throw new Error(`${bad.length} diferencias; primeras: ${bad.slice(0, 3).join(" || ")}`);
}
const reader = (sheet: string, spec: Parameters<typeof readRowFrom>[3]) => (it: Item) => readRowFrom((c) => it.in[c] ?? null, sheet, 7, spec, new Report());

async function main() {
  console.log(`Fixture generado con ${fx.generatedWith}`);
  for (const [bi, b] of fx.batches.entries()) {
    const tag = `lote ${bi + 1}`;
    await check(`${tag} · hoja 5 Medibilidad: puntaje, nivel y recomendación (${b.meas.length} filas × 3 columnas)`, () => {
      const calc = (r: ReturnType<typeof readRowFrom>) => { const f = measFields(r) as Record<string, string | number | boolean | null>; return computeMeasurability({ direct: tri(f.directMeasurement), hasIndicators: f.hasIndicators as boolean | null, hasHistory: tri(f.hasHistory), hasTimeStandard: f.hasTimeStandard as boolean | null, reliability: lvl(f.sourceReliability), external: lvl(f.externalDependency), verifiable: tri(f.resultVerifiable), proposedIndicator: f.proposedIndicator as string | null, qualitativeCriterion: f.qualitativeCriterion as string | null }); };
      run("5_Medibilidad", b.meas, { Q: (r) => calc(r).score, R: (r) => calc(r).level, T: (r) => calc(r).recommendation }, reader("5_Medibilidad", MEAS));
    });
    await check(`${tag} · hoja 6 Pertinencia: alerta de control interno y lectura (${b.suit.length} filas × 2 columnas)`, () => {
      const calc = (r: ReturnType<typeof readRowFrom>) => { const f = suitFields(r) as Record<string, string | number | boolean | null>; return computeSuitability({ gaps: f.gaps as string | null, trainingPossible: tri(f.trainingPossible), reassignmentPossible: f.reassignmentPossible as "yes" | "conditional" | "no" | null, specializationNeeded: f.specializationNeeded as boolean | null, situation: f.situation as string | null, sensitiveResponsibility: f.sensitiveResponsibility as boolean | null, separationEvaluated: f.separationEvaluated as boolean | null }); };
      run("6_Pertinencia", b.suit, { W: (r) => calc(r).alert, X: (r) => calc(r).reading }, reader("6_Pertinencia", SUIT));
    });
    await check(`${tag} · hoja 7 Riesgos: impacto máximo, criticidad, concentración y respaldo (${b.risk.length} filas × 4 columnas)`, () => {
      const calc = (r: ReturnType<typeof readRowFrom>) => { const f = riskFields(r) as Record<string, number | null>; return computeRisk({ impOperational: f.impactOperational, impEconomic: f.impactEconomic, impLabor: f.impactLabor, impLegal: f.impactLegal, impService: f.impactService, probability: f.probability, peopleWhoCanExecute: f.peopleWhoCanExecute }); };
      run("7_Riesgos", b.risk, { T: (r) => calc(r).maxImpact, U: (r) => calc(r).criticality, V: (r) => calc(r).concentration, W: (r) => calc(r).backup }, reader("7_Riesgos", RISK));
    });
    await check(`${tag} · hoja 8 Oportunidades: impacto económico, puntaje, prioridad, implementación y control (${b.opp.length} filas × 5 columnas)`, () => {
      const [wI, wF, wE, wC, wR] = b.params.pesos;
      const calc = (r: ReturnType<typeof readRowFrom>) => { const f = oppFields(r) as Record<string, string | number | null>; return computeOpportunity({ findingClass: f.findingClass as string | null, evidence: f.evidence as string | null, hoursPerWeek: numOrNull(f.recoverableHoursPerWeek), impact: f.impactScore as number | null, ease: f.easeScore as number | null, effort: f.effortScore as number | null, cost: f.costScore as number | null, risk: f.riskScore as number | null }, { weeksPerYear: b.params.semanasAnio, hourlyCost: b.params.costoHora, wImpact: wI, wEase: wF, wEffort: wE, wCost: wC, wRisk: wR }); };
      run("8_Oportunidades", b.opp, { N: (r) => calc(r).annualImpact, Z: (r) => calc(r).score, AA: (r) => calc(r).priority, AB: (r) => calc(r).implementation, AC: (r) => calc(r).control }, reader("8_Oportunidades", OPP));
    });
    await check(`${tag} · hoja 10 Plan: duración, diferencia, % de cumplimiento y alerta de plazo con fecha de corte ${b.params.fechaCorte} (${b.plan.length} filas × 4 columnas)`, () => {
      const calc = (r: ReturnType<typeof readRowFrom>) => { const f = planFields(r) as Record<string, string | number | null>; return computePlan({ start: r.s("start"), end: r.s("end"), target: numOrNull(f.target), actual: numOrNull(f.actualResult), status: f.status as string | null }, b.params.fechaCorte); };
      run("10_Plan_accion", b.plan, { S: (r) => calc(r).durationDays, T: (r) => calc(r).difference, U: (r) => calc(r).compliancePct, V: (r) => calc(r).deadlineAlert }, reader("10_Plan_accion", PLAN));
    });
    await check(`${tag} · hoja 9 Rediseño: carga propuesta, % y alerta con la carga y capacidad de la hoja 4b (${b.redesign.length} filas × 4 columnas)`, () => {
      const bad: string[] = [];
      b.redesign.forEach((it, n) => {
        const red = computeRedesign({ currentLoad: Number(blank(it.out.Q) ?? 0), capacity: Number(blank(it.out.R) ?? 0), hoursOut: numOrNull(blank(it.in.T)), hoursIn: numOrNull(blank(it.in.U)), hoursRecovered: numOrNull(blank(it.in.V)), receivingPosition: (blank(it.in.J) as string | null) }, 1);
        const got: Raw = { S: red.currentPct, W: red.proposedLoad, X: red.proposedPct, Y: red.alert };
        for (const c of ["S", "W", "X", "Y"]) {
          compared++;
          // Con carga actual 0 el libro sí calcula W (0 − salidas + entradas…); la aplicación también. Se compara tal cual.
          if (!same(got[c], it.out[c])) bad.push(`9_Rediseno fila ${n + 1} col ${c}: app=${JSON.stringify(got[c])} Excel=${JSON.stringify(it.out[c])} Q=${it.out.Q} R=${it.out.R} entradas=${JSON.stringify(it.in)}`);
        }
      });
      if (bad.length) throw new Error(`${bad.length} diferencias; primeras: ${bad.slice(0, 3).join(" || ")}`);
    });
  }
  await check("Indicador sugerido por tipo de actividad (tabla TblIndic del libro) coincide con la aplicación", () => {
    const got = fx.batches[0].suggested;
    for (const s of got) { compared++; const code = (LABELS.L_TipoAct.map as Record<string, string>)[s.type]; const app = SUGGESTED_INDICATORS[code] ?? null; if (!same(app, s.S)) throw new Error(`${s.type}: app=${JSON.stringify(app)} Excel=${JSON.stringify(s.S)}`); }
  });
}
main().then(() => { console.log(`\nValores comparados contra el libro recalculado por LibreOffice: ${compared}`); summary(); });
