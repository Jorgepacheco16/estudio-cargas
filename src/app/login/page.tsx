import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authConfigured, createClient, getUser } from "@/lib/supabase/server";

async function signInWithGoogle() {
  "use server";
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { data, error } = await (await createClient()).auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export const metadata = { title: "Ingresar" };
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (await getUser()) redirect("/estudio");
  return (
    <main style={{ maxWidth: 460, margin: "32px auto" }}>
      <section className="card">
        <h1>Ingresar</h1>
        <p className="sub">Acceda con su cuenta de Google. Solo verá los estudios en los que tiene permiso.</p>
        {!authConfigured() && <div className="banner" style={{ marginTop: 12 }}>Faltan las variables de Supabase en el servidor.</div>}
        {sp.error && <div className="banner" style={{ marginTop: 12 }}>No se pudo iniciar sesión{sp.error === "oauth" ? " con Google" : ""}. Intente de nuevo.</div>}
        <form action={signInWithGoogle} style={{ marginTop: 16 }}>
          <button className="btn solid" type="submit" style={{ width: "100%" }}>Entrar con Google</button>
        </form>
      </section>
    </main>
  );
}
