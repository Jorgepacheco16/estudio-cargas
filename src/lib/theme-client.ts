/**
 * Parte de navegador del modo de color (D-98): aplicar la elección al instante (atributo data-theme de <html>), recordarla en la cookie y enterarse de cambios, ya sea por la
 * persona o porque cambió la configuración del equipo. Va aparte del componente del botón para que el componente solo describa la pantalla.
 */
import { isDark, themeAttribute, themeCookie, type Theme } from "./theme";

const EVENT = "ba-theme";
const query = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(t: Theme): void {
  const attr = themeAttribute(t), root = document.documentElement;
  if (attr) root.setAttribute("data-theme", attr); else root.removeAttribute("data-theme");
  document.cookie = themeCookie(t, location.protocol === "https:");
  window.dispatchEvent(new Event(EVENT));
}

/** ¿Se está viendo el modo oscuro ahora mismo? Lee lo que realmente tiene <html>, que es lo que pintan los estilos. */
export function currentlyDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  return isDark(attr === "dark" || attr === "light" ? attr : "auto", query().matches);
}

export function subscribeTheme(onChange: () => void): () => void {
  const mq = query();
  window.addEventListener(EVENT, onChange);
  mq.addEventListener("change", onChange);
  return () => { window.removeEventListener(EVENT, onChange); mq.removeEventListener("change", onChange); };
}
