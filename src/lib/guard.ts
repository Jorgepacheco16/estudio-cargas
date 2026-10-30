/** Guardia de pantallas por módulo (D-91): lleva a «Sin acceso» si el rol no puede leer los módulos pedidos. Sin sesión (demostración) no restringe. */
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { requireRead } from "@/lib/access";
import type { AppModule } from "@/domain/access";

export async function guardModules(modules: AppModule | AppModule[]): Promise<void> {
  const user = await getUser();
  if (!user) return;
  requireRead(await activeStudyId(user.id), modules);
}
