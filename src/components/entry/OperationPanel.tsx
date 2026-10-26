import { saveOperationAction } from "@/app/entrada/shift-actions";
import { LONG_TEXT_MAX } from "@/domain/limits";

/** Descripción de la operación del cargo (D-69), dentro del editor de «Cargos y dotación». Informativa: no cambia ningún cálculo. */
export function OperationPanel({ positionId, entryId, text, canWrite, ok, error }: { positionId: string; entryId: string; text: string; canWrite: boolean; ok?: string; error?: string }) {
  return (
    <section className="card" id="operacion" aria-labelledby="operacion-h">
      <h2 id="operacion-h">Descripción de la operación</h2>
      {ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)", marginBottom: 12 }}>{ok}</div>}
      {error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)", marginBottom: 12 }}>{error}</div>}
      <p className="note" style={{ marginTop: 0 }}>Explique cómo se opera este cargo en la práctica: por ejemplo, cuántas personas se aseguran en la apertura y en el cierre, desde qué hora entran los puestos fijos y cómo se completa el resto de la programación según el pronóstico de ventas. Es información para el estudio y para el agente de IA: no cambia las horas ni la capacidad.</p>
      <form action={saveOperationAction}>
        <input type="hidden" name="positionId" value={positionId} />
        <input type="hidden" name="entryId" value={entryId} />
        <div className="field span-full">
          <label htmlFor="operacion-texto">Cómo opera este cargo</label>
          <textarea id="operacion-texto" name="operation" rows={6} maxLength={LONG_TEXT_MAX} defaultValue={text} disabled={!canWrite} />
          <p className="hint">No escriba nombres de personas: describa la operación, no a los colaboradores.</p>
        </div>
        {canWrite && <div className="form-actions"><button className="btn solid" type="submit">Guardar descripción</button></div>}
      </form>
    </section>
  );
}
