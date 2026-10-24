import { NextResponse, type NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Descarga Code.gs con la dirección del webhook de ESTA instalación ya escrita. No contiene secretos: WEBHOOK_SECRET se guarda en las propiedades del script. */
export async function GET(req: NextRequest) {
  const src = readFileSync(join(process.cwd(), "apps-script", "Code.gs"), "utf8");
  const url = `${req.nextUrl.origin}/api/sheets/webhook`;
  return new NextResponse(src.replace("https://TU-DOMINIO.vercel.app/api/sheets/webhook", url), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="Code.gs"', "Cache-Control": "no-store" } });
}
