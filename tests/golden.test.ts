import { readFileSync, readdirSync } from "node:fs";
import { computeActivity, occupantsOf, capacityOf, norm, STATUS_ES, type ActivityInput, type Params, type StaffingInput } from "../src/domain/engine";
import { check, summary } from "./helpers";

const close = (a: number | null | undefined, b: number | null, tol = 1e-9) => (a == null || b == null ? a == null && b == null : Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));
const FIELDS = ["execPerWeek", "hoursPerExec", "hsBase", "hsHigh", "hsLow", "hsMin", "hsMax", "hsSel", "mult", "hTotal", "hPrimary", "hSecondary", "hUnplanned", "hRework", "hWait", "hHighTotal", "hLowTotal", "hMonth"] as const;
let compared = 0;
async function main() {
for (const f of readdirSync("tests/fixtures").filter((x) => /^v\d.*\.json$/.test(x)).sort()) {
  const fx = JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
  const prm: Params = fx.params; const staff: StaffingInput[] = fx.positions; const acts: ActivityInput[] = fx.activities;
  console.log(`\nVariante ${f} → escenario=${prm.scenario}, días/sem=${prm.workDaysPerWeek}, reserva=${prm.reservePct}`);
  const results = acts.map((a) => computeActivity(a, prm, occupantsOf(staff, a)));
  await check(`${acts.length} actividades: estado de captura idéntico al Excel`, () => {
    acts.forEach((a, i) => { if (STATUS_ES[results[i].status] !== fx.expected[i].status) throw new Error(`${a.code}: '${STATUS_ES[results[i].status]}' ≠ '${fx.expected[i].status}'`); });
  });
  await check(`${acts.length} actividades × ${FIELDS.length} columnas calculadas coinciden con el Excel (tolerancia 1e-9)`, () => {
    acts.forEach((a, i) => FIELDS.forEach((k) => { compared++; const got = (results[i] as any)[k] as number | undefined; const exp = fx.expected[i][k] as number | null;
      if (!close(got, exp)) throw new Error(`${a.code}.${k}: motor=${got} Excel=${exp}`); }));
  });
  await check(`${fx.expectedPositions.length} cargos: ocupantes, capacidad, horas y % de capacidad coinciden con la hoja 4b`, () => {
    for (const p of fx.expectedPositions) {
      const same = (x: { dataKind: string; area: string; site: string; position: string }) => x.dataKind === p.dataKind && norm(x.area) === norm(p.area) && norm(x.site) === norm(p.site) && norm(x.position) === norm(p.position);
      const entries = staff.filter(same);
      const occ = entries.reduce((s, e) => s + (e.headcount ?? 0), 0), cap = capacityOf(entries, prm.reservePct);
      let hours = 0; acts.forEach((a, i) => { const r = results[i]; if (r.status !== "OK") return;
        if (same(a)) hours += r.hPrimary!;
        if (a.secondaryPosition && a.dataKind === p.dataKind && norm(a.area) === norm(p.area) && norm(a.site) === norm(p.site) && norm(a.secondaryPosition) === norm(p.position)) hours += r.hSecondary!; });
      const pct = cap > 0 && hours > 0 ? hours / cap : null; compared += 4;
      if (!close(occ, p.occupants) || !close(cap, p.capacity) || !close(hours, p.hours) || !close(pct, p.pct)) throw new Error(`${p.position}: motor occ=${occ} cap=${cap} h=${hours} pct=${pct} | Excel ${JSON.stringify(p)}`);
    }
  });
}
}
main().then(() => {
console.log(`\nValores comparados contra el Excel recalculado por LibreOffice: ${compared}`);
summary();
});
