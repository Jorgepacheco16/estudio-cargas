-- D-93 · Nombre de cada persona. Va DESPUÉS de drizzle/0012_nombre_cuenta.sql.
-- La persona escribe el nombre con el que quiere verse en la aplicación. Solo puede cambiar el SUYO (la política de memberships solo deja actualizar a quien administra),
-- por eso se hace con esta función segura, que además limpia espacios, rechaza textos demasiado largos o con caracteres de control y deja constancia en la auditoría.
create or replace function private.set_display_name(p_study uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''); v_old text; v_id uuid;
begin
  if v_uid is null then raise exception 'Inicie sesión para cambiar su nombre.' using errcode = '28000'; end if;
  if v_name is not null and (char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]') then raise exception 'El nombre admite hasta 80 caracteres y no puede tener caracteres de control.' using errcode = 'P0001'; end if;
  select m.id, m.display_name into v_id, v_old from public.memberships m where m.study_id = p_study and m.user_id = v_uid;
  if v_id is null then raise exception 'No tiene acceso a este estudio.' using errcode = 'P0001'; end if;
  if v_old is not distinct from v_name then return; end if;
  update public.memberships set display_name = v_name where id = v_id;
  insert into public.audit_log (study_id, actor_id, origin, action, entity, entity_id, diff)
    values (p_study, v_uid, 'app', 'update', 'membership_name', v_id, jsonb_build_object('nombre', jsonb_build_object('from', v_old, 'to', v_name)));
end $$;
revoke all on function private.set_display_name(uuid, text) from public;
grant execute on function private.set_display_name(uuid, text) to authenticated;
