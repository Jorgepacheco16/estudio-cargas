import * as React from "react";

/**
 * Caché POR PETICIÓN (rendimiento): el proxy, el diseño general y la página preguntaban cada uno «quién es la persona» y «cuál es su estudio».
 * `React.cache` recuerda el resultado solo mientras dura la petición que se está armando y lo olvida al terminar: nada se comparte entre peticiones ni entre personas.
 * Fuera del servidor de Next (pruebas, scripts) no existe y cada llamada se ejecuta de verdad.
 */
type Memo = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
export const memo: Memo = (React as unknown as { cache?: Memo }).cache ?? ((fn) => fn);

/**
 * Contador de cambios dentro de la petición. Toda búsqueda recordada lo incluye en su clave; cualquier función que modifica estudios, roles o personas lo sube ANTES de escribir,
 * así lo que se lea después (por ejemplo, la pantalla a la que redirige una acción) se vuelve a consultar y nunca queda un dato viejo.
 */
const box = memo(() => ({ n: 0 }));
export const requestEpoch = (): number => box().n;
export const bumpRequestEpoch = (): void => { box().n += 1; };

/** Clave de la sesión: las cookies de Supabase tal como llegan. Si la persona ingresa, sale o se le renueva la sesión, la clave cambia y se vuelve a validar. */
export function sessionKeyOf(cookies: { name: string; value: string }[]): string {
  return cookies.filter((c) => c.name.startsWith("sb-")).map((c) => `${c.name}=${c.value}`).sort().join(";");
}
