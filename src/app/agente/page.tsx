import { ExportButtons } from "@/components/Tools";

export default function Agente() {
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  return (
    <main>
      <div className="head">
        <div><h1>Agente de IA</h1><div className="sub">El agente solo propone; nada cambia sin aprobación humana registrada.</div></div>
        <div className="tools"><ExportButtons view="agente" mode="demo" /></div>
      </div>
      <section className="card">
        <h2>Propuestas pendientes</h2>
        <div className="banner" style={{ marginTop: 12 }}>
          {configured ? "El agente está configurado, pero aún no hay ejecuciones." : "Agente sin configurar: falta ANTHROPIC_API_KEY (Fase 9). No se muestran propuestas de ejemplo."}
        </div>
        <div className="empty">Sin propuestas.</div>
        <p className="note">Al agente solo llegarán resúmenes seudonimizados, sin nombres ni identificadores reales.</p>
      </section>
    </main>
  );
}
