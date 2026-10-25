"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MENU, isActive, type NavLink } from "@/lib/nav";

/** Iconos de línea (24×24) por ruta; solo decorativos. */
const ICON: Record<string, string> = {
  "/": "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  "/datos/parametros": "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  "/estudio": "M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM8 8h8M8 12h8M8 16h5",
  "/cargos": "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  "/actividades": "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  "/calculo": "M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "/drill": "M4 4h16M7 9h10M10 14h4M12 19v-1",
  grupo: "M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9",
  "/sedes": "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6",
  "/historia": "M3 3v18h18M7 15l4-4 3 3 5-6",
  "/integraciones": "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  "/agente": "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
};

const Icon = ({ d }: { d?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d ?? ICON["/"]} /></svg>
);

export function Nav() {
  const path = usePathname();
  const [opened, setOpened] = useState(false);
  const link = (i: NavLink, sub = false) => (
    <Link key={i.href} href={i.href} className={sub ? "sub-link" : undefined} aria-current={isActive(path, i.href) ? "page" : undefined}>
      {!sub && <Icon d={ICON[i.href]} />}{i.label}
    </Link>
  );
  return (
    <nav className="nav" aria-label="Principal">
      <div className="nav-in">
        {MENU.map((e) => {
          if ("href" in e) return link(e);
          const inside = e.items.some((i) => isActive(path, i.href));
          const open = opened || inside; // dentro de una subsección el grupo permanece desplegado
          return (
            <button key={e.group} type="button" className={`nav-group${inside ? " on" : ""}`} aria-expanded={open} aria-controls="nav-sub" onClick={() => setOpened(!opened)}>
              <Icon d={ICON.grupo} />{e.group}
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          );
        })}
      </div>
      {MENU.filter((e): e is Extract<typeof e, { group: string }> => "group" in e).map((g) => {
        const open = opened || g.items.some((i) => isActive(path, i.href));
        return open ? <div key={g.group} id="nav-sub" className="nav-sub" role="group" aria-label={g.group}><div className="nav-in">{g.items.map((i) => link(i, true))}</div></div> : null;
      })}
    </nav>
  );
}
