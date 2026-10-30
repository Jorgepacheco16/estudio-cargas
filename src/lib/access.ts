/**
 * Permisos de quien está en sesión, para las pantallas y las acciones (D-91). La base de datos es quien hace cumplir los permisos; esto sirve para mostrar solo lo
 * que la persona puede usar y para dar un mensaje claro en vez de un error. Sin sesión (demostración) no hay restricciones: solo ve datos de ejemplo.
 */
import { redirect } from "next/navigation";
import { MODULES, MODULE_LABEL, moduleOfPath, type AppModule, type Level } from "@/domain/access";
import type { MyAccess } from "@/server/access";

export interface WithAccess { access: MyAccess | null }
export const levelOf = (s: WithAccess | null | undefined, m: AppModule): Level => s?.access?.perms[m] ?? "none";
export const canRead = (s: WithAccess | null | undefined, m: AppModule) => levelOf(s, m) !== "none";
export const canEdit = (s: WithAccess | null | undefined, m: AppModule) => levelOf(s, m) === "edit";
/** Mensaje cuando una acción se rechaza por el rol. */
export const NO_EDIT = (m: AppModule) => `Su rol no permite editar «${MODULE_LABEL[m]}».`;

/** Rutas del menú a las que la persona tiene acceso (null = sin restricción: demostración o sin estudio). */
export function allowedHrefs(hrefs: string[], s: WithAccess | null | undefined): string[] | null {
  if (!s?.access) return null;
  return hrefs.filter((h) => {
    if (h === "/usuarios") return s.access!.isAdmin;
    const m = moduleOfPath(h);
    if (m === null) return true;
    return (Array.isArray(m) ? m : [m]).every((x) => canRead(s, x));
  });
}

/** Lleva a la pantalla «sin acceso» si la persona no puede leer el módulo (los invitados a la demostración no tienen restricciones). */
export function requireRead(s: WithAccess | null | undefined, modules: AppModule | AppModule[]): void {
  if (!s?.access) return;
  const missing = (Array.isArray(modules) ? modules : [modules]).filter((m) => !canRead(s, m));
  if (missing.length) redirect(`/sin-acceso?m=${missing[0]}`);
}
export const ALL_MODULES = MODULES;
