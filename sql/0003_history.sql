-- Fase 10: la foto semanal del tablero se toma sin sesión de usuario (Vercel Cron). Esta función segura entrega, por estudio, un propietario en cuyo nombre
-- se toma la foto; después todo corre con withRls() y la base sigue aplicando sus permisos. No devuelve datos del estudio.
create or replace function public.snapshot_targets()
returns table (study_id uuid, actor_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct on (m.study_id) m.study_id, m.user_id from public.memberships m where m.role = 'owner' order by m.study_id, m.created_at
$$;
revoke all on function public.snapshot_targets() from public;
grant execute on function public.snapshot_targets() to app_user;
