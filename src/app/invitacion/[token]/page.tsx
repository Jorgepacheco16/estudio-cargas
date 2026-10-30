import Link from "next/link";
import { getDb } from "@/db/server";
import { getRealUser } from "@/lib/supabase/server";
import { lookupInvitation } from "@/server/access";
import { BalanceLogo } from "@/components/brand/BalanceLogo";
import { acceptAction, createAccountAction, googleInviteAction, signInExistingAction, switchAccountAction } from "../actions";

export const metadata = { title: "Invitación" };
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/** Página del enlace de invitación (pública): crear la clave, entrar con Google o con la cuenta de siempre, y aceptar. */
export default async function Invitacion({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const inv = TOKEN.test(token) ? await lookupInvitation(getDb(), token) : null;
  const shell = (children: React.ReactNode) => (
    <main className="invite-page">
      <section className="card invite-card">
        <div className="invite-brand"><BalanceLogo size={40} /></div>
        {children}
      </section>
    </main>
  );

  if (!inv || !inv.valid) {
    return shell(<>
      <h1>Esta invitación no sirve</h1>
      <p>El enlace no es válido, ya se usó o venció. Pida una invitación nueva a quien se la envió.</p>
      <p><Link className="btn" href="/ingreso">Ir a la página de ingreso</Link></p>
    </>);
  }

  const user = await getRealUser();
  const banner = (<>
    {sp.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
    {sp.ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
  </>);
  const intro = <p>Lo invitaron al estudio <b>{inv.studyName}</b> con el rol <b>{inv.roleName}</b>. La invitación es para <b>{inv.email}</b>.</p>;

  if (user) {
    const mine = (user.email ?? "").toLowerCase() === inv.email;
    return shell(<>
      <h1>Aceptar invitación</h1>
      {banner}{intro}
      {mine ? (
        <form action={acceptAction}><input type="hidden" name="token" value={token} /><button className="btn solid" type="submit">Aceptar y entrar</button></form>
      ) : (
        <>
          <p>Tiene la sesión abierta como <b>{user.email}</b>, que no es el correo invitado. Cierre esa sesión para continuar con <b>{inv.email}</b>.</p>
          <form action={switchAccountAction}><input type="hidden" name="token" value={token} /><button className="btn solid" type="submit">Cerrar sesión y continuar</button></form>
        </>
      )}
    </>);
  }

  return shell(<>
    <h1>Bienvenido</h1>
    {banner}{intro}
    <form action={createAccountAction} className="stack-form">
      <input type="hidden" name="token" value={token} />
      <h2>Cree su clave</h2>
      <div className="field"><label htmlFor="inv-correo">Correo</label><input id="inv-correo" value={inv.email} readOnly /></div>
      <div className="field"><label htmlFor="inv-clave">Clave (mínimo 10 caracteres)</label><input id="inv-clave" name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="inv-clave2">Repita la clave</label><input id="inv-clave2" name="again" type="password" required minLength={10} maxLength={72} autoComplete="new-password" /></div>
      <button className="btn solid" type="submit">Crear mi clave y entrar</button>
    </form>
    <div className="invite-sep" role="separator"><span>o</span></div>
    <form action={googleInviteAction}><input type="hidden" name="token" value={token} /><button className="btn" type="submit">Continuar con Google</button><p className="hint">Solo sirve si su cuenta de Google usa el correo {inv.email}.</p></form>
    <details className="adv" style={{ marginTop: 16 }}>
      <summary>Ya tengo cuenta con ese correo</summary>
      <form action={signInExistingAction} className="stack-form adv-body">
        <input type="hidden" name="token" value={token} />
        <div className="field"><label htmlFor="inv-clave3">Mi clave</label><input id="inv-clave3" name="password" type="password" required maxLength={72} autoComplete="current-password" /></div>
        <button className="btn" type="submit">Entrar y aceptar</button>
      </form>
    </details>
  </>);
}
