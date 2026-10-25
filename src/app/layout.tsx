import type { Metadata } from "next";
import Image from "next/image";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { UserBadge } from "@/components/UserBadge";

export const metadata: Metadata = {
  title: { default: "Estudio de Actividades y Cargas Laborales", template: "%s · Estudio de cargas" },
  description: "Estudio de actividades, cargas laborales y rediseño de cargos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <div className="brand">
              <Image className="logo" src="/logo-megatiendas.png" alt="Megatiendas" width={170} height={62} priority />
              <div className="brand-name">Estudio de actividades y cargas laborales</div>
            </div>
            <div className="topbar-user"><UserBadge /></div>
          </div>
        </header>
        <Nav />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
