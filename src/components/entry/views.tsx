import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { EntryForm } from "@/components/EntryForm";
import { entryDef, type EntryId } from "@/server/entry/defs";
import { entryOptions, getEntry, inputValue, listEntries } from "@/server/entry/service";
import { basePath } from "@/lib/entry-routes";
import { deleteEntryAction } from "@/app/entrada/actions";
import { formProps } from "@/app/entrada/form-props";
import { ShiftsPanel } from "@/components/entry/ShiftsPanel";
import { bulkEnabled } from "@/server/entry/bulk-file";
import { FilterBar } from "@/components/FilterBar";
import { entryFilters } from "@/server/entry/filters";
import { filterQuery } from "@/domain/filters";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PagedTable } from "@/components/PagedTable";
import { OperationPanel } from "@/components/entry/OperationPanel";
import { getOperation } from "@/server/operation";
import { activityShiftSelection, getShiftType, listShifts, shiftsByPosition } from "@/server/shifts";

async function session() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  return { user: user!, study };
}

/** Texto de ayuda de cada sección con entradas: para qué sirve y qué falta para que se llene (estado vacío). */
const EMPTY: Record<string, string> = {
  "2": "Aquí se registran los cargos y su dotación: cuántas personas ocupan cada cargo y su jornada semanal. Con esos datos se calcula la capacidad disponible.",
  "3": "Aquí se registra cada actividad concreta de un cargo con su frecuencia y tiempo. Para que sume carga necesita el cargo (de Cargos y dotación) y los datos de tiempo.",
  "5": "Aquí se evalúa qué tan medible es cada actividad. Primero registre actividades; luego evalúe la que quiera.",
  "6": "Aquí se evalúa si la actividad corresponde al propósito del cargo y a sus competencias. Primero registre actividades.",
  "7": "Aquí se registran los riesgos si una actividad no se ejecuta o depende de pocas personas. Primero registre actividades.",
  "8": "Aquí se registran las oportunidades de mejora, con su impacto y facilidad, para priorizarlas. Puede asociarlas a una actividad.",
  "9": "Aquí se propone cómo redistribuir funciones de un cargo y qué carga tendría después. Primero registre el cargo en Cargos y dotación.",
  "10": "Aquí se programan las acciones de mejora con fechas, responsable y meta, y se sigue su cumplimiento.",
};

/** Lista de los registros de una sección con su botón «Agregar» (siempre visible) y las acciones editar / eliminar. Va dentro de la página de la sección. */
/** `bar`: dibuja la barra de filtros de la sección. Las páginas de Cargos y Actividades llevan su propia barra (con los filtros de sus resultados) y aquí solo aplican los filtros. */
export async function EntrySection({ hoja, sp: rawSp, bar = true }: { hoja: EntryId; sp: Record<string, string | string[] | undefined>; bar?: boolean }) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const sp = { ok: first(rawSp.ok), error: first(rawSp.error) };
  const def = entryDef(hoja)!;
  const viewer = await getUser();
  if (!viewer) return <section className="card" aria-label={`Registros de ${def.short}`}><h2>Registros capturados</h2><div className="empty">Inicie sesión para ver y capturar los registros de esta sección. <Link href="/login">Ingresar</Link></div></section>; // las vistas de demostración son públicas
  const { user, study } = await session();
  const base = basePath(hoja);
  const canWrite = !!study && study.role !== "viewer";
  const allRows = study ? (await listEntries(getDb(), user.id, study.id, hoja))?.rows ?? [] : [];
  const ef = entryFilters(def, allRows, rawSp);
  const rows = ef.rows;
  const modo = first(rawSp.modo);
  const listCols = def.listFields.map((f) => def.fields.find((x) => x.field === f)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <section className="card" id="registros" aria-label={`Registros de ${def.short}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <h2>Registros capturados ({rows.length}{rows.length !== allRows.length ? ` de ${allRows.length}` : ""})</h2>
        {canWrite && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {bulkEnabled(hoja) && <><a className="btn" href={`/api/plantilla/${hoja}`}>Descargar plantilla</a><Link className="btn" href={`${base}/carga`}>Carga masiva</Link></>}
            <Link className="btn solid" href={`${base}/nuevo`}>+ Agregar registro</Link>
          </div>
        )}
      </div>
      {sp.ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)", marginTop: 12 }}>{sp.ok}</div>}
      {sp.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)", marginTop: 12 }}>{sp.error}</div>}
      {bar && allRows.length > 0 && <div style={{ marginTop: 12 }}><FilterBar key={filterQuery(ef.current) + (ef.range?.from ?? "") + (ef.range?.to ?? "")} fields={ef.fields} triples={ef.triples} current={ef.current} search={hoja === "3"} range={ef.range} shown={rows.length} total={allRows.length} hidden={modo ? { modo } : {}} clearHref={modo ? `${base}?modo=${encodeURIComponent(modo)}` : base} /></div>}
      {!study ? <div className="empty">Para capturar datos primero cree o seleccione un estudio en <Link href="/estudio">Estudio</Link>.</div>
        : allRows.length > 0 && rows.length === 0 ? <div className="empty">Ningún registro cumple los filtros elegidos. Cambie o limpie los filtros.</div>
        : rows.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0 }}>Aún no hay registros en esta sección.</p>
            <p className="note">{EMPTY[hoja]}</p>
            {canWrite && <p><Link className="btn solid" href={`${base}/nuevo`}>Agregar el primer registro</Link></p>}
          </div>
        ) : (
          <PagedTable
            head={<tr>{listCols.map((c) => <th key={c.col}>{c.header}</th>)}{def.computed.map((c) => <th key={c.col} className="calc" title="Calculado por la hoja (no editable)">{c.header} 🔒</th>)}<th>Acciones</th></tr>}
            rows={rows.map((r) => (
                <tr key={r.id}>
                  {listCols.map((c) => <td key={c.col}>{inputValue(def, c.field, r.cells[c.col])}</td>)}
                  {def.computed.map((c) => { const v = r.computed[c.col]; return <td key={c.col} className="calc">{v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("es-CO", { maximumFractionDigits: 4 }) : String(v)}</td>; })}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link className="btn" href={`${base}/${r.id}`}>{canWrite ? "Editar" : "Ver"}</Link>{" "}
                    {canWrite && <form action={deleteEntryAction} style={{ display: "inline" }}><input type="hidden" name="hoja" value={def.id} /><input type="hidden" name="recId" value={r.id} /><ConfirmButton title="¿Eliminar este registro?" message={<>Se eliminará el registro <b>{String(inputValue(def, listCols[0]?.field ?? "", r.cells[listCols[0]?.col ?? ""]) || "sin código")}</b> de {def.short}.</>} ariaLabel={`Eliminar ${String(inputValue(def, listCols[0]?.field ?? "", r.cells[listCols[0]?.col ?? ""]) || "registro")}`}>Eliminar</ConfirmButton></form>}
                  </td>
                </tr>
              ))}
          />
        )}
      <p className="note">🔒 Columna con fórmula en el libro: se muestra el valor calculado y no se puede editar. Lo que se guarda aquí se escribe también en la hoja de Google.</p>
    </section>
  );
}

/** Turnos (D-67) para el formulario de actividades. Si las tablas de turnos no están disponibles, el formulario funciona sin ellos. */
async function shiftProps(userId: string, studyId: string, hoja: EntryId, activityId?: string) {
  if (hoja !== "3") return undefined;
  try {
    const [positions, initial] = await Promise.all([shiftsByPosition(getDb(), userId, studyId), activityId ? activityShiftSelection(getDb(), userId, studyId, activityId) : Promise.resolve({ all: false, ids: [] as string[] })]);
    return { positions, initial, cols: { kind: "A", area: "D", site: "E", position: "F" }, afterCol: "F" };
  } catch { return undefined; }
}

export async function EntryNew({ hoja }: { hoja: EntryId }) {
  const def = entryDef(hoja)!;
  const { user, study } = await session();
  if (!study) redirect("/estudio");
  const lookups = await entryOptions(getDb(), user.id, study!.id);
  return (
    <main>
      <div className="head"><div><h1>Nuevo registro · {def.short}</h1><div className="sub">Los campos con * son obligatorios. Lo que deje vacío se guarda vacío.</div></div><div className="tools"><Link className="btn" href={basePath(hoja)}>← Volver a {def.short}</Link></div></div>
      <EntryForm hoja={def.id} base={basePath(hoja)} {...formProps(def)} lookups={lookups} shifts={await shiftProps(user.id, study!.id, hoja)} shiftType={hoja === "2" ? { initial: "" } : undefined} canWrite={study!.role !== "viewer"} />
    </main>
  );
}

export async function EntryEdit({ hoja, id, sp }: { hoja: EntryId; id: string; sp?: Record<string, string | undefined> }) {
  const def = entryDef(hoja)!;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { user, study } = await session();
  if (!study) redirect("/estudio");
  const found = await getEntry(getDb(), user.id, study!.id, hoja, id);
  if (!found) notFound();
  const lookups = await entryOptions(getDb(), user.id, study!.id);
  const shiftType = hoja === "2" && found!.row.positionId ? await getShiftType(getDb(), user.id, study!.id, found!.row.positionId).catch(() => null) : null;
  return (
    <main>
      <div className="head"><div><h1>Editar registro · {def.short}</h1><div className="sub">Al guardar, la hoja de Google se actualiza con estos valores.</div></div><div className="tools"><Link className="btn" href={basePath(hoja)}>← Volver a {def.short}</Link></div></div>
      <EntryForm key={found!.row.version} hoja={def.id} base={basePath(hoja)} coverage={hoja === "2" && found!.row.positionId ? { cargoId: found!.row.positionId, afterCol: "J" } : undefined} recId={id} version={found!.row.version} {...formProps(def, found!.row)} lookups={lookups} shifts={await shiftProps(user.id, study!.id, hoja, id)} shiftType={hoja === "2" ? { initial: shiftType ?? "" } : undefined} canWrite={study!.role !== "viewer"} />
      {hoja === "2" && found!.row.positionId && <OperationPanel positionId={found!.row.positionId} entryId={id} text={await getOperation(getDb(), user.id, study!.id, found!.row.positionId).catch(() => "")} canWrite={study!.role !== "viewer"} ok={sp?.from === "operacion" ? sp.ok : undefined} error={sp?.from === "operacion" ? sp.error : undefined} />}
      {hoja === "2" && found!.row.positionId && <ShiftsPanel type={shiftType} ok={sp?.from === "turnos" ? sp.ok : undefined} error={sp?.from === "turnos" ? sp.error : undefined} positionId={found!.row.positionId} entryId={id} shifts={await listShifts(getDb(), user.id, study!.id, found!.row.positionId).catch(() => [])} canWrite={study!.role !== "viewer"} />}
    </main>
  );
}