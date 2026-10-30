import Link from "next/link";
import { MODULE_LABEL, isModule } from "@/domain/access";

export const metadata = { title: "Sin acceso" };
export default async function SinAcceso({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const modulo = isModule(sp.m) ? MODULE_LABEL[sp.m] : null;
  return (
    <main>
      <div className="head"><div><h1>Sin acceso</h1><div className="sub">{modulo ? `Su rol no tiene acceso a «${modulo}».` : "Su rol no tiene acceso a esta sección."}</div></div></div>
      <section className="card">
        <p>Si necesita trabajar en esta sección, pídale acceso a quien administra los usuarios de la aplicación.</p>
        <p><Link className="btn solid" href="/">Ir al inicio</Link></p>
      </section>
    </main>
  );
}
