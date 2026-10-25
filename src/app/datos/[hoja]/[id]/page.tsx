import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { EntryForm } from "@/components/EntryForm";
import { entryDef, type EntryId } from "@/server/entry/defs";
import { entryOptions, getEntry } from "@/server/entry/service";
import { formProps } from "../../form-props";

export default async function Editar({ params }: { params: Promise<{ hoja: string; id: string }> }) {
  const { hoja, id } = await params;
  const def = entryDef(hoja);
  if (!def || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  const found = await getEntry(getDb(), user!.id, study!.id, def!.id as EntryId, id);
  if (!found) notFound();
  const lookups = await entryOptions(getDb(), user!.id, study!.id);
  const p = formProps(def!, found!.row);
  return (
    <main>
      <div className="head"><div><h1>Editar registro · Hoja {def!.id} {def!.short}</h1><div className="sub">Al guardar, la hoja de Google se actualiza con estos valores.</div></div></div>
      <EntryForm key={found!.row.version} hoja={def!.id} recId={id} version={found!.row.version} {...p} lookups={lookups} canWrite={study!.role !== "viewer"} />
    </main>
  );
}
