import Image from "next/image";
import Link from "next/link";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BalanceLogo } from "@/components/brand/BalanceLogo";
import { GUEST_COOKIE, guestConfigured, verifyGuest } from "@/lib/guest";
import { getUser } from "@/lib/supabase/server";
import { guestSignIn, signInWithGoogle, signInWithPassword } from "./actions";

/** Inter (SemiBold y SemiBold cursiva) incluida en la aplicación (no se descarga de internet); solo para la frase de la imagen. Licencia: src/app/fonts/Inter-LICENSE.txt */
const inter = localFont({
  src: [
    { path: "../fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/Inter-SemiBoldItalic.woff2", weight: "600", style: "italic" },
  ],
  display: "swap",
});

export const metadata = { title: "Ingresar" };

const ERRORS: Record<string, string> = {
  credenciales: "El usuario o la clave no son correctos. Revíselos e intente de nuevo.",
  oauth: "No se pudo iniciar sesión con Google. Intente de nuevo.",
  espere: "Demasiados intentos seguidos. Espere un minuto antes de intentarlo de nuevo.",
  "no-disponible": "Este tipo de acceso no está disponible por ahora. Comuníquese con el administrador.",
};

/** Página de inicio (D-76): lo primero que ve quien abre el enlace. Usuarios con usuario y clave o Google; invitados con el usuario y la clave de la demostración. */
export default async function Ingreso({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const guest = verifyGuest((await cookies()).get(GUEST_COOKIE)?.value);
  if (await getUser()) redirect("/estudio");
  if (guest && !sp.requiere) redirect("/");
  const invitado = sp.modo === "invitado";
  const error = sp.error ? ERRORS[sp.error] ?? ERRORS.credenciales : "";
  return (
    <main className="auth">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-card">
          <div className="auth-logo"><BalanceLogo size={48} /></div>
          <h1 id="auth-title">{invitado ? "Acceso de invitado" : "Ingresar"}</h1>
          <p className="auth-sub">{invitado ? "Escriba el usuario y la clave de la demostración para ver la aplicación con datos de ejemplo." : <>Estudio de actividades y cargas laborales.<br />Entre con su cuenta.</>}</p>
          {sp.requiere && guest && <div className="banner" role="status">Esa sección requiere una cuenta de usuario. Ingrese con su cuenta para continuar.</div>}
          {error && <div className="banner auth-error" role="alert">{error}</div>}
          {invitado ? (
            <form action={guestSignIn} className="auth-form">
              {!guestConfigured() && <div className="banner" role="status">El acceso de invitado aún no está habilitado.</div>}
              <label className="f" htmlFor="g-user">Usuario de la demostración</label>
              <input id="g-user" name="user" type="text" autoComplete="username" required maxLength={120} />
              <label className="f" htmlFor="g-pass">Clave</label>
              <input id="g-pass" name="password" type="password" autoComplete="current-password" required maxLength={200} />
              <button className="btn solid auth-btn" type="submit">Entrar a la demostración</button>
              <Link className="auth-link" href="/ingreso">← Volver a ingresar con mi cuenta</Link>
            </form>
          ) : (
            <>
              <form action={signInWithPassword} className="auth-form">
                <label className="f" htmlFor="u-email">Correo electrónico</label>
                <input id="u-email" name="email" type="email" autoComplete="username" required maxLength={200} />
                <label className="f" htmlFor="u-pass">Clave</label>
                <input id="u-pass" name="password" type="password" autoComplete="current-password" required maxLength={200} />
                <button className="btn solid auth-btn" type="submit">Entrar</button>
              </form>
              <div className="auth-or"><span>o</span></div>
              <form action={signInWithGoogle}>
                <button className="btn auth-btn" type="submit">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                    <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
                  </svg>
                  Entrar con Google
                </button>
              </form>
              <p className="auth-guest">¿Solo quiere conocer la aplicación? <Link className="auth-link" href="/ingreso?modo=invitado">Ingresar como invitado</Link></p>
            </>
          )}
        </div>
      </section>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art-figure">
          <Image src="/ingreso-equipo.webp" alt="" fill priority unoptimized sizes="70vw" />
          <p className={`auth-art-text ${inter.className}`}>Equilibre la carga de trabajo con la capacidad de su equipo.</p>
        </div>
      </aside>
    </main>
  );
}
