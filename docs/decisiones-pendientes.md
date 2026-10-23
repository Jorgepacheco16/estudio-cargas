# Decisiones pendientes y estado

- D-01/D-02: codigo en GitHub (Jorgepacheco16/estudio-cargas), npm, Next.js App Router. Hecho.
- D-04: proyecto Supabase de desarrollo creado: estudio-cargas-dev (sa-east-1). Proyecto de produccion: pendiente.
- D-05: rol app_user creado en dev (NOINHERIT, sin BYPASSRLS, miembro de anon/authenticated). Pendiente: repetir las 17 pruebas RLS contra dev.
- F1: 0000_init.sql y 0001_rls.sql aplicadas en dev: 23 tablas, 90 politicas RLS.
- Semilla de las 14 areas: las areas son por estudio (areas.study_id); se cargan al crear/importar un estudio (F2/F3), no globalmente.
- Vercel: proyecto sin crear (cuenta personal requiere equipo para API/CLI). Pendiente.
- Falta el Excel de referencia (docs/reference/) para test:golden y la importacion (F2).

- D-26 (F2): una fila de las hojas 5-7 que solo trae el codigo se importa como evaluacion vacia (queda 'Evaluacion incompleta') y el tablero la cuenta, igual que el Excel. Brief 10.1: fila valida = codigo presente.
- D-27 (F2): una actividad cuyo cargo no esta en la hoja 2 crea el cargo con auto_created=true (D-08). El cargo que asume el resto de la carga tambien se crea y aparece con 'Falta registrar cantidad y jornada'.
- D-28 (F4): el desempate del top 10 sigue el orden de codigo de actividad (el Excel usa la fila de la hoja); con horas iguales gana la posterior, como LARGE del libro.
- D-29 (F4): el banner del modo TODOS del Excel esta truncado en el brief; se uso: 'se muestran datos REAL y DEMO juntos. Cambie a REAL...'. Confirmar el texto.
- D-30 (F5): el oraculo de las hojas 5-10 con LibreOffice sobre libros de casos limite sigue pendiente (no hay LibreOffice local). Hoy: tablas de verdad desde las formulas literales + tablero real contra la hoja 11 (192 valores).
- D-22 (F2): el usuario decidio cargar el Excel con datos reales a Supabase dev el 2026-10-23, antes de la validacion juridica (Ley 1581 de 2012). Pendiente: validacion juridica y politica de retencion.

## F6/F7
- **D-31** Límite de tasa en memoria por instancia (no global). Un límite global requiere un almacén compartido (p. ej. Redis); pendiente de decisión.
- **D-32** Prueba de restauración de respaldo y escaneo ZAP: pendientes. Requieren pg_dump y un objetivo desplegado en un entorno de prueba.
- **D-33** CSP con 'unsafe-inline' en script/style por los scripts en línea de Next.js; endurecer con nonces queda para después.
