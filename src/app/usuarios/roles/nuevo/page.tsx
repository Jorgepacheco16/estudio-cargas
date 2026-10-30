import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { RoleForm } from "@/components/usuarios/RoleForm";

export const metadata = { title: "Nuevo rol" };
export default async function NuevoRol() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study?.access?.isAdmin) redirect("/sin-acceso?m=usuarios");
  return <main><div className="head"><div><h1>Nuevo rol</h1><div className="sub">Defina qué puede hacer en cada módulo</div></div><div className="tools"><Link className="btn" href="/usuarios?vista=roles">← Volver a roles</Link></div></div><RoleForm /></main>;
}
