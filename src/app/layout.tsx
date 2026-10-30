import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { UserBadge } from "@/components/UserBadge";
import { BalanceLogo } from "@/components/brand/BalanceLogo";
import { APP, CLIENT } from "@/lib/client-theme";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { allowedHrefs } from "@/lib/access";
import { menuHrefs } from "@/lib/nav";
import { exitViewAsAction } from "@/app/usuarios/actions";

export const metadata: Metadata = {
  title: { default: `${APP.name} · ${APP.tagline}`, template: `%s · ${APP.name}` },
  description: "BalanceAPP: estudio de actividades, cargas laborales y rediseño de cargos",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La página de ingreso se muestra sola, sin encabezado ni menú (el proxy entrega la ruta en x-pathname).
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = path.startsWith("/ingreso") || path.startsWith("/invitacion");
  // D-91: el menú solo ofrece lo que el rol de la persona permite (sin sesión, la demostración no tiene restricciones).
  const user = bare ? null : await getUser();
  const study = user ? await activeStudyId(user.id).catch(() => null) : null;
  const allowed = allowedHrefs(menuHrefs(), study);
  return (
    <html lang="es">
      <body>
        {bare ? children : (
          <>
            <header className="topbar">
              <div className="topbar-in">
                <div className="brand">
                  <BalanceLogo size={36} />
                  <div className="brand-name">Estudio de actividades y cargas laborales</div>
                </div>
                <div className="topbar-user">
                  <div className="client" aria-label={`Cliente: ${CLIENT.name}`}>
                    <Image className="client-logo" src={CLIENT.logo} alt={CLIENT.name} width={CLIENT.logoWidth} height={CLIENT.logoHeight} priority />
                  </div>
                  <UserBadge />
                </div>
              </div>
            </header>
            {user?.viewAs && (
              <div className="viewas-bar" role="status">
                <span>Está viendo la aplicación como <b>{user.email ?? "otra persona"}</b> · solo lectura: no se puede guardar nada.</span>
                <form action={exitViewAsAction}><button className="btn" type="submit">Salir de esta vista</button></form>
              </div>
            )}
            <Nav allowed={allowed} />
            <div className="wrap">{children}</div>
          </>
        )}
      </body>
    </html>
  );
}
