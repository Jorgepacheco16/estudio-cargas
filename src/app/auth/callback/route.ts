import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NEXT_COOKIE, NEXT_PATTERN } from "@/lib/invitation";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:/g, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = `${proto}://${host}`;
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) {
      // Si venía de un enlace de invitación, vuelve a esa página (la dirección se guardó en una cookie breve y solo se acepta la forma /invitacion/<enlace>).
      const next = req.cookies.get(NEXT_COOKIE)?.value;
      const res = NextResponse.redirect(`${origin}${next && NEXT_PATTERN.test(next) ? next : "/estudio"}`);
      res.cookies.delete(NEXT_COOKIE);
      return res;
    }
  }
  return NextResponse.redirect(`${origin}/ingreso?error=oauth`);
}
