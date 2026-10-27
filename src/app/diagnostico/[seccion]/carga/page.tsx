import { notFound } from "next/navigation";
import { BulkPage } from "@/components/entry/BulkPage";
import { DIAGNOSTICO_SLUG } from "@/lib/entry-routes";
import type { EntryId } from "@/server/entry/defs";

export const metadata = { title: "Carga masiva" };
export default async function Carga({ params }: { params: Promise<{ seccion: string }> }) {
  const id = DIAGNOSTICO_SLUG[(await params).seccion];
  if (!id) notFound();
  return <BulkPage hoja={id as EntryId} />;
}
