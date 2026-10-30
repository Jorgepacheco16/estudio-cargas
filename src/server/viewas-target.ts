/**
 * «Ver como» (D-91): comprueba, con la identidad del Super usuario, que la persona imitada es miembro de un estudio que él administra (RLS: solo ve las membresías
 * ajenas de los estudios donde administra). Devuelve su correo (o null si no hay nada que imitar).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/server";
import { withRls } from "@/db/client";
import { memberships } from "@/db/schema";

export async function viewAsTarget(adminId: string, targetId: string): Promise<{ email: string | null } | null> {
  const rows = await withRls(getDb(), { sub: adminId }, (tx) => tx.select({ email: memberships.email }).from(memberships).where(eq(memberships.userId, targetId)).limit(1));
  return rows[0] ? { email: rows[0].email } : null;
}
