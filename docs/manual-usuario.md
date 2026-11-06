# Manual de usuario — Estudio de Actividades y Cargas Laborales

## 1. Ingreso
Entre a la dirección de la aplicación y pulse **Ingresar con Google**. Solo se muestran los estudios de los que usted es miembro. Sin sesión se ve únicamente un tablero de demostración con datos ficticios.

Roles: **Propietario**, **Editor**, **Analista** (pueden modificar) y **Solo lectura** (solo consulta; los botones de guardar aparecen deshabilitados).

**Modo claro u oscuro.** En el encabezado, junto a su nombre, hay un botón con un sol y una luna: púlselo para pasar de un modo al otro. La aplicación lo recuerda en ese navegador. Mientras no lo pulse, la aplicación usa el modo que tenga configurado su equipo.

## 2. Estudio
En **Estudio**: cree un estudio (se cargan las 14 áreas operativas y los parámetros por defecto) y elija el estudio activo. **La aplicación es la única fuente de los datos de entrada** (D-63): cada dato se captura en su propia sección (Parámetros, Cargos y dotación, Actividades y las seis subsecciones de **Diagnóstico y rediseño**), con un formulario que tiene TODAS las casillas amarillas del libro con TODAS sus casillas amarillas, con los mismos encabezados y listas desplegables; cada guardado se escribe solo en la hoja de Google. Si otra persona modificó el registro antes, verá un aviso de conflicto (409): recargue y repita.

Una actividad con datos faltantes se guarda y muestra **qué le falta**; no suma carga hasta estar completa. La aplicación nunca inventa valores.

## 3. Hojas 5 a 10 y parámetros
En cada una de esas secciones, el bloque **Registros capturados** (con el botón «Agregar registro») muestra los registros con **Editar** / **Eliminar** y las columnas con fórmula del libro (marcadas 🔒) como **valores calculados de solo lectura**, con las mismas reglas del Excel (puntaje, nivel, criticidad, prioridad, carga propuesta, cumplimiento y alertas de plazo).
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

## 8. Historia, productividad y desviaciones
En **Historia y desviaciones** hay cuatro vistas.
- **Registro de cambios**: todo lo que se crea, modifica o elimina en las secciones y en la administración (roles, personas, claves), con la fecha y hora, **la persona que lo hizo**, la sección, el registro, el área y el cargo, y el detalle «campo: antes → después». Use *Filtros* para buscar por palabra clave (varias palabras: deben estar todas; no distingue tildes ni mayúsculas) y para filtrar por tipo de cambio, sección, usuario, área, cargo, acción, origen y fechas. *Descargar Excel* baja lo que está filtrado. Es de solo consulta: nadie puede modificar ni borrar este registro. Lo ve quien tiene Historia con todas las áreas. Lo eliminado antes de que existiera esta vista no guardó qué era, por eso aparece sin área ni cargo.
- **Línea de tiempo**: cambios de los últimos 90 días por origen (aplicación, hoja, importación, autocorrector, agente), fotos del tablero y fechas de fin del plan. Cada lunes se toma una foto automática; también puede tomarla a mano. Elija dos fotos y pulse *Comparar* para ver qué cambió.
- **Productividad real**: registre mediciones (unidades procesadas y horas-persona). Mientras una actividad no tenga el mínimo de mediciones verá «Sin mediciones» o «Faltan mediciones», nunca un número. Un índice bajo no concluye ineficiencia: puede ser un tiempo estimado optimista o esperas no registradas.
- **Desviaciones**: ocho reglas (estimado vs medido, cruce de umbral, salto sin respaldo, pérdida de calidad, dispersión entre sedes, plan vencido reincidente, más actividades incompletas y conflictos recurrentes). Puede *Reconocer*, *Descartar* (no vuelve a aparecer en 30 días) o *Reabrir*. *Explicar con IA* redacta una explicación que cita los cambios registrados y no puede inventar cifras. Los umbrales se editan en *Parámetros* y son provisionales.
## 9. Comparador de sedes y drill-down
- **Comparador de sedes** (hoja 2b): elija un cargo y vea, sede por sede, ocupantes, jornada, capacidad, horas asignadas, % de capacidad, horas por ocupante, actividades registradas y cuántas no están documentadas formalmente. Si la diferencia de horas por ocupante entre sedes supera el 30 % (máximo − mínimo sobre el promedio) aparece el aviso para verificar si es una operación distinta o una diferencia de levantamiento.
- **Drill-down**: desde el tablero (nombre de cada área) o desde *Drill-down*, baje de Estudio a Área, Cargo y Actividad con un clic. Hay dos configuraciones: *Carga por área* y *Calidad de datos*, y un filtro (todos, solo sobrecarga, solo carga baja, solo incompletos). Las horas de cada nivel suman las del nivel superior. Ambas vistas se exportan a Excel, CSV y PDF.
- Las pantallas de lectura se actualizan solas cada 45 segundos mientras la pestaña esté visible y usted no esté escribiendo.
## 10b. Resultados · Dotación requerida
El grupo **Resultados** del menú (antes de «Usuarios y roles») reúne los resultados finales del estudio; irá ganando subsecciones. Por ahora solo lo ve el Super usuario: para habilitarlo a otro rol, en **Usuarios y roles › Roles** edite el rol y elija Lectura o Edición en «Resultados» (la aplicación sube a Lectura Cargos y Actividades, que necesita). Contiene **Dotación requerida** y el **Agente de IA** (este último, además, exige que el rol tenga «Agente de IA» y todas las áreas). La demostración no ve este grupo. **Dotación requerida** responde cuánta gente hace falta. **Reparto semanal** muestra, para cada cargo con turnos, cómo repartir sus tareas entre las personas necesarias día a día, con el tiempo de cada actividad, en dos semanas: la **semana común** (actividades diarias y semanales) y la **semana con actividades periódicas** (suma las quincenales, mensuales, trimestrales y anuales, suponiendo que coinciden; dice si esa semana hace falta refuerzo). La regla depende del tipo de actividad: las operativas y de servicio se parten entre personas; las administrativas, de control y de apoyo las hace una persona por ejecución; la coordinación, una sola persona; lo ocasional o no planificado se muestra como «Imprevistos». Los días son los de los turnos del cargo (un cargo sin turnos no se reparte: regístrelos en Cargos y dotación) y las personas aparecen como «Persona 1, 2…». Se exporta a Excel, CSV y PDF. Para cada cargo calcula: **personas necesarias = horas de la semana ÷ horas útiles de una persona**, donde las horas útiles son la jornada semanal menos la reserva de capacidad de Parámetros; el resultado se redondea hacia arriba porque no existe media persona. La **brecha** es las necesarias menos las que hay: positiva, faltan; negativa, hay de más. Se ve por cargo y por área, y se puede filtrar y exportar a Excel, CSV y PDF. Un cargo al que le falta la cantidad de personas, la jornada o actividades completas aparece «Sin datos» y no recibe cifra; si tiene actividades incompletas, la cifra es un mínimo. Un «Posible excedente» es una señal para revisar que el inventario esté completo, no una decisión de reducir personal. Usa el escenario elegido en Parámetros (base, temporada alta o baja, tiempo mínimo o máximo).

## 10. Cálculo de tiempos (hoja 4a)
La pestaña **Cálculo de tiempos (4a)** muestra, para cada actividad, las mismas columnas calculadas de la hoja «4a_Calculo_tiempos» del libro (ejecuciones por semana, horas por ejecución, escenarios base/alto/bajo/mínimo/máximo, ocupantes, multiplicador, horas totales y por cargo, no planificadas, reprocesos, esperas y horas por mes). Una actividad incompleta muestra «—» y no suma. Si el estudio está conectado a una hoja de Google, el botón **Comparar ahora con la hoja de Google** lee, sin modificar nada, lo que calculó esa hoja y marca actividad por actividad si es igual o difiere. Se exporta a Excel, CSV y PDF.

### Validar la cobertura de funciones de un cargo

Al terminar de ingresar las actividades de un cargo, compruebe que no quedó ninguna función del perfil sin actividad: en **Cargos y dotación › Editar** (junto a «Funciones formalmente asignadas (perfil)») pulse **Validar cobertura de funciones**, o elija el cargo en **Agente de IA › Validar cobertura de un cargo**. Cada función aparece como Cubierta, Parcialmente cubierta (con lo que falta) o Sin cobertura (alerta), y se listan aparte las actividades que no se relacionaron con ninguna función. Es una ayuda de la IA: verifique el resultado antes de decidir. No cambia ningún dato; hay un tope de 20 validaciones por día.

El resultado de la validación se puede descargar con **Descargar Excel** y **Descargar PDF** (arriba de la tabla). Los archivos incluyen el cargo, el resumen, el aviso de IA, cada función completa con su estado, las actividades que la cubren y las actividades sin función; se generan al momento y no se guardan.
