import { readFileSync } from "node:fs";
import { LABELS, NON_ENUM_LISTS } from "../src/domain/labels";
import { drillConfig } from "../src/domain/contracts";
import * as schema from "../src/db/schema";
import { check, summary } from "./helpers";
const excel: Record<string, string[]> = JSON.parse(readFileSync("tests/fixtures/excel_lists.json", "utf8")).lists;
const enums: Record<string, readonly string[]> = {};
for (const v of Object.values(schema)) { const e = v as any; if (e && typeof e === "function" && Array.isArray(e.enumValues) && e.enumName) enums[e.enumName] = e.enumValues; }
(async () => {
  console.log("Fidelidad Excel ↔ enums de PostgreSQL:");
  for (const [list, def] of Object.entries(LABELS)) {
    await check(`${list} → ${def.enum}: etiquetas idénticas al Excel y códigos existentes en el enum`, () => {
      const xl = excel[list]; if (!xl) throw new Error("la lista no existe en el Excel");
      const mine = Object.keys(def.map); if (mine.length !== xl.length || !xl.every((x) => mine.includes(x))) throw new Error(`etiquetas distintas: Excel=${JSON.stringify(xl)}`);
      const codes = Object.values(def.map); const en = enums[def.enum]; if (!en) throw new Error(`enum ${def.enum} no encontrado`);
      if (new Set(codes).size !== codes.length) throw new Error("códigos repetidos"); const bad = codes.filter((c) => !en.includes(c)); if (bad.length) throw new Error(`códigos fuera del enum: ${bad}`);
    });
  }
  await check("Todo valor de cada enum de lista queda cubierto por al menos una lista del Excel", () => {
    const covered: Record<string, Set<string>> = {};
    for (const d of Object.values(LABELS)) { covered[d.enum] ??= new Set<string>(); Object.values(d.map).forEach((c) => covered[d.enum].add(c as string)); }
    for (const [en, set] of Object.entries(covered)) { const miss = enums[en].filter((v) => !set.has(v)); if (miss.length) throw new Error(`${en}: sin etiqueta para ${miss}`); }
  });
  await check("Las 34 listas del Excel están contempladas (30 con enum + Sí/No, escala 1-5 y Modo + áreas)", () => {
    const known = new Set([...Object.keys(LABELS), ...NON_ENUM_LISTS, "Áreas operativas (agregue nuevas debajo)"]);
    const miss = Object.keys(excel).filter((l) => !known.has(l)); if (miss.length) throw new Error(`sin tratar: ${miss}`);
  });
  await check("drillConfig: ejemplo del brief (estudio → área → cargo → actividad) es válido", () => {
    drillConfig.parse({ id: "carga-por-area", levels: [
      { key: "study", groupBy: "area", metrics: ["hours", "capacity", "pct"], next: "area" },
      { key: "area", groupBy: "position", metrics: ["hours", "pct", "incomplete"], next: "position" },
      { key: "position", groupBy: "activity", metrics: ["hours", "unplanned", "rework"], next: "activity" },
      { key: "activity", groupBy: null, metrics: ["hours", "seasonVariation"], next: null }], filters: { kind: "real", alertOnly: "overload" } });
  });
  summary();
})();
