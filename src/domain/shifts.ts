/**
 * Turnos del cargo (D-67). Un cargo define sus turnos (nombre, hora de inicio y de fin, receso en minutos) y cada actividad indica en cuáles se ejecuta
 * o que aplica a «Todos los turnos». Es información: no entra en ningún cálculo de horas, capacidad ni alertas.
 */
export const ALL_SHIFTS = "Todos los turnos";
export const ALL_BANDS = "Todas las franjas";

/**
 * Tipo de turno del cargo en un centro de operaciones. «Fijo»: se registran los turnos con su horario. «Variable»: no se registran todos los horarios posibles
 * sino las FRANJAS horarias dentro de las que se distribuyen los turnos de los colaboradores del cargo. Es información para el agente: no entra en ningún cálculo.
 */
export type ShiftType = "fixed" | "variable";
export const SHIFT_TYPE_LABEL: Record<ShiftType, string> = { fixed: "Fijo", variable: "Variable" };
export const isShiftType = (v: unknown): v is ShiftType => v === "fixed" || v === "variable";
/** «Fijo» / «Variable» (o fixed / variable) → tipo; vacío → null (sin definir); cualquier otra cosa → undefined (no se entiende). */
export function parseShiftType(raw: string): ShiftType | null | undefined {
  const t = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  if (t === "") return null;
  if (t === "fijo" || t === "fixed") return "fixed";
  if (t === "variable") return "variable";
  return undefined;
}
/** Cómo se llama cada registro según el tipo: «turno» (fijo o sin definir) o «franja» (variable). */
export const shiftNoun = (t: ShiftType | null | undefined) => (t === "variable"
  ? { one: "franja", many: "franjas", One: "Franja", Many: "Franjas", all: ALL_BANDS }
  : { one: "turno", many: "turnos", One: "Turno", Many: "Turnos", all: ALL_SHIFTS });
/** Frase que se entrega al agente cuando el cargo tiene turno variable. */
export const VARIABLE_EXPLAIN = "turno variable: en cada franja se distribuyen los turnos de los colaboradores del cargo";
export const NAME_MAX = 60;

/** Días de la semana: la posición es el bit (0 = lunes … 6 = domingo). */
export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
export const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"] as const;
const ALL_DAYS = 127;

/** `days`: los días marcados en el formulario ("0".."6"); vacío no se admite aquí (lo valida parseShift). */
export interface ShiftInput { name: string; start: string; end: string; breakMin: string; days: string[] }
/** `days` null = todos los días. */
export interface ShiftValues { name: string; start: string | null; end: string | null; breakMin: number | null; days: number | null }

const DAY_KEYS: Record<string, number> = { l: 0, lunes: 0, m: 1, martes: 1, x: 2, mi: 2, miercoles: 2, j: 3, jueves: 3, v: 4, viernes: 4, s: 5, sabado: 5, d: 6, domingo: 6 };
/**
 * Días escritos como texto (carga masiva): «Todos», «L-S», «lunes a viernes», «L, X, V», «Domingo». Vacío = todos los días.
 * Devuelve los días como "0".."6" (0 = lunes) o null si el texto no se entiende.
 */
export function parseDaysText(raw: string): string[] | null {
  const t = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (t === "" || /^todos( los dias)?$/.test(t) || t === "lunes a domingo" || t === "l-d") return ["0", "1", "2", "3", "4", "5", "6"];
  const days = new Set<number>();
  for (const part of t.split(/[,;]|\sy\s/).map((s) => s.trim()).filter(Boolean)) {
    const ends = part.split(/\s*(?:-|–|—|\sa\s)\s*/);
    if (ends.length === 1) { const d = DAY_KEYS[part]; if (d === undefined) return null; days.add(d); }
    else if (ends.length === 2) {
      const [a, b] = [DAY_KEYS[ends[0]], DAY_KEYS[ends[1]]];
      if (a === undefined || b === undefined) return null;
      for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; } // «S-L» da la vuelta a la semana
    } else return null;
  }
  return days.size ? [...days].sort((x, y) => x - y).map(String) : null;
}

/** Máscara de días ← lista de días marcados. Los siete días se guardan como null (todos). */
export function maskFromDays(days: string[]): number | null {
  const mask = [...new Set(days)].reduce((m, d) => (/^[0-6]$/.test(d) ? m | (1 << Number(d)) : m), 0);
  return mask === ALL_DAYS ? null : mask;
}
/** Días (0..6) incluidos en una máscara; null = todos. */
export function daysOf(mask: number | null): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => mask === null || (mask & (1 << d)) !== 0);
}
/** «Todos los días», «L–S», «D» o «L, X, V». */
export function describeDays(mask: number | null): string {
  if (mask === null) return "Todos los días";
  const d = daysOf(mask);
  if (d.length === 1) return DAY_NAMES[d[0]];
  const contiguous = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return contiguous && d.length > 2 ? `${DAY_SHORT[d[0]]}–${DAY_SHORT[d[d.length - 1]]}` : d.map((x) => DAY_SHORT[x]).join(", ");
}

/** «5:30» o «05:30» → «05:30»; cualquier otra cosa → null. */
export function normTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  return h > 23 || mi > 59 ? null : `${String(h).padStart(2, "0")}:${m[2]}`;
}
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Duración bruta en minutos; si el fin es menor que el inicio, el turno cruza la medianoche. */
export function grossMinutes(start: string, end: string): number {
  const d = minutes(end) - minutes(start);
  return d > 0 ? d : d + 1440;
}
/** Horas netas del turno (duración − receso), o null si falta el horario. */
export function netHours(v: Pick<ShiftValues, "start" | "end" | "breakMin">): number | null {
  if (!v.start || !v.end) return null;
  return Math.max(0, grossMinutes(v.start, v.end) - (v.breakMin ?? 0)) / 60;
}

/** Valida y normaliza lo escrito en el formulario. Nada se inventa: lo vacío queda vacío. */
export function parseShift(i: ShiftInput): { ok: true; values: ShiftValues } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = i.name.trim().replace(/\s+/g, " ");
  if (!name) errors.push("Escriba el nombre del turno.");
  else if (name.length > NAME_MAX) errors.push(`El nombre del turno admite máximo ${NAME_MAX} caracteres.`);
  else if (name.toLowerCase() === ALL_SHIFTS.toLowerCase()) errors.push(`«${ALL_SHIFTS}» es una opción reservada de la actividad; use otro nombre.`);
  const [s, e] = [i.start.trim(), i.end.trim()];
  const start = s ? normTime(s) : null, end = e ? normTime(e) : null;
  if (s && !start) errors.push("La hora de inicio no es válida (use HH:MM, por ejemplo 05:30).");
  if (e && !end) errors.push("La hora de fin no es válida (use HH:MM, por ejemplo 13:00).");
  if ((s && !e) || (!s && e)) errors.push("Registre la hora de inicio y la de fin, o deje ambas vacías.");
  if (start && end && start === end) errors.push("La hora de inicio y la de fin no pueden ser iguales.");
  let breakMin: number | null = null;
  if (i.breakMin.trim() !== "") {
    const n = Number(i.breakMin.trim().replace(",", "."));
    if (!Number.isInteger(n) || n < 0 || n > 240) errors.push("El receso debe ser un número entero de minutos entre 0 y 240.");
    else breakMin = n;
  }
  if (start && end && breakMin !== null && breakMin >= grossMinutes(start, end)) errors.push("El receso no puede ser igual o mayor que la duración del turno.");
  if (i.days.filter((d) => /^[0-6]$/.test(d)).length === 0) errors.push("Marque al menos un día en que aplica el turno.");
  return errors.length ? { ok: false, errors } : { ok: true, values: { name, start, end, breakMin, days: maskFromDays(i.days) } };
}

/** «Apertura · L–S · 05:30–13:00 · receso 30 min · 7 h netas» (los días solo aparecen si no son todos). */
export function describeShift(v: Omit<ShiftValues, "days"> & { days?: number | null; type?: ShiftType | null }): string {
  const variable = v.type === "variable";
  const parts = [variable ? `Franja ${v.name}` : v.name];
  if (v.days !== undefined && v.days !== null) parts.push(describeDays(v.days));
  if (v.start && v.end) parts.push(`${v.start}–${v.end}`);
  if (v.breakMin) parts.push(`receso ${v.breakMin} min`);
  const h = variable ? null : netHours(v); // la franja es una ventana de horas, no la duración del turno de una persona
  if (h !== null) parts.push(`${String(Math.round(h * 100) / 100).replace(".", ",")} h netas`);
  return parts.join(" · ");
}

/** Texto de los turnos de una actividad: «Todos los turnos», «Apertura, Cierre» o vacío. */
export function activityShiftsText(allShifts: boolean, names: string[]): string {
  return allShifts ? ALL_SHIFTS : [...names].sort((a, b) => a.localeCompare(b, "es")).join(", ");
}

/**
 * Turnos elegibles para una actividad: solo los del cargo responsable. Devuelve los elegidos que siguen siendo válidos y los que se descartan
 * (por ejemplo, porque la actividad cambió de cargo).
 */
export function reconcileSelection(chosen: string[], validIds: string[]): { kept: string[]; dropped: string[] } {
  const ok = new Set(validIds);
  const uniq = [...new Set(chosen)];
  return { kept: uniq.filter((x) => ok.has(x)), dropped: uniq.filter((x) => !ok.has(x)) };
}
