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
import { getDb } from "@/db/server";
import { listAreas } from "@/server/studies";
import { exitViewAsAction } from "@/app/usuarios/actions";

export const metadata: Metadata = {
  title: { default: `${APP.name} · ${APP.tagline}`, template: `%s · ${APP.name}` },
  description: "BalanceAPP: estudio de actividades, cargas laborales y rediseño de cargos",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La página de ingreso se muestra sola, sin encabezado ni menú (el proxy entrega la ruta en x-pathname).
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = path.startsWith("/ingreso") || path.startsWith("/invitacion") || path.startsWith("/privacidad");
  // D-91: el menú solo ofrece lo que el rol de la persona permite (sin sesión, la demostración no tiene restricciones).
  const user = bare ? null : await getUser();
  const study = user ? await activeStudyId(user.id).catch(() => null) : null;
  const allowed = allowedHrefs(menuHrefs(), study);
  // D-92: quien trabaja con algunas áreas lo ve siempre a la vista, porque todas las cifras son solo de esas áreas.
  const myAreas = study?.access && !study.access.allAreas && user ? (await listAreas(getDb(), user.id, study.id).catch(() => [])).map((a) => a.name) : null;
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
                <span>Está viendo la aplicación como <b>{study?.access?.displayName ?? user.email ?? "otra persona"}</b> · solo lectura: no se puede guardar nada.</span>
                <form action={exitViewAsAction}><button className="btn" type="submit">Salir de esta vista</button></form>
              </div>
            )}
            <Nav allowed={allowed} />
            {myAreas && <div className="areas-bar" role="note">Trabaja solo con {myAreas.length === 1 ? "el área" : "las áreas"}: <b>{myAreas.join(", ") || "ninguna asignada"}</b>. Los registros, los totales y las exportaciones son solo de {myAreas.length === 1 ? "esa área" : "esas áreas"}.</div>}
            <div className="wrap">{children}</div>
          </>
        )}
      </body>
    </html>
  );
}
