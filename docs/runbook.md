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
