-- D-91 · Roles y permisos por módulo (migración personalizada; va DESPUÉS de drizzle/0010_roles_usuarios.sql).
-- Cada persona tiene un rol (role_id) con un nivel por módulo: none, read o edit. Sin role_id (membresías heredadas o creadas a mano) los permisos salen
-- del rol heredado: owner = edita todo; editor y analyst = editan todo menos «usuarios»; viewer = lee todo menos «usuarios».

-- ───────── Funciones de permisos (SECURITY DEFINER, search_path vacío, como las anteriores) ─────────
create or replace function private.module_level(p_study uuid, p_module public.app_module) returns public.module_level
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when m.role_id is not null then coalesce((select rp.level from public.role_permissions rp where rp.role_id = m.role_id and rp.study_id = m.study_id and rp.module = p_module), 'none'::public.module_level)
      when m.role = 'owner' then 'edit'::public.module_level
      when m.role in ('editor', 'analyst') then (case when p_module = 'usuarios' then 'none' else 'edit' end)::public.module_level
      else (case when p_module = 'usuarios' then 'none' else 'read' end)::public.module_level
    end
    from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid()) limit 1
  ), 'none')
$$;
create or replace function private.can_read_m(p_study uuid, p_module public.app_module) returns boolean
language sql stable security definer set search_path = '' as $$ select private.module_level(p_study, p_module) in ('read', 'edit') $$;
create or replace function private.can_write_m(p_study uuid, p_module public.app_module) returns boolean
language sql stable security definer set search_path = '' as $$ select private.module_level(p_study, p_module) = 'edit' $$;

-- Miembro con algún acceso / con alguna edición (se redefinen can_read, can_write e is_owner: el resto de funciones y políticas siguen funcionando).
create or replace function private.can_read(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid())
    and (m.role_id is null or exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.study_id = m.study_id and rp.level <> 'none')))
$$;
create or replace function private.can_write(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid())
    and ((m.role_id is null and m.role in ('owner', 'editor', 'analyst'))
      or (m.role_id is not null and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.study_id = m.study_id and rp.level = 'edit'))))
$$;
-- Administra el estudio (usuarios, roles, invitaciones): solo quien edita el módulo «usuarios» (el Super usuario).
create or replace function private.is_owner(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.module_level(p_study, 'usuarios') = 'edit' $$;
revoke all on function private.module_level(uuid, public.app_module), private.can_read_m(uuid, public.app_module), private.can_write_m(uuid, public.app_module) from public;
grant execute on function private.module_level(uuid, public.app_module), private.can_read_m(uuid, public.app_module), private.can_write_m(uuid, public.app_module) to authenticated;

-- ───────── Roles iniciales de los estudios que ya existen ─────────
-- «Super usuario» (del sistema: todo en Edición y administra usuarios), «Editor» (todo en Edición salvo usuarios) y «Lector» (todo en Lectura salvo usuarios).
do $$ declare s record; v_super uuid; v_editor uuid; v_reader uuid; m text; begin
  for s in select id from public.studies loop
    insert into public.roles (study_id, name, is_system) values (s.id, 'Super usuario', true) on conflict (study_id, name) do nothing;
    insert into public.roles (study_id, name, is_system) values (s.id, 'Editor', false) on conflict (study_id, name) do nothing;
    insert into public.roles (study_id, name, is_system) values (s.id, 'Lector', false) on conflict (study_id, name) do nothing;
    select id into v_super from public.roles where study_id = s.id and name = 'Super usuario';
    select id into v_editor from public.roles where study_id = s.id and name = 'Editor';
    select id into v_reader from public.roles where study_id = s.id and name = 'Lector';
    foreach m in array enum_range(null::public.app_module)::text[] loop
      insert into public.role_permissions (role_id, study_id, module, level) values
        (v_super, s.id, m::public.app_module, 'edit'),
        (v_editor, s.id, m::public.app_module, case when m = 'usuarios' then 'none' else 'edit' end::public.module_level),
        (v_reader, s.id, m::public.app_module, case when m = 'usuarios' then 'none' else 'read' end::public.module_level)
      on conflict (role_id, module) do nothing;
    end loop;
    update public.memberships set role_id = case role when 'owner' then v_super when 'viewer' then v_reader else v_editor end where study_id = s.id and role_id is null;
  end loop;
end $$;

-- ───────── Protecciones ─────────
-- (1) Los roles del sistema no se modifican ni se borran (salvo cuando se borra todo el estudio).
create or replace function private.guard_system_role() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.studies s where s.id = old.study_id) then return old; end if;
  if old.is_system then raise exception 'El rol «%» es del sistema: no se puede modificar ni borrar.', old.name using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and new.is_system then raise exception 'Un rol nuevo no puede ser del sistema.' using errcode = '23514'; end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
create trigger roles_guard before update or delete on public.roles for each row execute function private.guard_system_role();

-- (2) Los permisos de un rol del sistema no cambian; y solo el Super usuario (rol del sistema) puede administrar usuarios.
create or replace function private.guard_role_permissions() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old_system boolean := false; v_new_system boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' and not exists (select 1 from public.studies s where s.id = old.study_id) then return old; end if; -- se borra todo el estudio
    select coalesce((select r.is_system from public.roles r where r.id = old.role_id), false) into v_old_system;
    if v_old_system then raise exception 'Los permisos de un rol del sistema no se pueden cambiar.' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select coalesce((select r.is_system from public.roles r where r.id = new.role_id), false) into v_new_system;
  if new.module = 'usuarios' and new.level <> 'none' and not v_new_system then
    raise exception 'Solo el rol Super usuario puede administrar usuarios y roles.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions for each row execute function private.guard_role_permissions();

-- (3) Siempre debe quedar al menos un Super usuario en el estudio.
create or replace function private.row_is_admin(p_role_id uuid, p_role public.app_role, p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_role_id is not null
    then exists (select 1 from public.role_permissions rp where rp.role_id = p_role_id and rp.study_id = p_study and rp.module = 'usuarios' and rp.level = 'edit')
    else p_role = 'owner' end
$$;
create or replace function private.guard_last_admin() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_other int;
begin
  if not exists (select 1 from public.studies s where s.id = old.study_id) then return case tg_op when 'DELETE' then old else new end; end if;
  if not private.row_is_admin(old.role_id, old.role, old.study_id) then return case tg_op when 'DELETE' then old else new end; end if;
  if tg_op = 'UPDATE' and private.row_is_admin(new.role_id, new.role, new.study_id) then return new; end if;
  select count(*) into v_other from public.memberships m where m.study_id = old.study_id and m.id <> old.id and private.row_is_admin(m.role_id, m.role, m.study_id);
  if v_other = 0 then raise exception 'Debe quedar al menos un Super usuario en el estudio.' using errcode = '23514'; end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
create trigger memberships_guard_last_admin before update or delete on public.memberships for each row execute function private.guard_last_admin();

-- ───────── Políticas: se reemplazan por las que miran el módulo ─────────
-- t = tabla; r = quién lee; i = quién inserta; w = quién actualiza y borra. (study_id es la columna del estudio en todas.)
do $$ declare x record; t text; begin
  for x in select * from (values
    ('study_parameters',             'private.can_read_m(study_id, ''parametros'')',     'private.can_write_m(study_id, ''parametros'')',                                                  'private.can_write_m(study_id, ''parametros'')'),
    ('areas',                        'private.can_read(study_id)',                       'private.can_write_m(study_id, ''parametros'')',                                                  'private.can_write_m(study_id, ''parametros'')'),
    ('sites',                        'private.can_read(study_id)',                       '(private.can_write_m(study_id, ''cargos'') or private.can_write_m(study_id, ''actividades''))', 'private.can_write_m(study_id, ''cargos'')'),
    ('positions',                    'private.can_read_m(study_id, ''cargos'')',         '(private.can_write_m(study_id, ''cargos'') or private.can_write_m(study_id, ''actividades''))', 'private.can_write_m(study_id, ''cargos'')'),
    ('staffing_entries',             'private.can_read_m(study_id, ''cargos'')',         'private.can_write_m(study_id, ''cargos'')',                                                      'private.can_write_m(study_id, ''cargos'')'),
    ('position_shifts',              'private.can_read_m(study_id, ''cargos'')',         'private.can_write_m(study_id, ''cargos'')',                                                      'private.can_write_m(study_id, ''cargos'')'),
    ('activities',                   'private.can_read_m(study_id, ''actividades'')',    'private.can_write_m(study_id, ''actividades'')',                                                 'private.can_write_m(study_id, ''actividades'')'),
    ('activity_shifts',              'private.can_read_m(study_id, ''actividades'')',    'private.can_write_m(study_id, ''actividades'')',                                                 'private.can_write_m(study_id, ''actividades'')'),
    ('measurability_assessments',    'private.can_read_m(study_id, ''medibilidad'')',    'private.can_write_m(study_id, ''medibilidad'')',                                                 'private.can_write_m(study_id, ''medibilidad'')'),
    ('suitability_assessments',      'private.can_read_m(study_id, ''pertinencia'')',    'private.can_write_m(study_id, ''pertinencia'')',                                                 'private.can_write_m(study_id, ''pertinencia'')'),
    ('risk_assessments',             'private.can_read_m(study_id, ''riesgos'')',        'private.can_write_m(study_id, ''riesgos'')',                                                     'private.can_write_m(study_id, ''riesgos'')'),
    ('improvement_opportunities',    'private.can_read_m(study_id, ''oportunidades'')',  'private.can_write_m(study_id, ''oportunidades'')',                                               'private.can_write_m(study_id, ''oportunidades'')'),
    ('redesign_proposals',           'private.can_read_m(study_id, ''rediseno'')',       'private.can_write_m(study_id, ''rediseno'')',                                                    'private.can_write_m(study_id, ''rediseno'')'),
    ('action_items',                 'private.can_read_m(study_id, ''plan'')',           'private.can_write_m(study_id, ''plan'')',                                                        'private.can_write_m(study_id, ''plan'')'),
    ('study_snapshots',              'private.can_read_m(study_id, ''historia'')',       'private.can_write_m(study_id, ''historia'')',                                                    'private.can_write_m(study_id, ''historia'')'),
    ('measurements',                 'private.can_read_m(study_id, ''historia'')',       'private.can_write_m(study_id, ''historia'')',                                                    'private.can_write_m(study_id, ''historia'')'),
    ('deviations',                   'private.can_read_m(study_id, ''historia'')',       'private.can_write_m(study_id, ''historia'')',                                                    'private.can_write_m(study_id, ''historia'')'),
    -- Quien edita cualquier módulo debe poder consultar la conexión con Google (para que su cambio llegue a la hoja) y dejar el evento de sincronización.
    ('sheet_connections',            '(private.can_read_m(study_id, ''integraciones'') or private.can_write(study_id))', 'private.can_write_m(study_id, ''integraciones'')',       'private.can_write_m(study_id, ''integraciones'')'),
    ('sync_events',                  'private.can_read_m(study_id, ''integraciones'')',  'private.can_write(study_id)',                                                                    'private.can_write_m(study_id, ''integraciones'')'),
    ('validation_issues',            'private.can_read_m(study_id, ''integraciones'')',  'private.can_write(study_id)',                                                                    'private.can_write_m(study_id, ''integraciones'')'),
    ('agent_runs',                   'private.can_read_m(study_id, ''agente'')',         'private.can_write_m(study_id, ''agente'')',                                                      'private.can_write_m(study_id, ''agente'')'),
    ('agent_proposals',              'private.can_read_m(study_id, ''agente'')',         'private.can_write_m(study_id, ''agente'')',                                                      'private.can_write_m(study_id, ''agente'')')
  ) as v(t, r, i, w) loop
    t := x.t;
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, x.r);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, x.i);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update', t, x.w, x.w);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete', t, x.w);
  end loop;
end $$;

-- Auditoría: se lee con Historia o con Usuarios; se agrega con cualquier edición (y solo a nombre propio).
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (private.can_read_m(study_id, 'historia') or private.can_read_m(study_id, 'usuarios'));

-- ───────── Tablas nuevas: roles, permisos, áreas de cada persona e invitaciones (todo lo administra el Super usuario) ─────────
do $$ declare t text; begin
  foreach t in array array['roles', 'role_permissions', 'member_areas', 'invitations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;
-- Todo miembro lee los roles y sus permisos (para conocer los suyos); solo quien administra los escribe. Al crear un estudio, su creador siembra los suyos.
create policy roles_select on public.roles for select to authenticated using (private.can_read(study_id));
create policy roles_insert on public.roles for insert to authenticated with check (private.is_owner(study_id) or private.can_bootstrap(study_id));
create policy roles_update on public.roles for update to authenticated using (private.is_owner(study_id)) with check (private.is_owner(study_id));
create policy roles_delete on public.roles for delete to authenticated using (private.is_owner(study_id));
create policy role_permissions_select on public.role_permissions for select to authenticated using (private.can_read(study_id));
create policy role_permissions_insert on public.role_permissions for insert to authenticated with check (private.is_owner(study_id) or private.can_bootstrap(study_id));
create policy role_permissions_update on public.role_permissions for update to authenticated using (private.is_owner(study_id)) with check (private.is_owner(study_id));
create policy role_permissions_delete on public.role_permissions for delete to authenticated using (private.is_owner(study_id));
create policy member_areas_select on public.member_areas for select to authenticated using (user_id = (select auth.uid()) or private.is_owner(study_id));
create policy member_areas_insert on public.member_areas for insert to authenticated with check (private.is_owner(study_id));
create policy member_areas_update on public.member_areas for update to authenticated using (private.is_owner(study_id)) with check (private.is_owner(study_id));
create policy member_areas_delete on public.member_areas for delete to authenticated using (private.is_owner(study_id));
create policy invitations_select on public.invitations for select to authenticated using (private.is_owner(study_id));
create policy invitations_insert on public.invitations for insert to authenticated with check (private.is_owner(study_id) and created_by = (select auth.uid()));
create policy invitations_update on public.invitations for update to authenticated using (private.is_owner(study_id)) with check (private.is_owner(study_id));
create policy invitations_delete on public.invitations for delete to authenticated using (private.is_owner(study_id));
grant select, insert, update, delete on public.roles, public.role_permissions, public.member_areas, public.invitations to authenticated;

-- ───────── Aceptar una invitación ─────────
-- La persona acaba de crear su cuenta (o entró con Google): esta función comprueba que el correo de su sesión es el invitado y que el enlace sirve y no venció,
-- y crea su membresía con el rol y las áreas de la invitación. SECURITY DEFINER: así no hace falta la llave de servicio ni abrir la tabla de invitaciones.
create or replace function private.redeem_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')));
  inv public.invitations; v_super boolean;
begin
  if v_uid is null then raise exception 'Inicie sesión para aceptar la invitación.' using errcode = '28000'; end if;
  select * into inv from public.invitations where token_hash = p_token_hash for update;
  if not found or inv.used_at is not null or inv.expires_at <= now() then raise exception 'La invitación no es válida, ya se usó o venció.' using errcode = 'P0001'; end if;
  if v_email = '' or v_email <> inv.email then raise exception 'Esta invitación es para otro correo.' using errcode = 'P0001'; end if;
  select exists (select 1 from public.role_permissions rp where rp.role_id = inv.role_id and rp.study_id = inv.study_id and rp.module = 'usuarios' and rp.level = 'edit') into v_super;
  insert into public.memberships (study_id, user_id, role, role_id, all_areas, email)
    values (inv.study_id, v_uid, (case when v_super then 'owner' else 'editor' end)::public.app_role, inv.role_id, inv.all_areas, inv.email)
    on conflict (study_id, user_id) do update set role_id = excluded.role_id, all_areas = excluded.all_areas, role = excluded.role, email = excluded.email;
  delete from public.member_areas where study_id = inv.study_id and user_id = v_uid;
  if not inv.all_areas then
    insert into public.member_areas (study_id, user_id, area_id)
      select inv.study_id, v_uid, a from unnest(inv.area_ids) as a where exists (select 1 from public.areas ar where ar.id = a and ar.study_id = inv.study_id);
  end if;
  update public.invitations set used_at = now(), used_by = v_uid where id = inv.id;
  insert into public.audit_log (study_id, actor_id, origin, action, entity, entity_id, diff)
    values (inv.study_id, v_uid, 'app', 'insert', 'invitation_accepted', inv.id, jsonb_build_object('email', jsonb_build_object('from', null, 'to', inv.email)));
  return inv.study_id;
end $$;
revoke all on function private.redeem_invitation(text) from public;
grant execute on function private.redeem_invitation(text) to authenticated;

-- La persona que abre el enlace todavía no tiene sesión: necesita ver para qué correo es la invitación ANTES de crear su clave. Esta función devuelve solo lo mínimo
-- (correo, rol, estudio y si sirve), nunca el hash ni las áreas, y solo la usa el servidor de la aplicación (como sheet_connection_lookup).
create or replace function public.invitation_lookup(p_token_hash text)
returns table (email text, role_name text, study_name text, valid boolean)
language sql stable security definer set search_path = '' as $$
  select i.email, r.name, s.name, (i.used_at is null and i.expires_at > now())
  from public.invitations i join public.roles r on r.id = i.role_id and r.study_id = i.study_id join public.studies s on s.id = i.study_id
  where i.token_hash = p_token_hash
$$;
revoke all on function public.invitation_lookup(text) from public;
grant execute on function public.invitation_lookup(text) to app_user;
