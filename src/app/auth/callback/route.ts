import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:/g, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = `${proto}://${host}`;
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/estudio`);
  }
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
