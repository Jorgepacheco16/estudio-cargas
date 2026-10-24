"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Pantallas de lectura que se mantienen al día (sustituye a Realtime, D-55). Las pantallas con formularios de captura no se refrescan solas. */
const PANTALLAS = new Set(["/", "/cargos", "/actividades", "/sedes", "/drill", "/historia", "/agente"]);

/**
 * Cada `segundos` vuelve a pedir los datos al servidor si la pestaña está visible y la persona no está escribiendo,
 * de modo que lo que cambian otras personas (o la hoja de Google) aparezca sin recargar a mano.
 */
export function AutoRefresh({ segundos = 45 }: { segundos?: number }) {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!PANTALLAS.has(path)) return;
    const id = setInterval(() => {
      const el = document.activeElement;
      const escribiendo = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (document.visibilityState === "visible" && !escribiendo) router.refresh();
    }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, path, segundos]);
  return null;
}
