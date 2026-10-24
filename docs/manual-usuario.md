# Manual de usuario — Estudio de Actividades y Cargas Laborales

## 1. Ingreso
Entre a la dirección de la aplicación y pulse **Ingresar con Google**. Solo se muestran los estudios de los que usted es miembro. Sin sesión se ve únicamente un tablero de demostración con datos ficticios.

Roles: **Propietario**, **Editor**, **Analista** (pueden modificar) y **Solo lectura** (solo consulta; los botones de guardar aparecen deshabilitados).

## 2. Estudio
En **Estudio (captura)**: cree un estudio (se cargan las 14 áreas operativas y los parámetros por defecto), elija el estudio activo, registre **cargos con su dotación** (cantidad y jornada semanal) y **actividades**. Para cambiar el tiempo promedio de una actividad use la tabla inferior; si otra persona la modificó antes, verá un aviso de conflicto: recargue y repita.

Una actividad con datos faltantes se guarda y muestra **qué le falta**; no suma carga hasta estar completa. La aplicación nunca inventa valores.

## 3. Hojas 5 a 10 y parámetros
En **Hojas 5–10 y parámetros** hay una pestaña por hoja: Medibilidad, Pertinencia, Riesgos, Oportunidades, Rediseño, Plan de acción y Parámetros. Cada una muestra el formulario, los registros ya capturados con **Editar** / **Eliminar** y el **resultado calculado** con las mismas reglas del Excel (puntaje, nivel, criticidad, prioridad, carga propuesta, cumplimiento y alertas de plazo).
- Los porcentajes se escriben como número (10 = 10 %). Decimales con coma o punto.
- Un valor inválido (texto en un número, escala fuera de 1–5, fecha imposible) se rechaza con un mensaje.
- Cada cambio queda en el registro de auditoría.

## 4. Lectura de resultados
- **Tablero**: 12 indicadores, carga por área, distribución de horas, top 10, cobertura, oportunidades y conclusiones preliminares.
- **Cargos y dotación**: capacidad, horas y % de capacidad. «ALERTA» = carga superior a la capacidad; «VALIDAR» = carga baja (no implica personal sobrante).
- **Modo de análisis**: REAL, DEMO o TODOS. Use REAL para decisiones.
- Los resultados son **preliminares**: dependen de supuestos que debe validar el responsable (parámetro «Supuestos validados»).

## 5. Exportar
Cada vista tiene **Exportar Excel**, **CSV** y **PDF**. El CSV usa «;» y coma decimal. Se limita a 30 descargas por minuto.

## 6. Datos personales
Los datos del estudio pueden incluir información laboral de personas. Antes de abrir el acceso a más usuarios debe existir la validación jurídica (Ley 1581 de 2012). El asistente de IA recibirá solo resúmenes sin nombres.

## 7. Integraciones (Google Sheets)
En **Integraciones** el propietario conecta una hoja de Google. **Vista previa** muestra qué pasaría sin cambiar nada; **Sincronizar ahora** aplica los cambios: lo que editó en la hoja pasa a la aplicación (con control de versión) y lo que solo existe en la aplicación se agrega a la hoja. La aplicación manda: si la misma fila cambió en los dos lados, gana la aplicación y la hoja recupera el valor vigente (queda un hallazgo). Las celdas con errores (p. ej. texto en un número) no borran el dato guardado; aparecen en *Calidad de datos*.
