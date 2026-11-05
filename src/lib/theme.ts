/**
 * Modo de color de la aplicación (D-98): sin elección (`auto`) sigue la configuración del equipo; al pulsar el botón del encabezado la persona elige `light` o `dark` y se
 * recuerda en una cookie, para que la página llegue ya pintada con el modo correcto (sin parpadeo). Los estilos leen el atributo data-theme de <html>: sin atributo = según el equipo.
 * Funciones puras: las usan el diseño general (servidor), el botón (navegador) y las pruebas.
 */
export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "ba_theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Solo se aceptan los tres valores conocidos; cualquier otra cosa (cookie ajena o manipulada) es «auto». */
export function parseTheme(v: unknown): Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v) ? (v as Theme) : "auto";
}

/** Valor del atributo data-theme de <html>: ninguno cuando no hay elección. */
export const themeAttribute = (t: Theme): "light" | "dark" | undefined => (t === "auto" ? undefined : t);

/** Texto de la cookie que guarda la elección (`auto` la borra). Solo guarda una preferencia visual: no lleva datos de la persona. */
export function themeCookie(t: Theme, secure: boolean): string {
  const base = `${THEME_COOKIE}=${t === "auto" ? "" : t}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  return t === "auto" ? `${base}; Max-Age=0` : `${base}; Max-Age=${ONE_YEAR}`;
}

/** El modo que se verá: la elección si la hay; si no, el del equipo. */
export const isDark = (t: Theme, systemDark: boolean): boolean => (t === "auto" ? systemDark : t === "dark");

/** El que sigue al pulsar el botón: siempre una elección explícita, la contraria a la que se ve ahora. */
export const toggledTheme = (dark: boolean): Theme => (dark ? "light" : "dark");
