-- Fase 8: sincronización con Google Sheets. Se aplica DESPUÉS de drizzle/0002_sheet_connections_actor.sql.
alter table public.sheet_connections
  add constraint sheet_connections_actor_fk foreign key (actor_id) references auth.users(id) on delete cascade;

-- El webhook de la hoja no tiene sesión de usuario: necesita ubicar la conexión por spreadsheet_id ANTES de saber en nombre de quién actúa.
-- Estas dos funciones SECURITY DEFINER devuelven solo lo mínimo (sin credenciales). Después, todo el trabajo corre con withRls() como el actor de la conexión.
create or replace function public.sheet_connection_lookup(p_spreadsheet_id text)
returns table (id uuid, study_id uuid, actor_id uuid, mode text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.study_id, c.actor_id, c.mode from public.sheet_connections c where c.spreadsheet_id = p_spreadsheet_id and c.mode <> 'off' limit 1
$$;
create or replace function public.sheet_connections_active()
returns table (id uuid, study_id uuid, actor_id uuid, spreadsheet_id text, mode text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.study_id, c.actor_id, c.spreadsheet_id, c.mode from public.sheet_connections c where c.mode <> 'off'
$$;
revoke all on function public.sheet_connection_lookup(text), public.sheet_connections_active() from public;
grant execute on function public.sheet_connection_lookup(text), public.sheet_connections_active() to app_user;
