"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { GRUPO_RESULTADOS, MENU, isActive, type NavLink } from "@/lib/nav";

/** Iconos de línea (24×24) por ruta; solo decorativos. */
const ICON: Record<string, string> = {
  "/": "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  "/parametros": "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  "/estudio": "M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM8 8h8M8 12h8M8 16h5",
  "/cargos": "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  "/actividades": "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  "/calculo": "M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "/dotacion": "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8v6M14 11h6M17 20h4",
  "/drill": "M4 4h16M7 9h10M10 14h4M12 19v-1",
  grupo: "M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9",
  resultados: "M4 20h16M7 20V11M12 20V5M17 20v-6",
  "/sedes": "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6",
  "/historia": "M3 3v18h18M7 15l4-4 3 3 5-6",
  "/integraciones": "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  "/usuarios": "M16 11a4 4 0 10-8 0 4 4 0 008 0zM3 21a7 7 0 0114 0M17 8h4M19 6v4M18 21a5 5 0 014-4.9",
  "/agente": "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
};

const Icon = ({ d }: { d?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d ?? ICON["/"]} /></svg>
);

/** `allowed`: rutas del menú a las que la persona tiene acceso (D-91); null = sin restricción (demostración), donde «Usuarios y roles» no se ofrece. */
export function Nav({ allowed = null }: { allowed?: string[] | null }) {
  const path = usePathname();
  const ok = (href: string) => (allowed ? allowed.includes(href) : href !== "/usuarios");
  const [picked, setPicked] = useState<{ group: string; at: string } | null>(null); // grupo que la persona abrió o cerró a mano EN ESTA página; al cambiar de página vale el que contiene la página
  const groups = MENU.flatMap((e) => ("group" in e ? [{ ...e, items: e.items.filter((i) => ok(i.href)) }] : [])).filter((g) => g.items.length > 0);
  const inside = groups.find((g) => g.items.some((i) => isActive(path, i.href)))?.group ?? "";
  const current = picked && picked.at === path ? picked.group : inside; // un solo grupo desplegado a la vez
  const link = (i: NavLink, sub = false) => (
    <Link key={i.href} href={i.href} className={sub ? "sub-link" : undefined} aria-current={isActive(path, i.href) ? "page" : undefined}>
      {!sub && <Icon d={ICON[i.href]} />}{i.label}
    </Link>
  );
  return (
    <nav className="nav" aria-label="Principal">
      <div className="nav-in">
        {MENU.map((entry) => {
          if ("href" in entry) return ok(entry.href) ? link(entry) : null;
          const k = groups.findIndex((g) => g.group === entry.group);
          if (k < 0) return null;
          const open = current === entry.group;
          return (
            <button key={entry.group} type="button" className={`nav-group${inside === entry.group ? " on" : ""}`} aria-expanded={open} aria-controls={`nav-sub-${k}`} onClick={() => setPicked({ group: open ? "" : entry.group, at: path })}>
              <Icon d={entry.group === GRUPO_RESULTADOS ? ICON.resultados : ICON.grupo} />{entry.group}
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          );
        })}
      </div>
      {groups.map((g, k) => g.group === current ? <div key={g.group} id={`nav-sub-${k}`} className="nav-sub" role="group" aria-label={g.group}><div className="nav-in">{g.items.map((i) => link(i, true))}</div></div> : null)}
    </nav>
  );
}
