"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { bulkAction, type BulkState } from "@/app/entrada/bulk-actions";
import type { BulkRowReport, Counts } from "@/server/entry/bulk";

const ACTION_ES: Record<BulkRowReport["action"], string> = { create: "Nuevo", update: "Se actualiza", unchanged: "Sin cambios", error: "Error" };
const total = (c: Counts) => c.create + c.update + c.unchanged + c.error;
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Informe de errores en CSV (con BOM para que Excel respete las tildes). */
function downloadErrors(rows: BulkRowReport[], fileErrors: string[]) {
  const lines = ["Hoja,Fila,Registro,Detalle", ...fileErrors.map((m) => ["Archivo", "", "", m].map(csvCell).join(",")), ...rows.filter((r) => r.action === "error").map((r) => [r.sheet, String(r.rowNo), r.label, r.messages.join(" · ")].map(csvCell).join(","))];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = "informe-de-errores.csv"; a.click(); URL.revokeObjectURL(url);
}

export function BulkUpload({ hoja, base, title }: { hoja: "2" | "3"; base: string; title: string }) {
  const [state, action, pending] = useActionState<BulkState, FormData>(bulkAction, { stage: "idle" });
  // Marcas ligadas a la revisión vigente: al llegar una revisión nueva (otro `state`) se anulan solas.
  const [dirtyFor, setDirtyFor] = useState<BulkState | null>(null);      // se eligió otro archivo después de la revisión: hay que revisarlo de nuevo
  const [confirmedFor, setConfirmedFor] = useState<BulkState | null>(null);
  const dirty = dirtyFor === state, confirmed = confirmedFor === state;
  const r = state.report;
  const errors = r ? r.rows.filter((x) => x.action === "error") : [];
  const hasErrors = !!r && (errors.length > 0 || r.fileErrors.length > 0);
  const updates = r ? r.counts.update + r.shiftCounts.update : 0;
  const canApply = !!r && !!state.payload && !hasErrors && !dirty && (updates === 0 || confirmed);
  const box = (label: string, c: Counts) => (
    <div className="card" style={{ margin: 0 }}>
      <h3 style={{ margin: "0 0 6px" }}>{label} · {total(c)} fila(s)</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li><b>{c.create}</b> nuevo(s)</li><li><b>{c.update}</b> por actualizar</li><li><b>{c.unchanged}</b> sin cambios</li>
        <li style={{ color: c.error ? "var(--red-dark)" : undefined }}><b>{c.error}</b> con error</li>
      </ul>
    </div>
  );
  return (
    <form action={action} className="entry-form">
      <input type="hidden" name="hoja" value={hoja} />
      <input type="hidden" name="payload" value={state.payload ?? ""} />
      <section className="card">
        <h2>1. Elija el archivo</h2>
        <p className="note" style={{ marginTop: 0 }}>Suba el Excel que descargó de la plantilla de <b>{title}</b>, ya diligenciado. Primero se <b>revisa sin guardar nada</b>.</p>
        <div className="field span-full">
          <label htmlFor="bulk-file">Archivo de Excel (.xlsx, máximo 1,5 MB)</label>
          <input id="bulk-file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={() => setDirtyFor(state)} />
        </div>
        <div className="form-actions">
          <button className="btn solid" type="submit" name="intent" value="preview" disabled={pending}>{pending ? "Revisando…" : "Revisar archivo"}</button>
          <Link className="btn" href={base}>Cancelar</Link>
        </div>
      </section>

      {state.stage === "error" && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{state.message}</div>}

      {r && (
        <section className="card" aria-live="polite">
          <h2>2. Resultado de la revisión</h2>
          {dirty && <div className="banner" role="status">Eligió otro archivo: pulse «Revisar archivo» para revisarlo antes de aplicar.</div>}
          {r.fileErrors.length > 0 && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}><ul style={{ margin: 0, paddingLeft: 18 }}>{r.fileErrors.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          {r.fileErrors.length === 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {box("Hoja «Datos»", r.counts)}
              {hoja === "2" && total(r.shiftCounts) > 0 && box("Hoja «Turnos»", r.shiftCounts)}
            </div>
          )}
          {hasErrors && (
            <>
              <p style={{ marginTop: 16 }}><b>No se guardó nada.</b> Corrija estos errores en el archivo y vuelva a subirlo (todo o nada).</p>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Errores de la carga">
                <table><thead><tr><th>Hoja</th><th>Fila</th><th>Registro</th><th>Detalle</th></tr></thead>
                  <tbody>{errors.slice(0, 200).map((e) => <tr key={`${e.sheet}-${e.rowNo}`}><td>{e.sheet}</td><td>{e.rowNo}</td><td>{e.label}</td><td>{e.messages.join(" · ")}</td></tr>)}</tbody></table>
              </div>
              {errors.length > 200 && <p className="note">Se muestran los primeros 200 errores de {errors.length}; descargue el informe para verlos todos.</p>}
              <div className="form-actions"><button className="btn" type="button" onClick={() => downloadErrors(r.rows, r.fileErrors)}>Descargar informe de errores (CSV)</button></div>
            </>
          )}
          {!hasErrors && (
            <>
              {updates > 0 && (
                <div className="banner" role="alert" style={{ background: "var(--amber-soft, #fff4d6)", marginTop: 16 }}>
                  <div>
                    <b>Aviso: {updates} registro(s) ya existen y se actualizarían</b> con lo del archivo, reemplazando los valores actuales.
                    <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" name="allowUpdate" checked={confirmed} onChange={(e) => setConfirmedFor(e.target.checked ? state : null)} /> <b>Actualizar existentes</b> (confirmo que quiero reemplazar esos registros)</label>
                  </div>
                </div>
              )}
              <details style={{ marginTop: 12 }}>
                <summary>Ver el detalle fila por fila ({r.rows.length})</summary>
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Detalle de la revisión">
                  <table><thead><tr><th>Hoja</th><th>Fila</th><th>Registro</th><th>Qué pasará</th></tr></thead>
                    <tbody>{r.rows.slice(0, 500).map((e) => <tr key={`${e.sheet}-${e.rowNo}`}><td>{e.sheet}</td><td>{e.rowNo}</td><td>{e.label}</td><td>{ACTION_ES[e.action]}{e.messages.length ? ` · ${e.messages.join(" · ")}` : ""}</td></tr>)}</tbody></table>
                </div>
              </details>
              <div className="form-actions">
                <button className="btn solid" type="submit" name="intent" value="apply" disabled={!canApply || pending}>{pending ? "Aplicando…" : "Aplicar carga"}</button>
                {updates > 0 && !confirmed && <span className="muted">Marque «Actualizar existentes» para poder aplicar.</span>}
              </div>
            </>
          )}
        </section>
      )}
    </form>
  );
}
