import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { EntryForm } from "@/components/EntryForm";
import { entryDef } from "@/server/entry/defs";
import { entryOptions } from "@/server/entry/service";
import { formProps } from "../../form-props";

export default async function Nuevo({ params }: { params: Promise<{ hoja: string }> }) {
  const { hoja } = await params;
  const def = entryDef(hoja);
  if (!def) notFound();
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  const lookups = await entryOptions(getDb(), user!.id, study!.id);
  const p = formProps(def!);
  return (
    <main>
      <div className="head"><div><h1>Nuevo registro · {def!.short}</h1><div className="sub">Los campos con * son obligatorios. Lo que deje vacío se guarda vacío.</div></div></div>
      <EntryForm hoja={def!.id} {...p} lookups={lookups} canWrite={study!.role !== "viewer"} />
    </main>
  );
}
