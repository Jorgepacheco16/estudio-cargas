import { EntryEdit } from "@/components/entry/views";

export const maxDuration = 60; // la validación de cobertura llama a la IA desde esta pantalla
export const metadata = { title: "Editar registro" };
export default async function Editar({ params }: { params: Promise<{ id: string }> }) { return <EntryEdit hoja="2" id={(await params).id} />; }
