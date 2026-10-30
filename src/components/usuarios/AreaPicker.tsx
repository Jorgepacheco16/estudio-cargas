"use client";
import { useState } from "react";

/** «Todas las áreas» o «Solo estas áreas» con sus casillas (D-91). Envía alcance = todas | algunas y un campo «area» por cada casilla marcada. */
export function AreaPicker({ areas, allAreas = true, selected = [], disabled = false }: { areas: { id: string; name: string }[]; allAreas?: boolean; selected?: string[]; disabled?: boolean }) {
  const [todas, setTodas] = useState(allAreas);
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));
  const toggle = (id: string) => setChosen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <fieldset className="area-picker" disabled={disabled}>
      <legend>Áreas en las que puede trabajar</legend>
      <label className="ap-opt"><input type="radio" name="alcance" value="todas" checked={todas} onChange={() => setTodas(true)} /> Todas las áreas</label>
      <label className="ap-opt"><input type="radio" name="alcance" value="algunas" checked={!todas} onChange={() => setTodas(false)} /> Solo estas áreas</label>
      <div className={`ap-list${todas ? " off" : ""}`} role="group" aria-label="Áreas">
        {areas.map((a) => (
          <label key={a.id}><input type="checkbox" name="area" value={a.id} checked={chosen.has(a.id)} onChange={() => toggle(a.id)} disabled={todas} /> <span>{a.name}</span></label>
        ))}
      </div>
      <p className="note" style={{ margin: "10px 0 0" }}>Con «Solo estas áreas», la persona ve y edita únicamente los registros de esas áreas en todos los módulos, y sus totales y exportaciones son solo de ellas. Lo que no pertenece a un área (fotos del estudio, auditoría, agente de IA y conexión con Google) solo lo ve quien tiene todas las áreas.</p>
      {!todas && chosen.size === 0 && <p className="hint" style={{ color: "var(--red-dark)" }}>Marque al menos un área.</p>}
    </fieldset>
  );
}
