-- D-94 · El Super usuario cambia la clave de otra persona. Va DESPUÉS de sql/0008_display_name.sql. No cambia tablas propias.
-- Se hace con funciones SEGURAS (SECURITY DEFINER), sin la llave de servicio de Supabase (regla 4). La aplicación genera una clave temporal y la CIFRA (bcrypt) antes de enviarla:
-- la base solo recibe el cifrado, así que la clave en texto nunca pasa por ella ni queda en sus registros. Quien llama debe ser Super usuario (módulo «usuarios» en Edición)
-- del estudio; la persona debe ser miembro de ese estudio, distinta de quien llama y tener clave propia (identidad de correo; quien entra solo con Google no la tiene).

-- ¿Quiénes del estudio tienen clave propia? Solo la ve quien administra usuarios. Sirve para mostrar el botón «Cambiar clave» solo donde corresponde.
create or replace function private.members_with_password(p_study uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.module_level(p_study, 'usuarios') <> 'edit' then return; end if;
  return query
    select m.user_id from public.memberships m
    where m.study_id = p_study and exists (select 1 from auth.identities i where i.user_id = m.user_id and i.provider = 'email');
end $$;
revoke all on function private.members_with_password(uuid) from public;
grant execute on function private.members_with_password(uuid) to authenticated;

create or replace function private.admin_set_password(p_study uuid, p_user uuid, p_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_member uuid;
begin
  if v_uid is null then raise exception 'Inicie sesión para cambiar una clave.' using errcode = '28000'; end if;
  if private.module_level(p_study, 'usuarios') <> 'edit' then raise exception 'Solo un Super usuario puede cambiar la clave de otra persona.' using errcode = '42501'; end if;
  if p_user = v_uid then raise exception 'Su propia clave se cambia en «Mi cuenta».' using errcode = 'P0001'; end if;
  select m.id into v_member from public.memberships m where m.study_id = p_study and m.user_id = p_user;
  if v_member is null then raise exception 'La persona ya no tiene acceso a este estudio.' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'email') then
    raise exception 'Esa persona entra con Google y no tiene clave en la aplicación.' using errcode = 'P0001';
  end if;
  if p_hash is null or p_hash !~ '^\$2[aby]\$(0[4-9]|[1-3][0-9])\$[./A-Za-z0-9]{53}$' then raise exception 'La clave no llegó cifrada correctamente.' using errcode = 'P0001'; end if;
  update auth.users set encrypted_password = p_hash, updated_at = now() where id = p_user;
  delete from auth.sessions where user_id = p_user; -- cierra las sesiones abiertas (en Supabase arrastra sus tokens de renovación)
  insert into public.audit_log (study_id, actor_id, origin, action, entity, entity_id, diff)
    values (p_study, v_uid, 'app', 'update', 'member_password_reset', v_member, jsonb_build_object('clave', jsonb_build_object('from', null, 'to', 'cambiada por un Super usuario')));
end $$;
revoke all on function private.admin_set_password(uuid, uuid, text) from public;
grant execute on function private.admin_set_password(uuid, uuid, text) to authenticated;
