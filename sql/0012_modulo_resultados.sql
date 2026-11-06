-- D-100 · Permiso del módulo «Resultados» (informe de resultados del estudio: Dotación requerida, Agente de IA y lo que siga). Va DESPUÉS de drizzle/0015_modulo_resultados.sql
-- (que agrega el valor 'resultados' al tipo app_module; un valor nuevo no se puede usar en la misma transacción que lo crea, por eso esta migración es aparte).
-- Por ahora «Resultados» es solo del Super usuario: el rol del sistema queda en Edición y todos los demás roles en Sin acceso. El Super usuario puede habilitarlo a otros
-- roles desde «Usuarios y roles». «Resultados» no protege tablas propias: lo que muestra sale de cargos y actividades, que ya tienen sus políticas.

-- (1) Roles que ya existen: el del sistema (Super usuario) en Edición; los demás, Sin acceso. Repetir la migración no pisa lo que ya se haya elegido.
insert into public.role_permissions (role_id, study_id, module, level)
select r.id, r.study_id, 'resultados', (case when r.is_system then 'edit' else 'none' end)::public.module_level
from public.roles r
where not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.module = 'resultados');

-- (2) Membresías heredadas (sin rol): el owner edita «Resultados»; editor, analyst y viewer no lo ven (mismas reglas que legacyPerms en src/server/access.ts).
create or replace function private.module_level(p_study uuid, p_module public.app_module) returns public.module_level
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when m.role_id is not null then coalesce((select rp.level from public.role_permissions rp where rp.role_id = m.role_id and rp.study_id = m.study_id and rp.module = p_module), 'none'::public.module_level)
      when m.role = 'owner' then 'edit'::public.module_level
      when m.role in ('editor', 'analyst') then (case when p_module in ('usuarios', 'resultados') then 'none' when p_module = 'estudio' then 'read' else 'edit' end)::public.module_level
      else (case when p_module in ('usuarios', 'resultados') then 'none' else 'read' end)::public.module_level
    end
    from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid()) limit 1
  ), 'none')
$$;
