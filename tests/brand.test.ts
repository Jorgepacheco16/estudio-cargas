import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check, summary } from "./helpers";

/**
 * Marca BalanceAPP (D-97): el símbolo es el indicador de carga (dial de tres tramos con aguja) y NO el cuadro azul con la «B» y el punto rojo, que se parecía al de otra marca.
 * El mismo dibujo vive en tres sitios (el componente, el ícono de la pestaña y el logo suelto) y deben decir lo mismo; la letra Outfit viaja con el proyecto y su licencia.
 */
const read = (p: string) => readFileSync(p, "utf8");
const logo = read("src/components/brand/BalanceLogo.tsx"), icon = read("src/app/icon.svg"), pub = read("public/balanceapp-logo.svg"), css = read("src/app/globals.css"), layout = read("src/app/layout.tsx");
const paths = (s: string) => [...s.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const ARCS = ["M12.95 48 A22 22 0 0 1 16 21.9", "M18.86 19.35 A22 22 0 0 1 45.14 19.35", "M48 21.9 A22 22 0 0 1 51.05 48"], NEEDLE = "M32 24 L35.3 37 H28.7 Z";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|css|svg)$/.test(n) ? [p] : []; });
}

async function main() {
  await check("El mismo símbolo (tres tramos del dial y la aguja) está en el componente, en el ícono de la pestaña y en el logo suelto", () => {
    for (const [nombre, texto] of [["BalanceLogo.tsx", logo], ["icon.svg", icon], ["balanceapp-logo.svg", pub]] as const) {
      const d = paths(texto);
      for (const p of [...ARCS, NEEDLE]) if (!d.includes(p)) throw new Error(`${nombre} no trae el trazo «${p}»`);
    }
    if (!/viewBox="0 0 64 64"/.test(logo) || !/viewBox="0 0 64 64"/.test(icon)) throw new Error("el símbolo se dibuja en una caja de 64 × 64");
    for (const t of [logo, icon, pub]) if (!/cx="32" cy="37" r="8"/.test(t) || !/cx="32" cy="37" r="3.1"/.test(t)) throw new Error("falta el eje con su punto central");
  });

  await check("No queda nada del símbolo anterior (cuadro azul redondeado, «B» de dos cuencos y punto rojo) en la aplicación ni en los archivos públicos", () => {
    const rotos: string[] = [];
    for (const f of [...walk("src"), ...walk("public")]) {
      const t = read(f);
      if (/M22 15 V49|bm-badge|bm-b\b|bm-dot|rx="18"/.test(t)) rotos.push(f.replace(/\\/g, "/"));
    }
    if (rotos.length) throw new Error("siguen apareciendo trazos o clases del símbolo anterior en: " + rotos.join(", "));
  });

  await check("Los colores fijos del ícono y del logo suelto son el azul y el rojo del cliente (los mismos de globals.css); el componente usa las variables de marca", () => {
    const blue = /--blue:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]?.toLowerCase(), red = /--red:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]?.toLowerCase();
    if (blue !== "#00529b" || red !== "#ed001b") throw new Error(`colores del cliente: ${blue} / ${red}`);
    for (const [n, t] of [["icon.svg", icon], ["balanceapp-logo.svg", pub]] as const) if (!t.includes(blue) || !t.includes(red)) throw new Error(`${n} debe usar ${blue} y ${red}`);
    if (!/--brand-primary: var\(--red\)/.test(css) || !/--brand-secondary: var\(--blue\)/.test(css)) throw new Error("las variables de marca deben salir del rojo y el azul");
    if (!/\.bm-arc \{[^}]*var\(--brand-secondary\)/.test(css) || !/\.bm-needle \{[^}]*var\(--brand-primary\)/.test(css)) throw new Error("el dial va en la variable secundaria y la aguja en la primaria");
    if (!/prefers-color-scheme: dark/.test(icon)) throw new Error("el ícono debe adaptarse al modo oscuro");
  });

  await check("El logo suelto lleva las letras convertidas en trazos (no depende de tener la fuente instalada) y mantiene su nombre accesible", () => {
    if (/<text\b/.test(pub)) throw new Error("las letras deben ir como trazos, no como texto");
    if (!/aria-label="BalanceAPP"/.test(pub) || !/role="img"/.test(pub)) throw new Error("falta el nombre accesible");
    const grandes = paths(pub).filter((d) => d.length > 400);
    if (grandes.length !== 2) throw new Error("deben ser dos trazos grandes: «Balance» y «APP»; hay " + grandes.length);
  });

  await check("La letra Outfit viaja con el proyecto (archivo válido y licencia libre), se carga desde el propio sitio y el nombre del logo la usa con respaldo", () => {
    const f = "src/app/fonts/Outfit-Variable-latin.woff2";
    if (!existsSync(f) || readFileSync(f).subarray(0, 4).toString("latin1") !== "wOF2") throw new Error("falta la fuente o no es un WOFF2 válido");
    if (statSync(f).size > 80_000) throw new Error("la fuente pesa demasiado para ser solo el subconjunto latino");
    const lic = read("src/app/fonts/Outfit-LICENSE.txt");
    if (!/SIL OPEN FONT LICENSE Version 1\.1/i.test(lic) || !/Outfit/.test(lic)) throw new Error("falta la licencia de la fuente");
    if (!/next\/font\/local/.test(layout) || !/Outfit-Variable-latin\.woff2/.test(layout) || !/--font-logo/.test(layout) || !/className=\{outfit\.variable\}/.test(layout)) throw new Error("layout.tsx debe cargar la fuente con next/font/local");
    if (/fonts\.googleapis|fonts\.gstatic/.test(layout + css)) throw new Error("la fuente no debe pedirse a Google en cada visita");
    if (!/\.balance-word \{[^}]*var\(--font-logo\), system-ui/.test(css)) throw new Error("el nombre debe usar la fuente con la letra del sistema de respaldo");
    if (!/\.balance-word \{[^}]*font-weight: 500/.test(css) || !/\.balance-word b \{[^}]*font-weight: 700/.test(css)) throw new Error("«Balance» en peso medio y «APP» en negrita");
  });
}
main().then(summary);
