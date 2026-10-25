/**
 * GENERADO por scripts/gen-sheetfields.ts a partir del libro de referencia. No editar a mano.
 * Catálogo de columnas de las hojas de captura: letra, encabezado, ayuda, grupo y si es casilla de ENTRADA (amarilla) o fórmula (gris).
 */
export interface SheetColumn { col: string; header: string; hint: string; group: string; input: boolean }
export interface SheetCatalog { sheetName: string; title: string; note: string; columns: SheetColumn[] }
export const SHEET_FIELDS: Record<string, SheetCatalog> = {
 "2": {
  "sheetName": "2_Caracterizacion",
  "title": "HOJA 2 · CARACTERIZACIÓN ORGANIZACIONAL",
  "note": "Un cargo por fila y por sede (o un colaborador por fila si necesita analizarlo individualmente). Precargadas las 14 áreas operativas.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "REAL = estudio · DEMO = ejemplo ficticio",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "B",
    "header": "Área operativa",
    "hint": "Elija del listado de 14 áreas",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "C",
    "header": "Punto de venta, sede o centro de operación",
    "hint": "Escriba el nombre igual en todas las hojas",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "D",
    "header": "Regional",
    "hint": "Cuando aplique",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "E",
    "header": "Cargo",
    "hint": "Mismo nombre de cargo en todas las sedes para poder compararlas",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "F",
    "header": "Cantidad de colaboradores en el cargo",
    "hint": "Número de personas que ocupan el cargo en esa sede",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "G",
    "header": "Identificador del colaborador (opcional)",
    "hint": "Solo si necesita analizar a una persona; use un código",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "H",
    "header": "Jefe inmediato",
    "hint": "Cargo o nombre",
    "group": "Estructura",
    "input": true
   },
   {
    "col": "I",
    "header": "Objetivo actual del cargo",
    "hint": "Tal como lo entiende hoy la organización",
    "group": "Estructura",
    "input": true
   },
   {
    "col": "J",
    "header": "Funciones formalmente asignadas (perfil)",
    "hint": "Copie del perfil o manual para contrastar con lo realmente ejecutado",
    "group": "Estructura",
    "input": true
   },
   {
    "col": "K",
    "header": "Jornada semanal aplicable (horas)",
    "hint": "Horas por semana del cargo",
    "group": "Estructura",
    "input": true
   },
   {
    "col": "L",
    "header": "Fecha del levantamiento",
    "hint": "dd/mm/aaaa",
    "group": "Registro",
    "input": true
   },
   {
    "col": "M",
    "header": "Responsable del levantamiento",
    "hint": "Quién recopiló la información",
    "group": "Registro",
    "input": true
   },
   {
    "col": "N",
    "header": "Fuente de información",
    "hint": "Cómo se obtuvo",
    "group": "Registro",
    "input": true
   },
   {
    "col": "O",
    "header": "Observaciones",
    "hint": "Notas adicionales",
    "group": "Registro",
    "input": true
   },
   {
    "col": "P",
    "header": "Clave (área|sede|cargo|tipo)",
    "hint": "Automático",
    "group": "Cálculos automáticos",
    "input": false
   },
   {
    "col": "Q",
    "header": "Primera aparición de la clave",
    "hint": "Automático",
    "group": "Cálculos automáticos",
    "input": false
   },
   {
    "col": "R",
    "header": "Capacidad disponible (h/sem)",
    "hint": "Cantidad × jornada × (1 − reserva). Supuesto en hoja Parametros",
    "group": "Cálculos automáticos",
    "input": false
   },
   {
    "col": "S",
    "header": "Orden (filas con identificador)",
    "hint": "Automático",
    "group": "Cálculos automáticos",
    "input": false
   },
   {
    "col": "T",
    "header": "Actividades registradas para el cargo",
    "hint": "Cuenta en hoja 3",
    "group": "Cálculos automáticos",
    "input": false
   },
   {
    "col": "U",
    "header": "Actividades sin documentar formalmente",
    "hint": "Diferencia entre lo formal y lo real",
    "group": "Cálculos automáticos",
    "input": false
   },
   {
    "col": "V",
    "header": "Estado de captura",
    "hint": "Qué falta para calcular la capacidad",
    "group": "Cálculos automáticos",
    "input": false
   }
  ]
 },
 "3": {
  "sheetName": "3_Actividades",
  "title": "HOJA 3 · INVENTARIO DETALLADO DE ACTIVIDADES",
  "note": "Cada fila es UNA actividad concreta y diferenciable. Las columnas 'Estado de captura' le dicen qué dato falta para calcular su carga.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "REAL / DEMO",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "B",
    "header": "Código de actividad",
    "hint": "Único. Ej.: CAJ-001",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "C",
    "header": "Estado de captura",
    "hint": "Indica qué dato falta para calcular la carga",
    "group": "Identificación",
    "input": false
   },
   {
    "col": "D",
    "header": "Área operativa",
    "hint": "Del listado",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "E",
    "header": "Sede / punto de venta",
    "hint": "Igual que en hoja 2",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "F",
    "header": "Cargo responsable",
    "hint": "Igual que en hoja 2",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "G",
    "header": "Colaborador que la ejecuta (ID, opcional)",
    "hint": "Vacío = la ejecutan los ocupantes del cargo",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "H",
    "header": "Nombre de la actividad",
    "hint": "Verbo + resultado. Una sola actividad por fila",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "I",
    "header": "Descripción detallada de la ejecución",
    "hint": "Paso a paso, tal como se hace",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "J",
    "header": "Proceso al que pertenece",
    "hint": "Proceso mayor",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "K",
    "header": "Objetivo y resultado esperado",
    "hint": "Para qué sirve y qué produce",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "L",
    "header": "Otros cargos participantes",
    "hint": "Si participan otros cargos",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "M",
    "header": "¿Documentada formalmente?",
    "hint": "Sí / Parcialmente / No",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "N",
    "header": "Frecuencia de ejecución",
    "hint": "Descriptiva",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "O",
    "header": "Modalidad de cálculo",
    "hint": "Por evento = tiempo por vez · Por unidad = tiempo por unidad × unidades",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "P",
    "header": "Cantidad de ejecuciones por período",
    "hint": "Cuántas veces se ejecuta (ver período)",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "Q",
    "header": "Período de las ejecuciones",
    "hint": "Día / Semana / Quincena / Mes / Trimestre / Año",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "R",
    "header": "Alcance de las ejecuciones",
    "hint": "Por colaborador: cada ocupante hace esa cantidad · Total del cargo: es el conjunto",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "S",
    "header": "Unidades procesadas por ejecución (si es por unidad)",
    "hint": "Volumen por vez. Unidad de trabajo en la descripción",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "T",
    "header": "Tiempo promedio por ejecución o por unidad (min)",
    "hint": "Minutos. Por evento: por vez · Por unidad: por unidad",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "U",
    "header": "Tiempo mínimo observado (min)",
    "hint": "Opcional",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "V",
    "header": "Tiempo máximo observado (min)",
    "hint": "Opcional",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "W",
    "header": "Factor de temporada alta (×)",
    "hint": "Ej.: 1,3 = 30 % más volumen. Vacío = 1",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "X",
    "header": "Factor de temporada baja (×)",
    "hint": "Ej.: 0,8. Vacío = 1",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "Y",
    "header": "Fuente del dato",
    "hint": "Declarada, observada, cronometrada o verificable",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "Z",
    "header": "Nivel de confianza de la estimación",
    "hint": "Alto / Medio / Bajo",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "AA",
    "header": "Personas que participan a la vez",
    "hint": "Si la hacen 2 a la vez, 2. Vacío = 1",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "AB",
    "header": "% de la carga que asume el cargo responsable",
    "hint": "Vacío = 100 %. Si se comparte, el resto va al cargo siguiente",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "AC",
    "header": "Cargo que asume el resto de la carga",
    "hint": "Solo si el % anterior es menor de 100 %",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "AD",
    "header": "¿Planificada o no planificada?",
    "hint": "Las no planificadas se suman aparte",
    "group": "Frecuencia, volumen y tiempo",
    "input": true
   },
   {
    "col": "AE",
    "header": "Herramientas, equipos o sistemas",
    "hint": "Qué usa",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AF",
    "header": "Insumos necesarios",
    "hint": "Qué necesita para ejecutarla",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AG",
    "header": "Entregable generado",
    "hint": "Qué resulta",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AH",
    "header": "Dependencias de otras personas o áreas",
    "hint": "De quién depende",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AI",
    "header": "Tiempo de espera por ejecución (min)",
    "hint": "Esperas durante la actividad",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AJ",
    "header": "¿La persona queda ocupada en la espera?",
    "hint": "Sí = cuenta como horas-persona",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AK",
    "header": "Desplazamientos por ejecución (min)",
    "hint": "Adicionales al tiempo promedio",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AL",
    "header": "% de ejecuciones con error o reproceso",
    "hint": "Ej.: 5 %",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AM",
    "header": "Tiempo promedio por reproceso (min)",
    "hint": "Minutos por vez",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AN",
    "header": "Consecuencias de ejecución incorrecta o tardía",
    "hint": "Qué pasa si falla o se retrasa",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AO",
    "header": "Procedimientos y controles existentes",
    "hint": "Cuáles existen",
    "group": "Características operativas",
    "input": true
   },
   {
    "col": "AP",
    "header": "Tipo de actividad",
    "hint": "Operativa, administrativa, control...",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AQ",
    "header": "Aporte de valor",
    "hint": "Directo / necesaria / prescindible",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AR",
    "header": "¿Obligatoria por normativa, política o control?",
    "hint": "Sí / No",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AS",
    "header": "Potencial de estandarización",
    "hint": "Alto / Medio / Bajo / Ninguno",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AT",
    "header": "Potencial de simplificación",
    "hint": "Alto / Medio / Bajo / Ninguno",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AU",
    "header": "Potencial de automatización",
    "hint": "Alto / Medio / Bajo / Ninguno",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AV",
    "header": "Posibilidad de integrarla con otra actividad",
    "hint": "Sí / No / No evaluada",
    "group": "Clasificación",
    "input": true
   },
   {
    "col": "AW",
    "header": "Evidencia",
    "hint": "Registro, foto, cronómetro, sistema...",
    "group": "Evidencia y cierre",
    "input": true
   },
   {
    "col": "AX",
    "header": "Observaciones",
    "hint": "Notas",
    "group": "Evidencia y cierre",
    "input": true
   },
   {
    "col": "AY",
    "header": "Asuntos pendientes de validar",
    "hint": "Qué falta confirmar y con quién",
    "group": "Evidencia y cierre",
    "input": true
   }
  ]
 },
 "5": {
  "sheetName": "5_Medibilidad",
  "title": "HOJA 5 · MEDIBILIDAD E INDICADORES DE DESEMPEÑO",
  "note": "Elija el código de una actividad (hoja 3) y evalúe qué tan medible es. No fuerce métricas numéricas cuando no sean razonables.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "B",
    "header": "Código de actividad",
    "hint": "Elija del listado (hoja 3)",
    "group": "Actividad (automático)",
    "input": true
   },
   {
    "col": "C",
    "header": "Área",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "D",
    "header": "Cargo responsable",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "E",
    "header": "Actividad",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "F",
    "header": "Tipo de actividad",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "G",
    "header": "¿Se puede medir directamente?",
    "hint": "Sí / Parcial / No",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "H",
    "header": "¿Existen indicadores?",
    "hint": "Sí / No",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "I",
    "header": "¿Hay datos históricos?",
    "hint": "Sí / Parcial / No",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "J",
    "header": "¿Existe estándar de tiempo?",
    "hint": "Sí / No",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "K",
    "header": "Confiabilidad de la fuente",
    "hint": "Alta / Media / Baja",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "L",
    "header": "Dependencia de factores externos",
    "hint": "Alta / Media / Baja",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "M",
    "header": "¿Se puede verificar el resultado?",
    "hint": "Sí / Parcial / No",
    "group": "Criterios de medibilidad",
    "input": true
   },
   {
    "col": "N",
    "header": "Unidad de medida recomendada",
    "hint": "Elija del listado",
    "group": "Indicador",
    "input": true
   },
   {
    "col": "O",
    "header": "Indicador propuesto",
    "hint": "Elija del listado",
    "group": "Indicador",
    "input": true
   },
   {
    "col": "P",
    "header": "Criterio cualitativo verificable (si no hay métrica razonable)",
    "hint": "Ej.: qué evidencia confirma que se hizo bien",
    "group": "Indicador",
    "input": true
   },
   {
    "col": "Q",
    "header": "Puntaje de medibilidad (0-100)",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "R",
    "header": "Nivel de medibilidad",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "S",
    "header": "Indicador sugerido según el tipo de actividad",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "T",
    "header": "Recomendación",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   }
  ]
 },
 "6": {
  "sheetName": "6_Pertinencia",
  "title": "HOJA 6 · PERTINENCIA DEL CARGO Y COMPETENCIAS",
  "note": "Evalúe si cada actividad está bien asignada y qué se necesita para ejecutarla. Considere control interno y separación de funciones.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "B",
    "header": "Código de actividad",
    "hint": "Elija del listado (hoja 3)",
    "group": "Actividad (automático)",
    "input": true
   },
   {
    "col": "C",
    "header": "Área",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "D",
    "header": "Cargo responsable",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "E",
    "header": "Actividad",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "F",
    "header": "Correspondencia con el objetivo del cargo",
    "hint": "Alta / Parcial / Baja / No corresponde",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "G",
    "header": "Conocimientos técnicos requeridos",
    "hint": "Qué debe saber",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "H",
    "header": "Formación o certificaciones",
    "hint": "Cuando aplique",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "I",
    "header": "Experiencia requerida",
    "hint": "Tiempo/tipo",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "J",
    "header": "Competencias técnicas",
    "hint": "Lista",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "K",
    "header": "Competencias conductuales",
    "hint": "Lista",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "L",
    "header": "Autorizaciones o accesos necesarios",
    "hint": "Sistemas, firmas, permisos",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "M",
    "header": "Autonomía y toma de decisiones",
    "hint": "Bajo / Medio / Alto",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "N",
    "header": "Compatibilidad con las demás funciones",
    "hint": "Compatible / Parcial / Incompatible",
    "group": "Requisitos de la actividad",
    "input": true
   },
   {
    "col": "O",
    "header": "Competencias actuales disponibles",
    "hint": "Lo que hoy tiene el cargo",
    "group": "Brechas y opciones",
    "input": true
   },
   {
    "col": "P",
    "header": "Brechas identificadas",
    "hint": "Diferencia entre requerido y disponible",
    "group": "Brechas y opciones",
    "input": true
   },
   {
    "col": "Q",
    "header": "¿Se puede cerrar con formación?",
    "hint": "Sí / Parcial / No",
    "group": "Brechas y opciones",
    "input": true
   },
   {
    "col": "R",
    "header": "¿Se puede reasignar?",
    "hint": "Sí / Condicionada / No",
    "group": "Brechas y opciones",
    "input": true
   },
   {
    "col": "S",
    "header": "¿Requiere especialización?",
    "hint": "Sí / No",
    "group": "Brechas y opciones",
    "input": true
   },
   {
    "col": "T",
    "header": "Situación (elija una de las cuatro)",
    "hint": "1 capacitar · 2 no corresponde · 3 especialización · 4 simplificar/automatizar",
    "group": "Brechas y opciones",
    "input": true
   },
   {
    "col": "U",
    "header": "¿Responsabilidad sensible o de control?",
    "hint": "Sí / No",
    "group": "Control interno",
    "input": true
   },
   {
    "col": "V",
    "header": "¿Se evaluó separación de funciones y autorizaciones?",
    "hint": "Sí / No",
    "group": "Control interno",
    "input": true
   },
   {
    "col": "W",
    "header": "Alerta de control interno",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "X",
    "header": "Lectura preliminar",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   }
  ]
 },
 "7": {
  "sheetName": "7_Riesgos",
  "title": "HOJA 7 · RIESGOS, CONTROLES Y DEPENDENCIAS",
  "note": "Para cada actividad relevante: riesgo, impacto, controles y concentración del conocimiento. Asegura que las mejoras no eliminen controles necesarios.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "B",
    "header": "Código de actividad",
    "hint": "Elija del listado (hoja 3)",
    "group": "Actividad (automático)",
    "input": true
   },
   {
    "col": "C",
    "header": "Área",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "D",
    "header": "Cargo responsable",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "E",
    "header": "Actividad",
    "hint": "",
    "group": "Actividad (automático)",
    "input": false
   },
   {
    "col": "F",
    "header": "Riesgo de no ejecutarla",
    "hint": "Qué ocurre si no se hace",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "G",
    "header": "Consecuencias de errores o retrasos",
    "hint": "Descríbalas",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "H",
    "header": "Impacto operativo (1-5)",
    "hint": "1 bajo · 5 muy alto",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "I",
    "header": "Impacto económico (1-5)",
    "hint": "1 bajo · 5 muy alto",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "J",
    "header": "Impacto laboral (1-5)",
    "hint": "1 bajo · 5 muy alto",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "K",
    "header": "Impacto legal (1-5)",
    "hint": "1 bajo · 5 muy alto",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "L",
    "header": "Impacto en el servicio (1-5)",
    "hint": "1 bajo · 5 muy alto",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "M",
    "header": "Probabilidad de ocurrencia (1-5)",
    "hint": "1 baja · 5 muy alta",
    "group": "Riesgo e impacto",
    "input": true
   },
   {
    "col": "N",
    "header": "Controles existentes",
    "hint": "Cuáles hay",
    "group": "Controles y dependencias",
    "input": true
   },
   {
    "col": "O",
    "header": "Evidencias de ejecución",
    "hint": "Qué prueba que se hizo",
    "group": "Controles y dependencias",
    "input": true
   },
   {
    "col": "P",
    "header": "Dependencias internas y externas",
    "hint": "De quién o qué depende",
    "group": "Controles y dependencias",
    "input": true
   },
   {
    "col": "Q",
    "header": "Personas que saben ejecutarla",
    "hint": "Número",
    "group": "Controles y dependencias",
    "input": true
   },
   {
    "col": "R",
    "header": "Posibles duplicidades",
    "hint": "Otra persona/área hace lo mismo",
    "group": "Controles y dependencias",
    "input": true
   },
   {
    "col": "S",
    "header": "¿Incompatibilidad de funciones?",
    "hint": "Sí / No",
    "group": "Controles y dependencias",
    "input": true
   },
   {
    "col": "T",
    "header": "Impacto máximo",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "U",
    "header": "Criticidad",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "V",
    "header": "Concentración del conocimiento",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "W",
    "header": "Necesidad de respaldo o reemplazo",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   }
  ]
 },
 "8": {
  "sheetName": "8_Oportunidades",
  "title": "HOJA 8 · DIAGNÓSTICO Y OPORTUNIDADES DE MEJORA",
  "note": "Una oportunidad por fila. Distinga hallazgos confirmados de hipótesis y recomendaciones pendientes de validar.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "REAL / DEMO",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "B",
    "header": "ID de oportunidad",
    "hint": "Único. Ej.: OP-001",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "C",
    "header": "Tipo de oportunidad",
    "hint": "Elija del listado",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "D",
    "header": "Clasificación del hallazgo",
    "hint": "Confirmado, hipótesis o pendiente de validar",
    "group": "Identificación",
    "input": true
   },
   {
    "col": "E",
    "header": "Problema identificado",
    "hint": "Describa el problema",
    "group": "Diagnóstico",
    "input": true
   },
   {
    "col": "F",
    "header": "Actividad relacionada (código)",
    "hint": "Código de la hoja 3",
    "group": "Diagnóstico",
    "input": true
   },
   {
    "col": "G",
    "header": "Evidencia que sustenta el hallazgo",
    "hint": "Dato, registro u observación",
    "group": "Diagnóstico",
    "input": true
   },
   {
    "col": "H",
    "header": "Causa probable",
    "hint": "Hipótesis de causa",
    "group": "Diagnóstico",
    "input": true
   },
   {
    "col": "I",
    "header": "Propuesta de mejora",
    "hint": "Qué se propone",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "J",
    "header": "Área afectada",
    "hint": "Del listado",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "K",
    "header": "Cargo afectado",
    "hint": "Cargo",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "L",
    "header": "Beneficio esperado",
    "hint": "Qué se gana",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "M",
    "header": "Tiempo recuperable estimado (h/sem)",
    "hint": "Horas por semana. Si no se puede estimar, déjelo vacío",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "N",
    "header": "Impacto económico anual estimado",
    "hint": "",
    "group": "Propuesta",
    "input": false
   },
   {
    "col": "O",
    "header": "Supuestos del impacto económico",
    "hint": "Cómo se calculó",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "P",
    "header": "Riesgos de implementación",
    "hint": "Qué puede salir mal",
    "group": "Propuesta",
    "input": true
   },
   {
    "col": "Q",
    "header": "Impacto esperado (1-5)",
    "hint": "5 = mayor beneficio",
    "group": "Priorización",
    "input": true
   },
   {
    "col": "R",
    "header": "Facilidad de implementación (1-5)",
    "hint": "5 = más fácil",
    "group": "Priorización",
    "input": true
   },
   {
    "col": "S",
    "header": "Esfuerzo (1-5)",
    "hint": "5 = mayor esfuerzo",
    "group": "Priorización",
    "input": true
   },
   {
    "col": "T",
    "header": "Costo (1-5)",
    "hint": "5 = mayor costo",
    "group": "Priorización",
    "input": true
   },
   {
    "col": "U",
    "header": "Riesgo (1-5)",
    "hint": "5 = mayor riesgo",
    "group": "Priorización",
    "input": true
   },
   {
    "col": "V",
    "header": "Responsable",
    "hint": "Quién lidera",
    "group": "Seguimiento",
    "input": true
   },
   {
    "col": "W",
    "header": "Plazo",
    "hint": "dd/mm/aaaa",
    "group": "Seguimiento",
    "input": true
   },
   {
    "col": "X",
    "header": "Indicador de seguimiento",
    "hint": "Cómo se medirá",
    "group": "Seguimiento",
    "input": true
   },
   {
    "col": "Y",
    "header": "Estado de validación",
    "hint": "Pendiente / En validación / Validada / Rechazada",
    "group": "Seguimiento",
    "input": true
   },
   {
    "col": "Z",
    "header": "Puntaje de priorización (0-100)",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "AA",
    "header": "Prioridad",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "AB",
    "header": "Tipo de implementación",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "AC",
    "header": "Control del hallazgo",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   }
  ]
 },
 "9": {
  "sheetName": "9_Rediseno",
  "title": "HOJA 9 · REDISEÑO DE FUNCIONES Y PERFILES",
  "note": "Compare el cargo actual con la propuesta. Las propuestas requieren validación del responsable del área y aprobación de la Gerencia antes de modificar perfiles o estructuras.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "REAL / DEMO",
    "group": "Cargo actual",
    "input": true
   },
   {
    "col": "B",
    "header": "Área",
    "hint": "Del listado",
    "group": "Cargo actual",
    "input": true
   },
   {
    "col": "C",
    "header": "Cargo actual",
    "hint": "Igual que en hoja 2",
    "group": "Cargo actual",
    "input": true
   },
   {
    "col": "D",
    "header": "Objetivo actual",
    "hint": "Del cargo",
    "group": "Cargo actual",
    "input": true
   },
   {
    "col": "E",
    "header": "Funciones actuales",
    "hint": "Las que ejecuta hoy",
    "group": "Cargo actual",
    "input": true
   },
   {
    "col": "F",
    "header": "Actividades que se mantienen",
    "hint": "Códigos o nombres",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "G",
    "header": "Actividades que se modifican",
    "hint": "Códigos o nombres",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "H",
    "header": "Actividades que se eliminan",
    "hint": "Solo previa validación",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "I",
    "header": "Actividades que se trasladan",
    "hint": "Códigos o nombres",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "J",
    "header": "Cargo que recibe lo trasladado",
    "hint": "Obligatorio si hay traslado",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "K",
    "header": "Nuevas responsabilidades",
    "hint": "Si las hay",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "L",
    "header": "Límites y facultades del cargo",
    "hint": "Qué puede decidir",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "M",
    "header": "Competencias requeridas",
    "hint": "Del cargo propuesto",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "N",
    "header": "Necesidades de capacitación",
    "hint": "Qué formación se requiere",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "O",
    "header": "Indicadores de desempeño",
    "hint": "Cómo se evaluará",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "P",
    "header": "Relaciones de reporte y coordinación",
    "hint": "A quién reporta y con quién coordina",
    "group": "Propuesta de cambio",
    "input": true
   },
   {
    "col": "Q",
    "header": "Carga actual estimada (h/sem, todo el cargo)",
    "hint": "",
    "group": "Carga",
    "input": false
   },
   {
    "col": "R",
    "header": "Capacidad disponible (h/sem, todo el cargo)",
    "hint": "",
    "group": "Carga",
    "input": false
   },
   {
    "col": "S",
    "header": "% de capacidad actual",
    "hint": "",
    "group": "Carga",
    "input": false
   },
   {
    "col": "T",
    "header": "Horas/sem que salen del cargo",
    "hint": "Se trasladan a otro cargo",
    "group": "Carga",
    "input": true
   },
   {
    "col": "U",
    "header": "Horas/sem que ingresan al cargo",
    "hint": "Recibe de otro cargo",
    "group": "Carga",
    "input": true
   },
   {
    "col": "V",
    "header": "Horas/sem recuperadas (eliminación, simplificación o automatización)",
    "hint": "No se trasladan: desaparecen",
    "group": "Carga",
    "input": true
   },
   {
    "col": "W",
    "header": "Carga propuesta estimada (h/sem)",
    "hint": "",
    "group": "Carga",
    "input": false
   },
   {
    "col": "X",
    "header": "% de capacidad propuesto",
    "hint": "",
    "group": "Carga",
    "input": false
   },
   {
    "col": "Y",
    "header": "Alerta del rediseño",
    "hint": "",
    "group": "Carga",
    "input": false
   },
   {
    "col": "Z",
    "header": "Justificación de los cambios",
    "hint": "Por qué",
    "group": "Cierre",
    "input": true
   },
   {
    "col": "AA",
    "header": "Beneficios esperados",
    "hint": "Qué mejora",
    "group": "Cierre",
    "input": true
   },
   {
    "col": "AB",
    "header": "Riesgos y condiciones de implementación",
    "hint": "Qué debe cumplirse",
    "group": "Cierre",
    "input": true
   },
   {
    "col": "AC",
    "header": "Estado de aprobación",
    "hint": "Ningún cambio es formal hasta aprobación de Gerencia",
    "group": "Cierre",
    "input": true
   }
  ]
 },
 "10": {
  "sheetName": "10_Plan_accion",
  "title": "HOJA 10 · PLAN DE ACCIÓN",
  "note": "Convierta las recomendaciones en acciones con responsable, fechas, meta y resultado real.",
  "columns": [
   {
    "col": "A",
    "header": "Tipo de dato",
    "hint": "REAL / DEMO",
    "group": "Acción",
    "input": true
   },
   {
    "col": "B",
    "header": "ID de acción",
    "hint": "Único. Ej.: AC-001",
    "group": "Acción",
    "input": true
   },
   {
    "col": "C",
    "header": "Hallazgo u oportunidad (ID o texto)",
    "hint": "Qué origina la acción",
    "group": "Acción",
    "input": true
   },
   {
    "col": "D",
    "header": "Acción propuesta",
    "hint": "Concreta y verificable",
    "group": "Acción",
    "input": true
   },
   {
    "col": "E",
    "header": "Área responsable",
    "hint": "Del listado",
    "group": "Responsables",
    "input": true
   },
   {
    "col": "F",
    "header": "Cargo responsable",
    "hint": "Cargo",
    "group": "Responsables",
    "input": true
   },
   {
    "col": "G",
    "header": "Recursos necesarios",
    "hint": "Personas, sistemas, presupuesto",
    "group": "Responsables",
    "input": true
   },
   {
    "col": "H",
    "header": "Costo estimado",
    "hint": "Valor en pesos",
    "group": "Responsables",
    "input": true
   },
   {
    "col": "I",
    "header": "Prioridad",
    "hint": "Alta / Media / Baja",
    "group": "Responsables",
    "input": true
   },
   {
    "col": "J",
    "header": "Tipo de iniciativa",
    "hint": "Rápida, inversión, tecnología, capacitación, cambio",
    "group": "Responsables",
    "input": true
   },
   {
    "col": "K",
    "header": "Fecha de inicio",
    "hint": "dd/mm/aaaa",
    "group": "Cronograma",
    "input": true
   },
   {
    "col": "L",
    "header": "Fecha de finalización",
    "hint": "dd/mm/aaaa",
    "group": "Cronograma",
    "input": true
   },
   {
    "col": "M",
    "header": "Dependencias",
    "hint": "Acciones previas",
    "group": "Cronograma",
    "input": true
   },
   {
    "col": "N",
    "header": "Riesgos",
    "hint": "Qué puede salir mal",
    "group": "Cronograma",
    "input": true
   },
   {
    "col": "O",
    "header": "Indicador de resultado",
    "hint": "Cómo se medirá",
    "group": "Resultado",
    "input": true
   },
   {
    "col": "P",
    "header": "Meta (valor numérico)",
    "hint": "Valor esperado",
    "group": "Resultado",
    "input": true
   },
   {
    "col": "Q",
    "header": "Estado",
    "hint": "No iniciada / En curso / Completada / Bloqueada / Cancelada",
    "group": "Resultado",
    "input": true
   },
   {
    "col": "R",
    "header": "Resultado real tras implementar",
    "hint": "Se diligencia al final",
    "group": "Resultado",
    "input": true
   },
   {
    "col": "S",
    "header": "Duración planificada (días)",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "T",
    "header": "Diferencia entre lo obtenido y lo esperado",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "U",
    "header": "% de cumplimiento de la meta",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   },
   {
    "col": "V",
    "header": "Alerta de plazo",
    "hint": "",
    "group": "Resultado automático",
    "input": false
   }
  ]
 }
};
