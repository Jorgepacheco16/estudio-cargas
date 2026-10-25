import { EntryEdit } from "@/components/entry/views";

export const metadata = { title: "Editar registro" };
export default async function Editar({ params }: { params: Promise<{ id: string }> }) { return <EntryEdit hoja="2" id={(await params).id} />; }
