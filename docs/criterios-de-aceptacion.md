# Criterios de aceptación del brief y su prueba

Estado a la fecha de la última verificación. «Prueba» = el comando o archivo que lo demuestra; la salida completa de las corridas está en `docs/evidence/`.
Lo que no está completo o depende de otra persona figura al final, sin maquillaje.

| Fase | Criterio del brief | Prueba / evidencia | Estado |
|---|---|---|---|
| F0 | `npm run verify` verde · CI verde | CI en cada commit (jobs `verify`, `e2e`, `restore`, `secrets-and-sast`) | Cumplido |
| F0 | El hook bloquea un `.env` de prueba | `npm run test:hook` (5 pruebas) — el hook del anexo era una página de Google Drive, se reescribió (D-52) | Cumplido |
| F0 | gitleaks limpio · variables en Vercel sin valores en el repositorio | CI `secrets-and-sast`; `npm run test:arch` (sin secretos en `src/`) | Cumplido |
| F1 | 17 pruebas de RLS contra Supabase dev | `docs/evidence/fase1/rls_supabase_dev.txt` (17/17) | Cumplido |
| F1 | `drizzle-kit generate` sin cambios pendientes | `npx drizzle-kit generate` → «No schema changes» | Cumplido |
| F1 | Matriz de permisos de las 23 tablas | `npm run test:policies` (7 pruebas) + `npm run test:matrix` (4) | Cumplido |
| F2 | Conteos cuadran · 0 diferencias campo a campo | `docs/evidence/fase2/ida_y_vuelta.txt`: 1 198 campos, 1 diferencia explicada (edición posterior en la hoja de Google, con auditoría) | Cumplido |
| F2 | 0 diferencias en el recálculo · duplicados e incompletos reportados | `npm run test:import` (7); informe de importación; recálculo de 226 valores en 0 diferencias | Cumplido |
| F3 | E2E: crear estudio → cargo → actividad → ver estado | `e2e/sesion.spec.ts` (13 pruebas) contra producción | Cumplido |
| F3 | El viewer no edita · 409 por versión desactualizada | `e2e/sesion.spec.ts`, `npm run test:capture` | Cumplido |
| F4 | Prueba dorada con ≥ 3 variantes: 0 diferencias | `npm run test:golden` (870 valores, 3 variantes) | Cumplido |
| F4 | Tablero idéntico al Excel (12 indicadores, top 10, conclusiones) | `scripts/verify-dashboard.ts` (192 valores, 0 diferencias) | Cumplido |
| F4 | Cambiar un dato actualiza los resultados dependientes | `npm run test:f3`, `e2e/sesion.spec.ts` | Cumplido |
| F4 | Drill-down básico | `npm run test:drill` (9) + E2E | Cumplido (configuración «riesgos-por-area» [PROPUESTA] pendiente) |
| F4 | Realtime | Reemplazado por refresco automático cada 45 s (D-56) | Parcial, decidido |
| F5 | 0 diferencias en las columnas calculadas de las hojas 5–10 | `npm run test:oracle`: 9 478 valores, LibreOffice 25.8.7; encontró y corrigió el redondeo de la prioridad (D-47) | Cumplido |
| F6 | Suite de seguridad verde | `test:rls`, `test:matrix`, `test:policies`, `test:arch`, `test:hook`, `test:webhook` | Cumplido |
| F6 | CodeQL sin altos | CI `secrets-and-sast`; la única alerta alta (`js/incomplete-sanitization`) se corrigió y hoy hay 0 alertas abiertas | Cumplido |
| F6 | npm audit sin altos | CI (`npm audit --omit=dev --audit-level=high`) | Cumplido |
| F6 | ZAP baseline sin altos | `docs/evidence/fase6/zap_baseline.txt`: 0 altas, 2 medias aceptadas (D-58) | Cumplido |
| F6 | Prueba de restauración documentada | Job `restore` del CI (pg_dump/pg_restore reales) + `docs/runbook.md` (D-59) | Cumplido (la restauración en Supabase alojado depende del plan) |
| F7 | Exporte = pantalla (comparación automática) | `npm run test:summary` (todas las vistas, filas = pantalla) | Cumplido |
| F7 | Humo en producción · documentación | `docs/evidence/fase7/e2e_produccion.txt` (44 de 44); `docs/manual-usuario.md`, `docs/runbook.md` | Cumplido |
| F8 | 6 escenarios con hoja real | `npm run test:sheets-live` (8 de 8); `docs/evidence/fase8/sheets_live_6_escenarios.txt` | Cumplido |
| F8 | Reglas del autocorrector con sus casos · tope de 50 correcciones | `npm run test:sheets` (19), `test:domain` | Cumplido |
| F9 | Evaluación dorada ≥ 20 casos · 0 acciones por inyección | `npm run eval:agent`: 25 casos × 2, 50/50 en la última corrida (la salida del modelo no es determinista) | Cumplido |
| F9 | Ninguna propuesta se aplica sin aprobación · costo dentro del tope | `npm run test:agent` (7), tope de 8 000 tokens por ejecución garantizado por código | Cumplido |
| F10 | Reglas con casos sintéticos · explicaciones con identificadores · «sin mediciones» | `npm run test:history` (16), `npm run eval:explain` | Cumplido |

## Lo que sigue abierto
**Decisiones de la empresa o tareas de una persona (no se pueden cerrar con código):**
- D-22: validación jurídica (Ley 1581 de 2012) antes de abrir el acceso a más personas.
- D-16: revisar los términos de retención del proveedor de IA antes de enviar datos reales al agente.
- D-20: valores finales de los umbrales de desviación y del mínimo de mediciones (hoy provisionales).
- Rotar las credenciales que se compartieron en la conversación y pedir a GitHub Support que purgue el commit `9ac9722`.
- Fijar en Supabase Auth el tiempo de vida de las sesiones (brief §16.3) y confirmar en el panel qué copias de seguridad ofrece el plan.

**Pendiente técnico, de baja prioridad:**
- Configuración de drill-down «riesgos-por-area» y la tabla `drill_presets` para configuraciones guardadas [PROPUESTA].
- COEP no se agrega (puede romper recursos externos). Dos alertas medias de ZAP aceptadas y explicadas.
- Las propuestas de Dependabot (actualizaciones de las acciones de GitHub) están abiertas como pull requests para revisión: no se aplican solas.
