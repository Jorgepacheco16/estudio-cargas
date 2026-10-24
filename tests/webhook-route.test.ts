import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { sign } from "../src/server/webhook";
import { check, summary } from "./helpers";

/** Ruta POST /api/sheets/webhook: firma, ventana de tiempo, contrato del cuerpo y hoja desconocida. No llama a Google. */
process.env.SHEETS_WEBHOOK_SECRET = "secreto-de-prueba-0123456789abcdef";
const SECRET = process.env.SHEETS_WEBHOOK_SECRET;

const body = (o: Record<string, unknown> = {}) => JSON.stringify({ eventId: randomUUID(), spreadsheetId: `no-conectada-${randomUUID()}`, sheetName: "3_Actividades", kind: "edit", range: { row: 7, col: 1, rows: 1, cols: 1 }, values: [], editedAt: new Date().toISOString(), ...o });
const req = (raw: string, h: { ts?: number; sig?: string; secret?: string } = {}) => {
  const ts = h.ts ?? Date.now();
  return new NextRequest("http://localhost/api/sheets/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-timestamp": String(ts), "x-signature": h.sig ?? sign(raw, ts, h.secret ?? SECRET), "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
};

async function main() {
  const { POST } = await import("../src/app/api/sheets/webhook/route");
  const code = async (r: NextRequest) => { const res = await POST(r); return { s: res.status, j: (await res.json()) as { error?: { code: string } } }; };

  await check("Firma válida pero hoja no conectada → 404 (sin tocar la base ni Google)", async () => {
    const r = await code(req(body()));
    if (r.s !== 404 || r.j.error?.code !== "NOT_FOUND") throw new Error(JSON.stringify(r));
  });
  await check("Secreto incorrecto, cuerpo alterado, evento viejo y firma ausente → 401", async () => {
    const raw = body();
    for (const [name, r] of [
      ["secreto incorrecto", req(raw, { secret: "otro-secreto" })],
      ["cuerpo alterado", req(raw.replace("3_Actividades", "10_Plan_accion"), { sig: sign(raw, Date.now(), SECRET) })],
      ["evento viejo", req(raw, { ts: Date.now() - 10 * 60_000 })],
      ["firma no hexadecimal", req(raw, { sig: "zzzz" })],
      ["firma vacía", req(raw, { sig: "" })],
    ] as const) { const x = await code(r); if (x.s !== 401) throw new Error(`${name}: ${x.s}`); }
  });
  await check("Firma válida con cuerpo fuera de contrato (campo extra, JSON roto, UUID inválido) → 400", async () => {
    for (const raw of [body({ extra: 1 }), "{no es json", body({ eventId: "no-es-uuid" })]) { const x = await code(req(raw)); if (x.s !== 400) throw new Error(`${raw.slice(0, 20)}: ${x.s}`); }
  });
  await check("Sin SHEETS_WEBHOOK_SECRET configurado el servicio responde 503 y no acepta nada", async () => {
    delete process.env.SHEETS_WEBHOOK_SECRET;
    const x = await code(req(body()));
    process.env.SHEETS_WEBHOOK_SECRET = SECRET;
    if (x.s !== 503) throw new Error(String(x.s));
  });
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
