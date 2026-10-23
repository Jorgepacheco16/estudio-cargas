import type { Metadata } from "next";
import Image from "next/image";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { UserBadge } from "@/components/UserBadge";

export const metadata: Metadata = {
  title: "Estudio de Actividades y Cargas Laborales",
  description: "Estudio de actividades, cargas laborales y rediseño de cargos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <Image className="logo" src="/logo-megatiendas.png" alt="Megatiendas" width={170} height={62} priority />
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div className="tag">Estudio de Actividades y Cargas Laborales</div>
              <UserBadge />
            </div>
          </div>
        </header>
        <Nav />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
