/**
 * Siembra para e2e/usuarios.spec.ts: crea en la autenticación simulada la cuenta del Super usuario y, en la base de pruebas, un estudio con un cargo y una actividad.
 * Requiere la autenticación simulada en marcha (tests/support/mock-auth.ts) y DATABASE_URL apuntando a la base de pruebas.
 */
import { createDb } from "../../src/db/client";
import { createStudy } from "../../src/server/studies";
import { saveEntry } from "../../src/server/entry/service";
import { entryDef } from "../../src/server/entry/defs";

const cells = (id: "2" | "3", by: Record<string, string>) => { const d = entryDef(id)!; const o: Record<string, string> = {}; for (const [f, v] of Object.entries(by)) o[d.fields.find((x) => x.field === f)!.col] = v; return o; };
const AUTH = process.env.MOCK_AUTH_URL ?? "http://127.0.0.1:54321";

(async () => {
  const r = await fetch(`${AUTH}/__user`, { method: "POST", body: JSON.stringify({ email: "admin@prueba.co", password: "Clave-de-admin-1" }) });
  const admin = (await r.json()) as { id: string };
  const app = createDb(process.env.DATABASE_URL!, 2);
  const study = await createStudy(app.db, admin.id, "Estudio de pruebas e2e");
  const c = await saveEntry(app.db, admin.id, study, "2", cells("2", { area: "Cajas", site: "Prado", position: "Cajero", headcount: "4", weeklyHours: "42" }), {});
  const a = await saveEntry(app.db, admin.id, study, "3", cells("3", { kind: "REAL", code: "E-1", area: "Cajas", site: "Prado", position: "Cajero", name: "Arqueo de caja", calcMode: "Por evento", executions: "2", period: "Día", scope: "Total del cargo en la sede", timeAvg: "10" }), {});
  const c2 = await saveEntry(app.db, admin.id, study, "2", cells("2", { area: "Domicilios", site: "Prado", position: "Auxiliar", headcount: "2", weeklyHours: "42" }), {});
  const a2 = await saveEntry(app.db, admin.id, study, "3", cells("3", { kind: "REAL", code: "E-2", area: "Domicilios", position: "Auxiliar", site: "Prado", name: "Entrega de pedidos", calcMode: "Por evento", executions: "3", period: "Día", scope: "Total del cargo en la sede", timeAvg: "15" }), {});
  if (!c2.ok || !a2.ok) throw new Error("no se pudo sembrar el área 2: " + JSON.stringify([c2, a2]));
  if (!c.ok || !a.ok) throw new Error("no se pudo sembrar: " + JSON.stringify([c, a]));
  console.log("sembrado:", study);
  await app.client.end();
})().catch((e) => { console.error(e); process.exit(1); });
