-- D-95 · Permiso del módulo «Estudio» (crear estudios nuevos). Va DESPUÉS de drizzle/0013_modulo_estudio.sql (que agrega el valor 'estudio' al tipo app_module; un valor nuevo
-- no se puede usar en la misma transacción que lo crea, por eso esta migración es aparte).
-- Antes cualquier persona con sesión podía crear estudios. Ahora hace falta Edición en «Estudio»; con Lectura se ve la ventana y se cambia de estudio.

-- (1) Roles que ya existen: el del sistema (Super usuario) queda en Edición; los demás, en Lectura (siguen viendo la ventana y cambiando de estudio, pero ya no crean).
insert into public.role_permissions (role_id, study_id, module, level)
select r.id, r.study_id, 'estudio', (case when r.is_system then 'edit' else 'read' end)::public.module_level
from public.roles r
where not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.module = 'estudio');

-- (2) Membresías heredadas (sin rol): owner edita; editor, analyst y viewer solo leen «Estudio».
create or replace function private.module_level(p_study uuid, p_module public.app_module) returns public.module_level
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when m.role_id is not null then coalesce((select rp.level from public.role_permissions rp where rp.role_id = m.role_id and rp.study_id = m.study_id and rp.module = p_module), 'none'::public.module_level)
      when m.role = 'owner' then 'edit'::public.module_level
      when m.role in ('editor', 'analyst') then (case when p_module = 'usuarios' then 'none' when p_module = 'estudio' then 'read' else 'edit' end)::public.module_level
      else (case when p_module = 'usuarios' then 'none' else 'read' end)::public.module_level
    end
    from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid()) limit 1
  ), 'none')
$$;

-- (3) Crear un estudio lo decide la base de datos, no la pantalla: hace falta Edición en «Estudio» en alguno de los estudios de la persona.
-- Quien aún no pertenece a ningún estudio (primer ingreso) puede crear el primero.
create or replace function private.can_create_study() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.memberships m where m.user_id = (select auth.uid()))
      or exists (select 1 from public.memberships m where m.user_id = (select auth.uid()) and private.module_level(m.study_id, 'estudio') = 'edit')
$$;
revoke all on function private.can_create_study() from public;
grant execute on function private.can_create_study() to authenticated;

drop policy if exists studies_insert on public.studies;
create policy studies_insert on public.studies for insert to authenticated with check (created_by = (select auth.uid()) and private.can_create_study());
