import { readFileSync } from "node:fs";
import { THEMES, THEME_COOKIE, isDark, parseTheme, themeAttribute, themeCookie, toggledTheme } from "../src/lib/theme";
import { check, summary } from "./helpers";

/**
 * Modo de color (D-98). Lo puro (qué valores se aceptan, la cookie, qué modo se ve y cuál sigue) y, sobre los estilos, dos protecciones contra el defecto que dio origen al
 * cambio: una regla escrita solo para el modo oscuro ELEGIDO (data-theme="dark") no se aplicaba cuando el modo oscuro venía de la configuración del equipo, y el texto del
 * encabezado se perdía sobre el fondo oscuro. La prueba de navegador (e2e/publico.spec.ts) comprueba el comportamiento real.
 */
const css = readFileSync("src/app/globals.css", "utf8").replace(/\r\n/g, "\n");
const EXPLICIT = /^(?::root|html)\[data-theme="dark"\]\s+(.+)$/, SYSTEM = /^:root:not\(\[data-theme="light"\]\)\s+(.+)$/;

/** Reglas planas «selectores { declaraciones }» de la hoja (también las que están dentro de @media). */
function rules(text: string): { selectors: string[]; body: string }[] {
  return [...text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(",").map((x) => x.trim()).filter(Boolean), body: m[2] }));
}
const tokens = (body: string) => Object.fromEntries([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

async function main() {
  await check("Solo se aceptan los tres valores conocidos; cualquier otra cosa (cookie ajena o manipulada) es «auto», sin atributo", () => {
    for (const t of THEMES) if (parseTheme(t) !== t) throw new Error("debía aceptar " + t);
    for (const raro of [undefined, null, "", "Dark", "dark ", "<script>", "dark; Path=/", "1", 0, {}, ["dark"]]) if (parseTheme(raro) !== "auto") throw new Error("debía ser auto: " + JSON.stringify(raro));
    if (themeAttribute("auto") !== undefined || themeAttribute("light") !== "light" || themeAttribute("dark") !== "dark") throw new Error("atributo");
  });

  await check("La cookie guarda solo la elección (un año, SameSite=Lax, Secure si hay https) y «auto» la borra; sin datos de la persona", () => {
    const d = themeCookie("dark", true), l = themeCookie("light", false), a = themeCookie("auto", true);
    if (d !== `${THEME_COOKIE}=dark; Path=/; SameSite=Lax; Secure; Max-Age=31536000`) throw new Error(d);
    if (l !== `${THEME_COOKIE}=light; Path=/; SameSite=Lax; Max-Age=31536000`) throw new Error(l);
    if (a !== `${THEME_COOKIE}=; Path=/; SameSite=Lax; Secure; Max-Age=0`) throw new Error(a);
    if (/HttpOnly/i.test(d)) throw new Error("el botón la escribe desde el navegador: no puede ser HttpOnly");
  });

  await check("Qué modo se ve (la elección o, sin ella, el del equipo) y qué sigue al pulsar: siempre una elección explícita, la contraria a la que se ve", () => {
    if (!isDark("dark", false) || isDark("light", true) || !isDark("auto", true) || isDark("auto", false)) throw new Error("isDark");
    if (toggledTheme(true) !== "light" || toggledTheme(false) !== "dark") throw new Error("toggledTheme");
    // equipo oscuro sin elección: se ve oscuro y al pulsar pasa a claro (y se recuerda); equipo claro: al revés
    if (toggledTheme(isDark("auto", true)) !== "light" || toggledTheme(isDark("auto", false)) !== "dark") throw new Error("desde automático");
  });

  await check("Toda regla escrita para el modo oscuro elegido tiene su equivalente para el modo oscuro del equipo (el defecto de origen: el texto del encabezado se perdía)", () => {
    const explicit = new Set<string>(), system = new Set<string>();
    for (const r of rules(css)) for (const s of r.selectors) { const e = EXPLICIT.exec(s), y = SYSTEM.exec(s); if (e) explicit.add(e[1]); if (y) system.add(y[1]); }
    if (explicit.size < 6) throw new Error("se esperaban al menos 6 reglas del modo oscuro elegido; hay " + explicit.size);
    const faltan = [...explicit].filter((s) => !system.has(s));
    if (faltan.length) throw new Error("estas reglas no valen cuando el modo oscuro viene del equipo: " + faltan.join(" | "));
    for (const clave of [".brand-name", ".balance-word", ".nav a[aria-current=\"page\"]", ".btn.solid", "th"]) if (!system.has(clave)) throw new Error(`falta la regla para el equipo oscuro de «${clave}»`);
  });

  await check("Los colores del modo oscuro elegido y los del modo oscuro del equipo son exactamente los mismos (no se separan con el tiempo)", () => {
    const elegido = rules(css).find((r) => r.selectors.length === 1 && r.selectors[0] === ':root[data-theme="dark"]');
    const equipo = rules(css).find((r) => r.selectors.length === 1 && r.selectors[0] === ':root:not([data-theme="light"])' && /--red:/.test(r.body));
    if (!elegido || !equipo) throw new Error("no encontré los dos bloques de colores");
    const [a, b] = [tokens(elegido.body), tokens(equipo.body)];
    if (Object.keys(a).length < 15) throw new Error("pocos colores en el bloque oscuro: " + Object.keys(a).length);
    if (JSON.stringify(Object.entries(a).sort()) !== JSON.stringify(Object.entries(b).sort())) throw new Error("los dos bloques difieren: " + JSON.stringify({ a, b }));
    if (!/color-scheme:\s*dark/.test(elegido.body) || !/color-scheme:\s*dark/.test(equipo.body) || !/color-scheme:\s*light/.test(css)) throw new Error("falta color-scheme (controles nativos)");
  });

  await check("El diseño general lee la cookie y pinta el modo desde el servidor (sin parpadeo), el botón está en el encabezado y no hay ningún script en línea", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8"), toggle = readFileSync("src/components/ThemeToggle.tsx", "utf8");
    if (!/parseTheme\(\(await cookies\(\)\)\.get\(THEME_COOKIE\)\?\.value\)/.test(layout) || !/data-theme=\{themeAttribute\(theme\)\}/.test(layout)) throw new Error("layout.tsx debe pintar data-theme desde la cookie");
    if (!/<ThemeToggle initial=\{theme\} \/>/.test(layout)) throw new Error("falta el botón en el encabezado");
    if (/dangerouslySetInnerHTML|<script/.test(layout + toggle)) throw new Error("el modo de color no debe usar scripts en línea (la política de contenido los prohíbe)");
    if (!/role="switch"/.test(toggle) || !/aria-checked=\{dark\}/.test(toggle) || !/aria-label="Modo oscuro"/.test(toggle)) throw new Error("el botón debe ser un interruptor accesible");
  });
}
main().then(summary);
