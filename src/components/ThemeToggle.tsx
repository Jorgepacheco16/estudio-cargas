"use client";
import { useSyncExternalStore } from "react";
import { toggledTheme, type Theme } from "@/lib/theme";
import { applyTheme, currentlyDark, subscribeTheme } from "@/lib/theme-client";

/**
 * Interruptor del modo de color del encabezado (D-98): un solo botón con un sol y una luna que alterna entre el modo claro y el oscuro. Aplica el cambio al instante y lo
 * recuerda; mientras la persona no lo pulse, la aplicación sigue la configuración de su equipo. Qué modo está activo lo resaltan los estilos con el mismo atributo que pinta
 * la página (data-theme o, sin él, la configuración del equipo), así el resalte nunca llega tarde ni se contradice con los colores. `initial` es lo que ya dice la cookie.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const dark = useSyncExternalStore(subscribeTheme, currentlyDark, () => initial === "dark");
  return (
    <button type="button" className="theme-switch" role="switch" aria-checked={dark} aria-label="Modo oscuro" title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} onClick={() => applyTheme(toggledTheme(dark))}>
      <svg className="ts-sun" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
      </svg>
      <svg className="ts-moon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 14.2A8 8 0 019.8 4 8 8 0 1020 14.2z" />
      </svg>
    </button>
  );
}
