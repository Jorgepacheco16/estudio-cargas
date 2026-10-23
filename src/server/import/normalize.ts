/** Normalización de celdas del Excel (§10.3 del brief). Funciones puras; los hallazgos se acumulan en un informe, nunca se ocultan. */
import { LABELS } from "../../domain/labels";

export type Severity = "error" | "warning" | "info";
export interface Issue { sheet: string; row: number; field: string; rule: string; severity: Severity; message: string }
export interface Loc { sheet: string; row: number; field: string }
export class Report {
  issues: Issue[] = [];
  add(loc: Loc, rule: string, severity: Severity, message: string) { this.issues.push({ sheet: loc.sheet, row: loc.row, field: loc.field, rule, severity, message }); }
}

/** Valor "plano" de una celda de exceljs: resultado de fórmula, texto enriquecido, hipervínculo o error → valor simple. */
export function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("result" in o) return plain(o.result);
    if ("formula" in o || "sharedFormula" in o) return null;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return plain(o.text);
    if ("error" in o) return null;
    return null;
  }
  return v;
}

/** ¿La celda contiene una fórmula (columna gris/calculada)? Esas columnas NO se importan como dato. */
export const isFormula = (v: unknown) => typeof v === "object" && v !== null && !(v instanceof Date) && ("formula" in (v as object) || "sharedFormula" in (v as object));

export function text(v: unknown): string | null {
  const p = plain(v);
  if (p === null) return null;
  const s = (p instanceof Date ? p.toISOString().slice(0, 10) : String(p)).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function num(r: Report, loc: Loc, v: unknown): number | null {
  const p = plain(v);
  if (p === null || (typeof p === "string" && p.trim() === "")) return null;
  if (typeof p === "number") return Number.isFinite(p) ? p : null;
  if (typeof p === "boolean" || p instanceof Date) { r.add(loc, "NOT_A_NUMBER", "warning", "Se esperaba un número; el valor no se importó"); return null; }
  const s = String(p).trim();
  if (/^-?\d+([.,]\d+)?$/.test(s)) {
    if (/^-?\d{1,3}\.\d{3}$/.test(s)) { r.add(loc, "AMBIGUOUS_NUMBER", "warning", `Número ambiguo '${s}' (¿separador de miles o decimal?); no se importó`); return null; }
    return Number(s.replace(",", "."));
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  r.add(loc, "NOT_A_NUMBER", "warning", `Se esperaba un número y llegó '${s.slice(0, 30)}'; no se importó`);
  return null;
}

export function int(r: Report, loc: Loc, v: unknown, min: number, max: number): number | null {
  const n = num(r, loc, v);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < min || n > max) { r.add(loc, "OUT_OF_RANGE", "warning", `Valor ${n} fuera de ${min}–${max} (entero); no se importó`); return null; }
  return n;
}

export function range(r: Report, loc: Loc, v: unknown, min: number, max: number): number | null {
  const n = num(r, loc, v);
  if (n === null) return null;
  if (n < min || n > max) { r.add(loc, "OUT_OF_RANGE", "warning", `Valor ${n} fuera de ${min}–${max}; no se importó`); return null; }
  return n;
}

/** Porcentaje como fracción 0–1. Un 12 (sin %) se informa como posible 12 %, no se convierte solo. */
export function pct(r: Report, loc: Loc, v: unknown): number | null {
  const p = plain(v);
  if (p === null || (typeof p === "string" && p.trim() === "")) return null;
  if (typeof p === "string" && p.trim().endsWith("%")) {
    const n = num(r, loc, p.trim().slice(0, -1).trim());
    return n === null ? null : n / 100 >= 0 && n / 100 <= 1 ? n / 100 : (r.add(loc, "PERCENT_OUT_OF_RANGE", "warning", `Porcentaje ${n} % fuera de 0–100; no se importó`), null);
  }
  const n = num(r, loc, p);
  if (n === null) return null;
  if (n < 0 || n > 1) { r.add(loc, "PERCENT_OUT_OF_RANGE", "warning", `El valor ${n} no está entre 0 y 1 (¿posible ${n} %?); no se importó`); return null; }
  return n;
}

export function date(r: Report, loc: Loc, v: unknown): string | null {
  const p = plain(v);
  if (p === null || (typeof p === "string" && p.trim() === "")) return null;
  if (p instanceof Date) return Number.isNaN(p.getTime()) ? null : p.toISOString().slice(0, 10);
  if (typeof p === "number") { const d = new Date(Math.round((p - 25569) * 86400000)); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  const s = String(p).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  r.add(loc, "INVALID_DATE", "warning", `Fecha no reconocida '${s.slice(0, 30)}'; no se importó`);
  return null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Etiqueta de lista → código de enum. Coincidencia por mayúsculas/acentos se corrige (info); sin coincidencia se informa y queda NULL. */
export function label(r: Report, loc: Loc, list: keyof typeof LABELS, v: unknown): string | null {
  const t = text(v);
  if (t === null) return null;
  const map = LABELS[list].map as Record<string, string>;
  if (t in map) return map[t];
  const hit = Object.keys(map).find((k) => fold(k) === fold(t));
  if (hit) { r.add(loc, "LABEL_AUTOFIXED", "info", `'${t.slice(0, 40)}' → '${hit}' (mayúsculas/acentos)`); return map[hit]; }
  r.add(loc, "NOT_IN_LIST", "warning", `'${t.slice(0, 50)}' no está en la lista ${list}; no se importó`);
  return null;
}

export function bool(r: Report, loc: Loc, v: unknown): boolean | null {
  const t = text(v);
  if (t === null) return null;
  const f = fold(t);
  if (f === "si") return true;
  if (f === "no") return false;
  r.add(loc, "NOT_YES_NO", "warning", `'${t.slice(0, 30)}' no es Sí/No; no se importó`);
  return null;
}

export const scale15 = (r: Report, loc: Loc, v: unknown) => {
  const n = num(r, loc, v);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 1 || n > 5) { r.add(loc, "OUT_OF_SCALE", "warning", `Valor ${n} fuera de la escala 1–5; no se importó`); return null; }
  return n;
};

/** Clave de comparación del Excel: sin distinguir mayúsculas ni espacios extremos. */
export const key = (...parts: (string | null | undefined)[]) => parts.map((p) => fold(p ?? "")).join("|");
