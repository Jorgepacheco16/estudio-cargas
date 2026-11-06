/**
 * Siembra para e2e/usuarios.spec.ts: crea en la autenticación simulada la cuenta del Super usuario y, en la base de pruebas, un estudio con un cargo y una actividad.
 * Requiere la autenticación simulada en marcha (tests/support/mock-auth.ts) y DATABASE_URL apuntando a la base de pruebas.
 */
import { and, eq } from "drizzle-orm";
import { createDb, withRls } from "../../src/db/client";
import { positions } from "../../src/db/schema";
import { createStudy } from "../../src/server/studies";
import { saveEntry } from "../../src/server/entry/service";
import { entryDef } from "../../src/server/entry/defs";
import { saveShift } from "../../src/server/shifts";
import { generateVersion } from "../../src/server/report-version";
import type { SectionPayload } from "../../src/domain/report-text";

const cells = (id: "2" | "3", by: Record<string, string>) => { const d = entryDef(id)!; const o: Record<string, string> = {}; for (const [f, v] of Object.entries(by)) o[d.fields.find((x) => x.field === f)!.col] = v; return o; };
const AUTH = process.env.MOCK_AUTH_URL ?? "http://127.0.0.1:54321";

(async () => {
  const r = await fetch(`${AUTH}/__user`, { method: "POST", body: JSON.stringify({ email: "admin@prueba.co", password: "Clave-de-admin-1" }) });
  const admin = (await r.json()) as { id: string };
  const app = createDb(process.env.DATABASE_URL!, 2);
  const study = await createStudy(app.db, admin.id, "Estudio de pruebas e2e");
  const c = await saveEntry(app.db, admin.id, study, "2", cells("2", { area: "Cajas", site: "Prado", position: "Cajero", headcount: "4", weeklyHours: "42" }), {});
  const a = await saveEntry(app.db, admin.id, study, "3", cells("3", { kind: "REAL", code: "E-1", area: "Cajas", site: "Prado", position: "Cajero", name: "Arqueo de caja", calcMode: "Por evento", executions: "2", period: "Día", scope: "Total del cargo en la sede", timeAvg: "10" }), {});
  const a3 = await saveEntry(app.db, admin.id, study, "3", cells("3", { kind: "REAL", code: "E-3", area: "Cajas", site: "Prado", position: "Cajero", name: "Conteo de efectivo", calcMode: "Por evento", executions: "1", period: "Día", scope: "Total del cargo en la sede", timeAvg: "15" }), {});
  if (!a3.ok) throw new Error("no se pudo sembrar E-3: " + JSON.stringify(a3));
  const c2 = await saveEntry(app.db, admin.id, study, "2", cells("2", { area: "Domicilios", site: "Prado", position: "Auxiliar", headcount: "2", weeklyHours: "42" }), {});
  const a2 = await saveEntry(app.db, admin.id, study, "3", cells("3", { kind: "REAL", code: "E-2", area: "Domicilios", position: "Auxiliar", site: "Prado", name: "Entrega de pedidos", calcMode: "Por evento", executions: "3", period: "Día", scope: "Total del cargo en la sede", timeAvg: "15" }), {});
  if (!c2.ok || !a2.ok) throw new Error("no se pudo sembrar el área 2: " + JSON.stringify([c2, a2]));
  if (!c.ok || !a.ok) throw new Error("no se pudo sembrar: " + JSON.stringify([c, a]));
  // turnos (lunes a sábado) para que Resultados › Reparto semanal tenga días con qué repartir
  for (const nombre of ["Cajero", "Auxiliar"]) {
    const [pos] = await withRls(app.db, { sub: admin.id }, (tx) => tx.select({ id: positions.id }).from(positions).where(and(eq(positions.studyId, study), eq(positions.name, nombre))));
    if (!pos) throw new Error("no está el cargo " + nombre);
    const t = await saveShift(app.db, admin.id, study, pos.id, undefined, { name: "Turno 1", start: "07:00", end: "15:00", breakMin: "30", days: ["0", "1", "2", "3", "4", "5"] });
    if (!t.ok) throw new Error("no se pudo sembrar el turno: " + JSON.stringify(t));
  }
  // borrador del texto del informe redactado por un agente simulado (nunca se llama al real en e2e): usa los marcadores de las dos primeras cifras de cada sección
  const agenteSimulado = async (p: SectionPayload) => ({ input: { paragraphs: [`Hay {{${p.cifras[0].id}}} y {{${p.cifras[Math.min(1, p.cifras.length - 1)].id}}} en esta sección.`] }, inputTokens: 1000, outputTokens: 200 });
  const v = await generateVersion(app.db, admin.id, study, agenteSimulado);
  if (!v.ok) throw new Error("no se pudo sembrar el borrador del informe: " + v.message);
  console.log("sembrado:", study);
  await app.client.end();
})().catch((e) => { console.error(e); process.exit(1); });
