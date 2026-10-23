import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listAreas, loadStudyData } from "@/server/studies";
import { listActivityVersions } from "@/server/studies";
import { listRows, optionsOf, SHEETS, sheetById, toFormValue, type Field, type SheetDef } from "@/server/capture";
import { analyze } from "@/domain/summary";
import { computeMeasurability, computeOpportunity, computePlan, computeRedesign, computeRisk, computeSuitability } from "@/domain/calculators";
import { todayBogota } from "@/server/dashboard-data";
import { deleteCaptureAction, saveCaptureAction } from "./actions";

type Row = Record<string, unknown>;
const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
const s = (x: unknown) => (x === null || x === undefined ? null : String(x));
const lvl = (x: unknown) => (x === "high" || x === "medium" || x === "low" ? x : null);
const tri = (x: unknown) => (x === "yes" || x === "partial" || x === "no" ? x : null);
const fmt = (x: number | null, d = 2) => (x === null ? "—" : x.toLocaleString("es-CO", { maximumFractionDigits: d }));

export default async function Captura({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const def: SheetDef = sheetById(sp.hoja) ?? SHEETS[0];
  const db = getDb();
  const study = await activeStudyId(user!.id);

  const tabs = (
    <div className="tabs" role="tablist" aria-label="Hojas de captura">
      {SHEETS.map((x) => <Link key={x.id} href={`/captura?hoja=${x.id}`} role="tab" aria-selected={x.id === def.id} className={x.id === def.id ? "on" : ""}>{x.title}</Link>)}
    </div>
  );
  if (!study) return <main><div className="head"><div><h1>Captura</h1></div></div>{tabs}<div className="empty">Cree o seleccione un estudio en la sección Estudio.</div></main>;
  const canWrite = study.role !== "viewer";

  const [areas, acts, rows, paramRows, d] = await Promise.all([
    listAreas(db, user!.id, study.id), listActivityVersions(db, user!.id, study.id), listRows(db, user!.id, study.id, def),
    listRows(db, user!.id, study.id, SHEETS.find((x) => x.id === "param")!), loadStudyData(db, user!.id, study.id),
  ]);
  const prm = paramRows[0] as Row;
  const analysis = analyze(d.staff, d.acts, d.params, d.thresholds, "all");
  const actCode = new Map(acts.map((a) => [a.id, a.code]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const today = todayBogota();

  /** Resultado calculado (columnas grises del Excel) de cada fila. */
  const resultOf = (r: Row): string => {
    switch (def.id) {
      case "5": { const x = computeMeasurability({ direct: tri(r.directMeasurement), hasIndicators: r.hasIndicators as boolean | null, hasHistory: tri(r.hasHistory), hasTimeStandard: r.hasTimeStandard as boolean | null, reliability: lvl(r.sourceReliability), external: lvl(r.externalDependency), verifiable: tri(r.resultVerifiable), proposedIndicator: s(r.proposedIndicator), qualitativeCriterion: s(r.qualitativeCriterion) }); return `${x.score === null ? "—" : x.score} · ${x.level} · ${x.recommendation}`; }
      case "6": { const x = computeSuitability({ gaps: s(r.gaps), trainingPossible: tri(r.trainingPossible), reassignmentPossible: (r.reassignmentPossible as "yes" | "conditional" | "no" | null) ?? null, specializationNeeded: r.specializationNeeded as boolean | null, situation: s(r.situation), sensitiveResponsibility: r.sensitiveResponsibility as boolean | null, separationEvaluated: r.separationEvaluated as boolean | null }); return `${x.reading || "—"} · Alerta: ${x.alert}`; }
      case "7": { const x = computeRisk({ impOperational: n(r.impactOperational), impEconomic: n(r.impactEconomic), impLabor: n(r.impactLabor), impLegal: n(r.impactLegal), impService: n(r.impactService), probability: n(r.probability), peopleWhoCanExecute: n(r.peopleWhoCanExecute) }); return `Criticidad ${x.criticality} · ${x.concentration} · ${x.backup}`; }
      case "8": { const x = computeOpportunity({ findingClass: s(r.findingClass), evidence: s(r.evidence), hoursPerWeek: n(r.recoverableHoursPerWeek), impact: n(r.impactScore), ease: n(r.easeScore), effort: n(r.effortScore), cost: n(r.costScore), risk: n(r.riskScore) },
        { weeksPerYear: Number(prm.weeksPerYear), hourlyCost: n(prm.hourlyCostCop), wImpact: Number(prm.weightImpact), wEase: Number(prm.weightEase), wEffort: Number(prm.weightEffort), wCost: Number(prm.weightCost), wRisk: Number(prm.weightRisk) });
        return `Puntaje ${x.score ?? "—"} · Prioridad ${x.priority} · ${x.control}`; }
      case "9": {
        const area = areaName.get(String(r.areaId)), pos = String(r.currentPositionName).trim().toLowerCase();
        const ps = analysis.positions.filter((p) => p.area === area && p.position.trim().toLowerCase() === pos);
        const x = computeRedesign({ currentLoad: ps.reduce((a, p) => a + p.hours, 0), capacity: ps.reduce((a, p) => a + p.capacity, 0), hoursOut: n(r.hoursOutPerWeek), hoursIn: n(r.hoursInPerWeek), hoursRecovered: n(r.hoursRecoveredPerWeek), receivingPosition: s(r.receivingPositionName) }, d.thresholds.high);
        return `Carga propuesta ${fmt(x.proposedLoad)} h · ${x.proposedPct === null ? "—" : fmt(x.proposedPct * 100, 1) + "%"} · ${x.alert}`;
      }
      case "10": { const x = computePlan({ start: s(r.startDate), end: s(r.endDate), target: n(r.target), actual: n(r.actualResult), status: s(r.status) }, today); return `Duración ${x.durationDays ?? "—"} d · Cumplimiento ${x.compliancePct === null ? "—" : fmt(x.compliancePct * 100, 1) + "%"} · ${x.deadlineAlert}`; }
      default: return "";
    }
  };
  const keyOf = (r: Row) => {
    if (def.id === "5" || def.id === "6" || def.id === "7") return actCode.get(String(r.activityId)) ?? "(actividad)";
    if (def.id === "9") return `${areaName.get(String(r.areaId)) ?? ""} · ${r.currentPositionName}`;
    return String(r.code ?? "");
  };

  const editing = def.id === "param" ? prm : sp.id ? rows.find((r) => r.id === sp.id) : undefined;
  const usedActs = new Set(rows.map((r) => String(r.activityId)));
  const input = (f: Field) => {
    const v = editing ? toFormValue(f, editing[f.key]) : f.key === "dataKind" ? "real" : "";
    const locked = !!editing && (def.keyCols.includes(f.key));
    const name = f.key;
    if (f.kind === "list") {
      return <select name={name} defaultValue={v} disabled={locked}>{f.notNull ? null : <option value="">(sin definir)</option>}{optionsOf(f.list!).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select>;
    }
    if (f.kind === "bool") return <select name={name} defaultValue={v}>{f.notNull ? null : <option value="">(sin definir)</option>}<option value="yes">Sí</option><option value="no">No</option></select>;
    if (f.kind === "activity") {
      const list = acts.filter((a) => (editing && String(editing[f.key]) === a.id) || f.key !== "activityId" || !usedActs.has(a.id));
      return <select name={name} defaultValue={v} required={f.required} disabled={locked}>{f.required ? null : <option value="">(ninguna)</option>}{list.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}</select>;
    }
    if (f.kind === "area") return <select name={name} defaultValue={v} required={f.required} disabled={locked}>{f.required ? null : <option value="">(sin definir)</option>}{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>;
    if (f.kind === "longtext") return <textarea name={name} defaultValue={v} rows={2} maxLength={f.max ?? 4000} />;
    if (f.kind === "date") return <input type="date" name={name} defaultValue={v} />;
    return <input name={name} defaultValue={v} required={f.required} readOnly={locked} inputMode={f.kind === "text" ? undefined : "decimal"} maxLength={f.kind === "text" ? f.max ?? 300 : undefined} placeholder={f.hint} />;
  };
  // Los selects deshabilitados no se envían: se reenvía la clave en un campo oculto.
  const hiddenKeys = editing ? def.fields.filter((f) => def.keyCols.includes(f.key)).map((f) => <input key={f.key} type="hidden" name={f.key} value={toFormValue(f, editing[f.key])} />) : null;

  return (
    <main>
      <div className="head"><div><h1>Captura de hojas 5 a 10</h1><div className="sub">{study.name} · los resultados se calculan con las mismas reglas del Excel</div></div></div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      {tabs}
      {!canWrite && <div className="banner">Su rol es de solo lectura: no puede modificar este estudio.</div>}

      <section className="card">
        <h2>{editing ? `Editar · ${def.id === "param" ? "parámetros del estudio" : keyOf(editing)}` : `Nuevo registro · ${def.title}`}</h2>
        <form action={saveCaptureAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 12 }}>
          <input type="hidden" name="hoja" value={def.id} />
          {editing && <input type="hidden" name="version" value={String(editing.version)} />}
          {hiddenKeys}
          {def.fields.map((f) => <label key={f.key} className="f">{f.label}{f.required ? " *" : ""}{input(f)}</label>)}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button className="btn solid" type="submit" disabled={!canWrite}>Guardar</button>
            {editing && def.id !== "param" && <Link className="btn" href={`/captura?hoja=${def.id}`}>Cancelar</Link>}
          </div>
        </form>
        <p className="note">Los campos vacíos se guardan vacíos: la aplicación no inventa valores. Un resultado «incompleto» indica qué falta capturar.</p>
      </section>

      {def.id !== "param" && (
        <section className="card">
          <h2>Registros ({rows.length})</h2>
          {rows.length === 0 ? <div className="empty">Aún no hay registros en esta hoja.</div> : (
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>{def.id === "5" || def.id === "6" || def.id === "7" ? "Actividad" : def.id === "9" ? "Área · cargo" : "Código"}</th><th>Resultado calculado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={String(r.id)}>
                      <td><b>{keyOf(r)}</b></td><td>{resultOf(r)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link className="btn" href={`/captura?hoja=${def.id}&id=${r.id}`}>Editar</Link>{" "}
                        <form action={deleteCaptureAction} style={{ display: "inline" }}><input type="hidden" name="hoja" value={def.id} /><input type="hidden" name="id" value={String(r.id)} /><button className="btn" type="submit" disabled={!canWrite}>Eliminar</button></form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
