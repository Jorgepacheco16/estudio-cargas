import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listRoles } from "@/server/access";
import { RoleForm } from "@/components/usuarios/RoleForm";

export const metadata = { title: "Editar rol" };
export default async function EditarRol({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study?.access?.isAdmin) redirect("/sin-acceso?m=usuarios");
  const role = (await listRoles(getDb(), user!.id, study!.id)).find((r) => r.id === id);
  if (!role) notFound();
  if (role!.isSystem) redirect("/usuarios?vista=roles&error=" + encodeURIComponent(`El rol «${role!.name}» es del sistema: no se puede modificar.`));
  return <main><div className="head"><div><h1>Editar rol · {role!.name}</h1><div className="sub">{role!.members} persona(s) lo tienen: al guardar, quedan actualizadas</div></div><div className="tools"><Link className="btn" href="/usuarios?vista=roles">← Volver a roles</Link></div></div><RoleForm id={role!.id} name={role!.name} perms={role!.perms} /></main>;
}
