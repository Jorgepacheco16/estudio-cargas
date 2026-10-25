import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { signOutAction } from "@/app/estudio/actions";
import { AutoRefresh } from "./AutoRefresh";

/** Zonas «cuenta» (correo) y «sesión» (Salir) del encabezado, separadas entre sí y del nombre de la aplicación. */
export async function UserBadge() {
  const user = await getUser();
  if (!user) return <div className="session"><Link className="btn solid" href="/login">Ingresar</Link></div>;
  return (
    <>
      <AutoRefresh />
      <div className="account" aria-label="Cuenta">
        <span className="account-label">Sesión iniciada</span>
        <span className="account-mail" title={user.email ?? undefined}>{user.email}</span>
      </div>
      <form className="session" action={signOutAction}>
        <button className="btn" type="submit">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          Salir
        </button>
      </form>
    </>
  );
}
