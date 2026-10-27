import Link from "next/link";
import { cookies } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { signOutAction } from "@/app/estudio/actions";
import { guestSignOut } from "@/app/ingreso/actions";
import { GUEST_COOKIE, verifyGuest } from "@/lib/guest";
import { AutoRefresh } from "./AutoRefresh";

/** Zonas «cuenta» (correo) y «sesión» (Salir) del encabezado, separadas entre sí y del nombre de la aplicación. */
export async function UserBadge() {
  const user = await getUser();
  if (!user) {
    // Invitado (demostración): no es una cuenta; solo puede ver los datos de ejemplo.
    if (verifyGuest((await cookies()).get(GUEST_COOKIE)?.value)) {
      return (
        <>
          <div className="account" aria-label="Cuenta">
            <span className="account-avatar" aria-hidden="true">I</span>
            <span className="account-text">
              <span className="account-mail">Invitado</span>
              <span className="account-label"><span className="account-dot" aria-hidden="true" />Demostración con datos de ejemplo</span>
            </span>
          </div>
          <form className="session" action={guestSignOut}><button className="btn" type="submit">Salir</button></form>
        </>
      );
    }
    return <div className="session"><Link className="btn solid" href="/ingreso">Ingresar</Link></div>;
  }
  return (
    <>
      <AutoRefresh />
      <div className="account" aria-label="Cuenta">
        <span className="account-avatar" aria-hidden="true">{(user.email ?? "?").charAt(0).toUpperCase()}</span>
        <span className="account-text">
          <span className="account-mail">{user.email}</span>
          <span className="account-label"><span className="account-dot" aria-hidden="true" />Sesión iniciada</span>
        </span>
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
