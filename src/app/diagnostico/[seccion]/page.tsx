import { notFound } from "next/navigation";
import { EntrySection } from "@/components/entry/views";
import { DIAGNOSTICO_SLUG } from "@/lib/entry-routes";
import { SECCIONES } from "@/lib/diagnostico";
import type { EntryId } from "@/server/entry/defs";

export async function generateMetadata({ params }: { params: Promise<{ seccion: string }> }) {
  const s = SECCIONES[(await params).seccion];
  return { title: s?.titulo ?? "Diagnóstico y rediseño" };
}

export default async function Seccion({ params, searchParams }: { params: Promise<{ seccion: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const slug = (await params).seccion;
  const id = DIAGNOSTICO_SLUG[slug], info = SECCIONES[slug];
  if (!id || !info) notFound();
  return (
    <main>
      <div className="head"><div><h1>{info!.titulo}</h1><div className="sub">{info!.proposito}</div></div></div>
      <EntrySection hoja={id as EntryId} sp={await searchParams} />
    </main>
  );
}