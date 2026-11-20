import { guardModules } from "@/lib/guard";
import { EMPLOYEE_COLUMNS, STRUCTURE_COLUMNS } from "@/domain/structure-format";

export const metadata = { title: "Estructura de la tienda" };
export default async function Page() {
  await guardModules("cargos");
  return (
    <main>
      <div className="head">
        <div><h1>Estructura de la tienda</h1><p className="lead">Formato de Excel con los puestos físicos, áreas y cargos de la tienda, su clasificación y el listado de empleados, tal como lo pidió la gerencia.</p></div>
      </div>
      <section className="card">
        <h2>Formato</h2>
        <p className="note">Se descarga <b>vacío</b>: usted lo diligencia. Tiene dos hojas, «Estructura» y «Empleados», y una de instrucciones.</p>
        <a className="btn solid" href="/api/estructura/plantilla">Descargar formato (Excel)</a>
      </section>
      <section className="card">
        <h2>Columnas de «Estructura»</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{STRUCTURE_COLUMNS.map((c) => <li key={c.header}><b>{c.header}</b>: {c.hint}</li>)}</ol>
      </section>
      <section className="card">
        <h2>Columnas de «Empleados»</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{EMPLOYEE_COLUMNS.map((c) => <li key={c.header}><b>{c.header}</b>: {c.hint}</li>)}</ol>
      </section>
    </main>
  );
}
