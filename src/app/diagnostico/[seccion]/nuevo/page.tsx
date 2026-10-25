import { notFound } from "next/navigation";
import { EntryNew } from "@/components/entry/views";
import { DIAGNOSTICO_SLUG } from "@/lib/entry-routes";
import type { EntryId } from "@/server/entry/defs";

export const metadata = { title: "Nuevo registro" };
export default async function Nuevo({ params }: { params: Promise<{ seccion: string }> }) {
  const id = DIAGNOSTICO_SLUG[(await params).seccion];
  if (!id) notFound();
  return <EntryNew hoja={id as EntryId} />;
}