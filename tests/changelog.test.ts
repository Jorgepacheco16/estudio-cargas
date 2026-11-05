import { ENTITY_INFO, SECTIONS, actionLabel, actionsMatchingWord, diffLines, diffText, entitiesMatchingWord, entitiesOfKinds, entitiesOfSections, fieldLabel, fold, kindOf, originLabel, sectionOf, searchWords, unescapeWord, valueText } from "../src/domain/changelog";
import { check, summary } from "./helpers";

/** Registro de cambios (D-96): nombres en español, lectura de cada cambio y preparación de la búsqueda. Funciones puras; la consulta real se prueba en changelog-db.test.ts. */
async function main() {
  await check("Cada entidad que la aplicación registra tiene sección y tipo; las de administración son de tipo «admin» y el resto, «datos»", () => {
    const registradas = ["staffing", "activity", "measurability", "suitability", "risk", "opportunity", "redesign", "action", "parameters", "position_operation", "position_shift", "position_shift_type", "activity_shifts",
      "measurement", "snapshot", "deviation", "deviation_detection", "sheet_connection", "agent_run", "agent_proposal", "coverage_run", "study", "membership", "membership_name", "member_password_reset", "role", "invitation", "invitation_accepted"];
    for (const e of registradas) if (!ENTITY_INFO[e]) throw new Error(`falta la entidad ${e}`);
    for (const e of ["membership", "membership_name", "member_password_reset", "role", "invitation", "invitation_accepted"]) if (kindOf(e) !== "admin" || sectionOf(e) !== "Usuarios y roles") throw new Error(`${e} debía ser administración`);
    if (kindOf("activity") !== "datos" || sectionOf("activity") !== "Actividades" || sectionOf("nunca_vista") !== "Otras" || kindOf("nunca_vista") !== "datos") throw new Error("tipo y sección por defecto");
    if (!SECTIONS.includes("Cargos y dotación") || !SECTIONS.includes("Plan de acción") || new Set(SECTIONS).size !== SECTIONS.length) throw new Error("secciones: " + SECTIONS.join(","));
    if (entitiesOfSections(["Actividades"]).join() !== "activity,activities" || entitiesOfKinds(["admin"]).length !== 6) throw new Error("entidades por sección o tipo");
  });

  await check("Los verbos y orígenes se leen en español, y uno desconocido no rompe (se muestra tal cual)", () => {
    if (actionLabel("insert") !== "Creó" || actionLabel("update") !== "Modificó" || actionLabel("delete") !== "Eliminó") throw new Error("verbos");
    if (actionLabel("rara") !== "Rara" || originLabel("sheet") !== "Hoja de Google" || originLabel("app") !== "Aplicación" || originLabel("otro") !== "otro") throw new Error("desconocidos");
  });

  await check("Nombres de campo: los conocidos en español, y los demás se leen separando palabras (nunca queda un nombre técnico pegado)", () => {
    if (fieldLabel("timeAvgMin") !== "Tiempo promedio (min)" || fieldLabel("headcount") !== "Cantidad de personas" || fieldLabel("employeeCode") !== "Colaborador (ID)") throw new Error("conocidos");
    if (fieldLabel("campoNuevoDeEjemplo") !== "Campo nuevo de ejemplo" || fieldLabel("un_campo_raro") !== "Un campo raro") throw new Error("separación: " + fieldLabel("campoNuevoDeEjemplo"));
  });

  await check("Lo que cambió, por campo: al crear solo el valor nuevo, al eliminar el que tenía, al modificar antes y después; sin campos técnicos ni referencias internas", () => {
    const diff = { name: { from: "Arqueo", to: "Arqueo y vales" }, positionId: { from: "a1", to: "b2" }, version: { from: 1, to: 2 }, mandatory: { from: false, to: true }, dueDate: { from: null, to: "2026-11-30" }, headcount: { from: 2, to: 4 } };
    const m = diffLines("update", diff);
    if (m.length !== 4 || m.some((l) => /Id\b|version/i.test(l.field))) throw new Error("campos mostrados: " + JSON.stringify(m.map((l) => l.field)));
    const por = Object.fromEntries(m.map((l) => [l.field, l]));
    if (por["Nombre"].from !== "Arqueo" || por["Nombre"].to !== "Arqueo y vales" || por["Obligatoria"].from !== "No" || por["Obligatoria"].to !== "Sí" || por["Fecha de vencimiento"].from !== "—" || por["Fecha de vencimiento"].to !== "30/11/2026") throw new Error("valores: " + JSON.stringify(por));
    const c = diffLines("insert", { name: { from: null, to: "Nueva" } });
    if (c[0].from !== null || c[0].to !== "Nueva") throw new Error("crear");
    const e = diffLines("delete", { name: { from: "Vieja", to: null } });
    if (e[0].to !== null || e[0].from !== "Vieja") throw new Error("eliminar");
    if (diffLines("update", null).length || diffLines("update", undefined).length) throw new Error("sin detalle");
    if (diffText("update", { name: { from: "A", to: "B" } }) !== "Nombre: A → B" || diffText("insert", { name: { from: null, to: "B" } }) !== "Nombre: B" || diffText("delete", { name: { from: "A", to: null } }) !== "Nombre: A") throw new Error("texto");
  });

  await check("Valores legibles: vacío «—», Sí/No, números con formato colombiano, fechas dd/mm/aaaa, listas y textos largos recortados", () => {
    if (valueText(null) !== "—" || valueText("") !== "—" || valueText(undefined) !== "—" || valueText(true) !== "Sí" || valueText(false) !== "No") throw new Error("básicos");
    if (valueText(1234.5) !== (1234.5).toLocaleString("es-CO", { maximumFractionDigits: 4 }) || valueText("2026-03-09T10:00:00Z") !== "09/03/2026" || valueText(["a", "b"]) !== "a, b" || valueText([]) !== "—") throw new Error("formatos");
    const largo = valueText("x".repeat(500));
    if (largo.length !== 158 || !largo.endsWith("…")) throw new Error("largo: " + largo.length);
  });

  await check("Preparar la búsqueda: sin tildes ni mayúsculas, palabras separadas, los comodines de LIKE escapados y un tope; una palabra solo de escapes no «coincide» con todo", () => {
    if (fold("Eliminó ÁÉÍÓÚ Ñandú") !== "elimino aeiou nandu") throw new Error("fold");
    if (searchWords("  Arqueo   VALES ").join("|") !== "arqueo|vales" || searchWords("").length !== 0 || searchWords(undefined).length !== 0) throw new Error("palabras");
    if (searchWords("100%_a\\b").join() !== "100\\%\\_a\\\\b") throw new Error("escape: " + searchWords("100%_a\\b").join());
    if (searchWords("a b c d e f g h i j").length !== 8 || searchWords("x".repeat(500))[0].length !== 60) throw new Error("topes");
    if (unescapeWord("100\\%\\_a\\\\b") !== "100%_a\\b") throw new Error("desescapar");
    const barra = searchWords("\\")[0];
    if (entitiesMatchingWord(barra).length !== 0 || actionsMatchingWord(barra).length !== 0) throw new Error("una barra sola no debe coincidir con secciones ni acciones");
    if (entitiesMatchingWord("") .length !== 0 || actionsMatchingWord("").length !== 0) throw new Error("palabra vacía");
    if (!entitiesMatchingWord("actividades").includes("activity") || !entitiesMatchingWord("medibilid").includes("measurability") || entitiesMatchingWord("zzz").length) throw new Error("secciones por palabra");
    if (actionsMatchingWord("elimin").join() !== "delete" || actionsMatchingWord("cre").join() !== "insert" || actionsMatchingWord("zzz").length) throw new Error("acciones por palabra");
  });
}
main().then(summary);
