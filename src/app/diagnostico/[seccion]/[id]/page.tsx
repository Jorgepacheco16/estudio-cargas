import { notFound } from "next/navigation";
import { EntryEdit } from "@/components/entry/views";
import { DIAGNOSTICO_SLUG } from "@/lib/entry-routes";
import type { EntryId } from "@/server/entry/defs";

export const metadata = { title: "Editar registro" };
export default async function Editar({ params }: { params: Promise<{ seccion: string; id: string }> }) {
  const p = await params, hoja = DIAGNOSTICO_SLUG[p.seccion];
  if (!hoja) notFound();
  return <EntryEdit hoja={hoja as EntryId} id={p.id} />;
}