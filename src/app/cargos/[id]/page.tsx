import { EntryEdit } from "@/components/entry/views";

export const maxDuration = 60; // la validación de cobertura llama a la IA desde esta pantalla
export const metadata = { title: "Editar registro" };
export default async function Editar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) { return <EntryEdit hoja="2" id={(await params).id} sp={await searchParams} />; }
