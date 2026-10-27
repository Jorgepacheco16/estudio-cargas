import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { UserBadge } from "@/components/UserBadge";
import { BalanceLogo } from "@/components/brand/BalanceLogo";
import { APP, CLIENT } from "@/lib/client-theme";

export const metadata: Metadata = {
  title: { default: `${APP.name} · ${APP.tagline}`, template: `%s · ${APP.name}` },
  description: "BalanceAPP: estudio de actividades, cargas laborales y rediseño de cargos",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La página de ingreso se muestra sola, sin encabezado ni menú (el proxy entrega la ruta en x-pathname).
  const bare = ((await headers()).get("x-pathname") ?? "").startsWith("/ingreso");
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
            <Nav />
            <div className="wrap">{children}</div>
          </>
        )}
      </body>
    </html>
  );
}
