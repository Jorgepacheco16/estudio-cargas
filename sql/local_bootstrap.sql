-- SOLO PARA PRUEBAS LOCALES: imita lo que Supabase ya trae (roles, esquema auth, auth.uid()).
create role anon nologin; create role authenticated nologin;
create role app_user login password 'app_pw' nobypassrls nosuperuser noinherit; -- NOINHERIT: sin permisos propios; solo opera vía SET LOCAL ROLE
grant anon, authenticated to app_user;
create schema auth; create table auth.users (id uuid primary key, encrypted_password text, updated_at timestamptz);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, provider text not null);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
