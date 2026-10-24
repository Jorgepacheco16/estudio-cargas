"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Tablero" },
  { href: "/cargos", label: "Cargos y dotación" },
  { href: "/actividades", label: "Actividades" },
  { href: "/estudio", label: "Estudio (captura)" },
  { href: "/captura", label: "Hojas 5–10 y parámetros" },
  { href: "/integraciones", label: "Integraciones" },
  { href: "/agente", label: "Agente de IA" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Principal">
      <div className="nav-in">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>{i.label}</Link>
        ))}
      </div>
    </nav>
  );
}
