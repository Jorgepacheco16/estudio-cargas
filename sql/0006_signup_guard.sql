-- D-91 · Solo pueden registrarse personas invitadas. Se aplica DESPUÉS de sql/0005_roles_rls.sql.
-- Un disparador sobre auth.users (Supabase) rechaza el alta de un correo que no tenga una invitación vigente, ya sea con clave o con Google; así nadie ajeno
-- puede abrir cuenta en el proyecto aunque conozca la dirección pública de Supabase. Las cuentas que ya existen no se tocan (solo actúa al INSERTAR).
-- Solo se crea si la tabla auth.users tiene la columna email (la base local de pruebas no la tiene).
create or replace function private.guard_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(to_jsonb(new) ->> 'email', '')));
begin
  if v_email = '' then return new; end if; -- cuentas sin correo (solo pruebas)
  if exists (select 1 from public.invitations i where i.email = v_email and i.used_at is null and i.expires_at > now()) then return new; end if;
  raise exception 'Solo pueden registrarse personas invitadas. Pida una invitación a quien administra la aplicación.' using errcode = 'P0001';
end $$;
revoke all on function private.guard_signup() from public;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email') then
    drop trigger if exists signup_guard on auth.users;
    create trigger signup_guard before insert on auth.users for each row execute function private.guard_signup();
  end if;
end $$;
