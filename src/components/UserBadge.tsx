import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { signOutAction } from "@/app/estudio/actions";

export async function UserBadge() {
  const user = await getUser();
  if (!user) return <Link className="btn solid" href="/login">Ingresar</Link>;
  return (
    <form action={signOutAction} style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <span className="tag">{user.email}</span>
      <button className="btn" type="submit">Salir</button>
    </form>
  );
}
