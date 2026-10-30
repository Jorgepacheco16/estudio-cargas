# Guía de operación (runbook)

## Componentes
Vercel (Next.js, despliegue desde GitHub `main`) · Supabase (Postgres con RLS + Auth Google) · GitHub Actions (CI) · Anthropic API (Fase 9).

## Variables de entorno (Vercel → Settings → Environment Variables)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` (rol `app_user`, pooler 6543), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. Nunca van al repositorio. `SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL_MIGRATIONS` no se usan en rutas de usuario; no las cargue en Vercel salvo necesidad documentada.

## Despliegue
Un push a `main` dispara CI (verify + secrets-and-sast) y el despliegue de Vercel. Si CI falla, no confíe en el despliegue: revise el log del job.

## Migraciones
`drizzle-kit generate` crea la migración; se aplica a Supabase con la conexión de migraciones desde su equipo o desde CI. Nunca edite una migración ya aplicada: cree otra.

## Pruebas
`npm run verify` ejecuta tipos, dominio, etiquetas, resumen, calculadoras, RLS, captura, matriz de RLS, importación, golden (LibreOffice) y auditoría de dependencias. **No ejecute `test:rls` contra Supabase** (borra estudios y usuarios): el guard lo impide.

## Rotación de credenciales
1. Supabase → Project Settings → API / Database: rote claves y contraseña de `app_user`.
2. Anthropic Console: revoque y cree la clave.
3. Vercel: actualice variables y vuelva a desplegar.
4. Actualice su `.env.local`.

## Respaldo y restauración
Supabase mantiene copias diarias (según el plan). Para restaurar a un proyecto nuevo: restaurar la copia en el panel, ejecutar las migraciones pendientes y verificar con `npm run import`/`verify-dashboard` que los conteos coinciden. La prueba de restauración periódica está pendiente (ver decisiones-pendientes).

## Incidentes
- **No cargan los datos**: revise `DATABASE_URL` y el estado de Supabase; la app muestra «No se pudieron leer los datos del estudio».
- **Ingreso falla**: revise la URL de redirección en Google Cloud y en Supabase Auth.
- **Fuga de un secreto**: rótelo de inmediato (sección anterior) y revise `gitleaks` en CI.
- **Conflicto 409 frecuente**: dos personas editan el mismo registro; coordine o recargue.

## Sincronización con Google Sheets
- **Variables**: `GOOGLE_SERVICE_ACCOUNT_JSON` (llave completa de la cuenta de servicio), `SHEETS_WEBHOOK_SECRET` (el mismo valor va en la propiedad `WEBHOOK_SECRET` de Apps Script), `CRON_SECRET` (Vercel lo envía como `Authorization: Bearer` a `/api/sheets/reconcile`).
- **Conectar**: Integraciones → pegar la dirección de la hoja (nativa de Google, compartida como Editor con la cuenta de servicio) → *Vista previa* → *Sincronizar ahora*. La primera sincronización agrega dos columnas ocultas al final de cada pestaña (`__app_id`, `__app_version`); no las borre ni las edite.
- **Modo de la conexión**: desde D-63 el modo recomendado es «La app alimenta la hoja» (`push`): cada guardado en la app se escribe en la hoja de Google tras responder (si Google falla queda un evento con error y «Sincronizar ahora» lo corrige). Las filas de la hoja que no existen en la app NO se borran (se cuentan como «sin vincular»). Apps Script solo aplica a los modos heredados (bidireccional / solo hoja → app).
- **Apps Script** (solo modos heredados): Integraciones → *Descargar Code.gs* → Extensiones → Apps Script → pegar → Configuración del proyecto → Propiedades del script → `WEBHOOK_SECRET` → Activadores: `onEditInstalled` (al editar) y `onChangeInstalled` (al cambiar).
- **Conflictos**: si la app tiene una versión más nueva que la de la fila, la hoja recupera el valor de la app y queda un hallazgo «VERSION_CONFLICT» en Integraciones.
- **Rotar el secreto del webhook**: cambiar `SHEETS_WEBHOOK_SECRET` en Vercel y `WEBHOOK_SECRET` en Apps Script a la vez; entre un cambio y otro los eventos se rechazan (401) y la reconciliación los recupera.
- **Migraciones**: `drizzle/0002_sheet_connections_actor.sql` y luego `sql/0002_sheets.sql` (función segura para ubicar la conexión desde el webhook).

## Historia y desviaciones
- **Migraciones**: `drizzle/0003_deviation_thresholds.sql` y luego `sql/0003_history.sql` (función segura de las fotos programadas).
- **Turnos (D-67)**: `drizzle/0004_position_shifts.sql` y luego `sql/0004_shifts.sql` (tablas position_shifts y activity_shifts con sus políticas RLS; columna activities.all_shifts). Luego `drizzle/0005_shift_days.sql` (columna position_shifts.days: días en que aplica el turno). Luego `drizzle/0006_position_operation.sql` (columna positions.operation_description: descripción de la operación del cargo, D-69). Luego `drizzle/0007_diagnostico_centro_operaciones.sql` (columna site_id en improvement_opportunities, redesign_proposals y action_items: centro de operaciones, D-75). Luego `drizzle/0008_position_shift_type.sql` (columna positions.shift_type: tipo de turno del cargo, Fijo o Variable, D-86). Luego `drizzle/0009_daily_work_hours.sql` (columna study_parameters.daily_work_hours: jornada laboral diaria en horas, D-87). Luego `drizzle/0010_roles_usuarios.sql` y `sql/0005_roles_rls.sql` (roles, permisos por módulo, invitaciones y áreas de cada persona; reemplaza las políticas de las tablas por las que miran el módulo; crea los roles iniciales de los estudios existentes, D-91).
- **Cron**: `vercel.json` programa `/api/sheets/reconcile` (diario) y `/api/history/snapshot` (lunes 10:00 UTC). Ambos exigen `Authorization: Bearer CRON_SECRET`.
- **Evaluación del agente**: `npm run eval:agent` y `npm run eval:explain` (consumen tokens; no corren en CI).
## Pruebas de navegador y oráculo
- `npm run test:e2e` (públicas; requiere `npm run build` antes) y `E2E_SESSION=1 npm run test:e2e-sesion` (con sesión; usa un usuario temporal y necesita `.env.local`). Con `E2E_BASE_URL=https://…` se prueba un despliegue existente.
- Playwright necesita su navegador: `npx playwright install chromium`.
- Oráculo: `npm run test:oracle`. Regenerarlo: LibreOffice instalado (o la copia portátil extraída con `msiexec /a`), el libro de referencia y `npm run make:oracle -- <libro.xlsx> <ruta a soffice.com>`.
- Región: la función de Vercel debe estar en la misma región que Supabase (`vercel.json` → `regions`). Si cambia la región de la base, cámbiela también aquí.
## Respaldo y restauración (procedimiento y prueba)
1. **Respaldo lógico**: `pg_dump --format=custom` con la conexión de administración (no la de la aplicación). Guárdelo cifrado; contiene datos del estudio.
2. **Restauración**: crear una base vacía, ejecutar `pg_restore --exit-on-error` y, si es un proyecto nuevo de Supabase, crear el rol `app_user` (D-05) y aplicar las migraciones pendientes (`drizzle/*.sql` y `sql/*.sql` en orden).
3. **Verificación**: `scripts/restore-verify.ts` (filas por tabla, políticas, aislamiento por usuario e indicadores). El job `restore` de `.github/workflows/ci.yml` hace todo el ciclo en cada cambio.
4. **Supabase alojado**: confirme en el panel (Database → Backups) qué copias ofrece su plan y su ventana de retención; haga una restauración de prueba a un proyecto nuevo al menos una vez antes de depender de ellas.
5. **ZAP**: el workflow `zap` escanea la aplicación publicada cada lunes; los hallazgos aparecen como anotaciones del job (ALTO hace fallar el flujo).
## Respaldo, sesiones y dependencias
- **Respaldo completo en Excel**: pantalla *Estudio* → «Descargar respaldo completo (Excel)» (cualquier miembro, incluido solo lectura). Una hoja por tabla con nombres técnicos de columna. Es una copia legible, no sustituye al `pg_dump`.
- **Sesiones y Google en Supabase Auth**: Supabase → Authentication → Sessions (tiempo de vida y inactividad) y Providers (Google). Fije ahí el tiempo de vida de sesión según la política de la empresa; no se puede fijar desde el código de la aplicación (brief §16.3).
- **Dependencias**: `.github/dependabot.yml` abre propuestas semanales (npm y GitHub Actions); `npm run audit:deps` bloquea en el CI ante vulnerabilidades altas o críticas.