import { activityUpsert, sheetChangeEvent, agentOutput, validationIssue } from "../src/domain/contracts";
import { parseDecimalEs, parsePercent, matchList, isAutoApplicable, findDuplicates, emptyRequired } from "../src/domain/autocorrect";
import { sign, verifySignature } from "../src/server/webhook";
import { check, summary } from "./helpers";
const ID = "5b1f3c1e-9a7d-4b8e-8f10-2f6a1c0d9e11";
(async () => {
  console.log("Contratos JSON (zod) — los mismos ejemplos que aparecen en el brief:");
  await check("activityUpsert acepta el ejemplo válido", () => { activityUpsert.parse({ dataKind: "real", code: "SUP-001", positionId: ID, name: "Alistar bases", calcMode: "per_event", executionsPerPeriod: 1, period: "day", scope: "position_total", timeAvgMin: 10 }); });
  await check("activityUpsert rechaza % de reproceso > 1 y campos desconocidos", () => {
    if (activityUpsert.safeParse({ code: "A", positionId: ID, name: "x", reworkPct: 1.5 }).success) throw new Error("aceptó 1.5");
    if (activityUpsert.safeParse({ code: "A", positionId: ID, name: "x", hack: 1 }).success) throw new Error("aceptó campo extra");
  });
  await check("sheetChangeEvent acepta el ejemplo y rechaza fechas inválidas", () => {
    sheetChangeEvent.parse({ eventId: ID, spreadsheetId: "1AbCdEfGhIjKlMnOp", sheetName: "3_Actividades", kind: "edit", range: { row: 7, col: 20, rows: 1, cols: 1 }, values: [[10]], editedAt: "2026-10-23T14:05:00Z" });
    if (sheetChangeEvent.safeParse({ eventId: ID, spreadsheetId: "1AbCdEfGhIjKlMnOp", sheetName: "x", kind: "edit", range: { row: 1, col: 1, rows: 1, cols: 1 }, values: [], editedAt: "ayer" }).success) throw new Error("aceptó fecha mala");
  });
  await check("agentOutput exige evidencia en cada propuesta", () => {
    agentOutput.parse({ proposals: [{ kind: "validation_rule", summary: "Exigir tiempo promedio cuando la modalidad es por unidad", payload: { field: "timeAvgMin" }, evidence: [{ entity: "activities", id: ID }] }] });
    if (agentOutput.safeParse({ proposals: [{ kind: "report", summary: "Resumen sin evidencia alguna", payload: {}, evidence: [] }] }).success) throw new Error("aceptó sin evidencia");
  });
  await check("validationIssue acepta un hallazgo de celda vacía", () => { validationIssue.parse({ ruleCode: "EMPTY_REQUIRED", severity: "warning", entity: "activities", entityId: ID, field: "timeAvgMin", autoFixable: false }); });
  console.log("\nAutocorrector:");
  await check("Coma decimal: '6,5' → 6.5 y '1.234,5' → 1234.5; texto basura → null", () => { if (parseDecimalEs("6,5") !== 6.5 || parseDecimalEs("1.234,5") !== 1234.5 || parseDecimalEs("abc") !== null) throw new Error("falló"); });
  await check("Porcentaje: '12 %' → 0.12", () => { if (parsePercent("12 %") !== 0.12) throw new Error(String(parsePercent("12 %"))); });
  await check("Lista: 'dia' → 'Día' se corrige solo; 'Semanna' solo se SUGIERE; 'xyz' no empareja", () => {
    const L = ["Día", "Semana", "Quincena", "Mes", "Trimestre", "Año"] as const;
    const a = matchList("dia", L), b = matchList("Semanna", L), c = matchList("xyz", L);
    if (a.match !== "Día" || !isAutoApplicable(a)) throw new Error("dia"); if (b.match !== "Semana" || isAutoApplicable(b)) throw new Error("fuzzy no debe ser automático"); if (c.match !== null) throw new Error("xyz");
  });
  await check("Duplicados: 'SUP-001' y ' sup-001 ' se detectan como la misma clave", () => { const d = findDuplicates(["SUP-001", "SUP-002", " sup-001 "]); if (d.get("sup-001")?.join() !== "1,3") throw new Error(JSON.stringify([...d])); });
  await check("Vacíos obligatorios: se reportan, jamás se rellenan", () => { const e = emptyRequired({ code: "A", timeAvgMin: null, name: "  " }, ["code", "timeAvgMin", "name"]); if (e.join() !== "timeAvgMin,name") throw new Error(e.join()); });
  console.log("\nFirma del webhook (HMAC-SHA256):");
  const body = '{"eventId":"x"}', ts = 1_760_000_000_000, secret = "secreto-de-prueba";
  await check("Firma válida se acepta", () => { if (!verifySignature(body, sign(body, ts, secret), ts, secret, ts + 1000)) throw new Error("rechazó firma válida"); });
  await check("Cuerpo alterado se rechaza", () => { if (verifySignature(body + " ", sign(body, ts, secret), ts, secret, ts + 1000)) throw new Error("aceptó cuerpo alterado"); });
  await check("Evento repetido fuera de ventana (anti-replay) se rechaza", () => { if (verifySignature(body, sign(body, ts, secret), ts, secret, ts + 10 * 60_000)) throw new Error("aceptó evento viejo"); });
  await check("Secreto incorrecto se rechaza", () => { if (verifySignature(body, sign(body, ts, "otro"), ts, secret, ts + 1000)) throw new Error("aceptó otro secreto"); });
  summary();
})();
