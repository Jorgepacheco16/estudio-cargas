import { LABELS } from "@/domain/labels";
import type { EntryDef } from "@/server/entry/defs";
import { inputValue, type EntryRow } from "@/server/entry/service";
import type { FormComputed, FormField } from "@/components/EntryForm";

/** Proyección serializable de la definición para el formulario del cliente (sin adaptadores ni funciones). */
export function formProps(def: EntryDef, row?: EntryRow): { fields: FormField[]; computed: FormComputed[]; initial: Record<string, string> } {
  const fields: FormField[] = def.fields.map((f) => ({
    col: f.col, header: f.header, hint: f.hint, group: f.group, control: f.control, required: f.required,
    options: f.list ? Object.keys(LABELS[f.list].map) : [],
  }));
  const initial: Record<string, string> = {};
  for (const f of def.fields) {
    const v = row?.cells[f.col];
    initial[f.col] = f.control === "percent" && typeof v === "number" ? String(Math.round(v * 10000) / 100) : inputValue(def, f.field, v);
  }
  const computed: FormComputed[] = def.computed.map((c) => {
    const v = row?.computed[c.col];
    return { col: c.col, header: c.header, value: v === null || v === undefined || v === "" ? "" : typeof v === "number" ? v.toLocaleString("es-CO", { maximumFractionDigits: 4 }) : String(v) };
  });
  return { fields, computed, initial };
}
