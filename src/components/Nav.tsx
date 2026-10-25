"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Iconos de línea (24×24) para cada opción del menú; solo decorativos. */
const ICON: Record<string, string> = {
  "/": "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  "/cargos": "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  "/calculo": "M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "/sedes": "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6",
  "/drill": "M4 4h16M7 9h10M10 14h4M12 19v-1",
  "/actividades": "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  "/datos": "M4 20h4l10-10-4-4L4 16v4zM13 7l4 4",
  "/estudio": "M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM8 8h8M8 12h8M8 16h5",
  "/historia": "M3 3v18h18M7 15l4-4 3 3 5-6",
  "/integraciones": "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  "/agente": "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
};

const ITEMS = [
  { href: "/", label: "Tablero" },
  { href: "/cargos", label: "Cargos y dotación" },
  { href: "/calculo", label: "Cálculo de tiempos (4a)" },
  { href: "/sedes", label: "Comparador de sedes" },
  { href: "/drill", label: "Drill-down" },
  { href: "/actividades", label: "Actividades" },
  { href: "/datos", label: "Datos de entrada" },
  { href: "/estudio", label: "Estudio" },
  { href: "/historia", label: "Historia y desviaciones" },
  { href: "/integraciones", label: "Integraciones" },
  { href: "/agente", label: "Agente de IA" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Principal">
      <div className="nav-in">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} aria-current={path === i.href || (i.href !== "/" && path.startsWith(i.href + "/")) ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[i.href]} /></svg>
            {i.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
