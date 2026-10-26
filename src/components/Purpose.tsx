import type { ReactNode } from "react";

/** Ayuda breve para un término técnico: se lee al pasar el cursor, al enfocar con teclado o con lector de pantalla. No reemplaza el término. */
export function Help({ text, children }: { text: string; children?: ReactNode }) {
  return <span className="help" tabIndex={0} role="note" aria-label={`${children ?? ""} ${text}`.trim()} title={text}>{children}<span aria-hidden="true" className="help-i">i</span></span>;
}

/** Línea de propósito de cada sección, justo debajo del título. */
const TEXT: Record<string, ReactNode> = {
  inicio: "Resumen del estudio: cuánta carga hay, dónde se concentra y qué conclusiones preliminares se desprenden de los datos capturados.",
  parametros: "Supuestos del estudio (jornada, reserva de capacidad, umbrales y pesos) y lista de áreas. De aquí dependen los cálculos de todas las secciones.",
  estudio: "Cree o elija el estudio con el que trabaja y descargue su respaldo completo.",
  cargos: "Cargos y dotación: cuántas personas ocupan cada cargo, su jornada y la capacidad disponible frente a la carga calculada.",
  actividades: "Inventario de actividades de cada cargo, con su frecuencia y tiempo. Las incompletas se conservan, pero no suman carga hasta completarse.",
  calculo: "Cuánto tiempo consume cada actividad por semana y por mes, calculado con lo capturado en Actividades. Es la base de la carga de cada cargo.",
  drill: <>Recorra la carga <Help text="Drill-down: ir bajando de nivel, del estudio completo al área, el cargo y la actividad, haciendo clic en cada fila.">por niveles</Help>: estudio, área, cargo y actividad.</>,
  sedes: "Compara un mismo cargo entre sedes para ver dónde hay más o menos carga por persona.",
  historia: <>Fotos del tablero en el tiempo, productividad real contra el estándar y <Help text="Desviación: una diferencia entre lo estimado y lo medido, o entre fotos del estudio, que supera un umbral y conviene revisar.">desviaciones</Help> detectadas.</>,
  integraciones: "Conexión con la hoja de Google que recibe los datos de la aplicación, y su historial de sincronización.",
  agente: "El agente de IA analiza un resumen del estudio y propone cambios. Nada se aplica sin su aprobación.",
};

export function Purpose({ k }: { k: string }) {
  return <p className="lead">{TEXT[k]}</p>;
}