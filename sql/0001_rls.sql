-- Migración personalizada (drizzle-kit generate --custom --name=rls): claves a auth.users, funciones auxiliares, triggers, RLS y permisos.
alter table public.studies     add constraint studies_created_by_fk foreign key (created_by) references auth.users (id);
alter table public.memberships add constraint memberships_user_fk  foreign key (user_id)    references auth.users (id) on delete cascade;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Funciones SECURITY DEFINER: leen memberships sin recursión de RLS. search_path vacío evita secuestro de objetos.
create or replace function private.study_role(p_study uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid()) limit 1
$$;
create or replace function private.can_read(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.study_role(p_study) is not null $$;
create or replace function private.can_write(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.study_role(p_study) in ('owner','editor','analyst') $$;
create or replace function private.is_owner(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.study_role(p_study) = 'owner' $$;
create or replace function private.can_bootstrap(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studies s where s.id = p_study and s.created_by = (select auth.uid()))
     and not exists (select 1 from public.memberships m where m.study_id = p_study)
$$;
revoke all on function private.study_role(uuid), private.can_read(uuid), private.can_write(uuid), private.is_owner(uuid), private.can_bootstrap(uuid) from public;
grant execute on function private.study_role(uuid), private.can_read(uuid), private.can_write(uuid), private.is_owner(uuid), private.can_bootstrap(uuid) to authenticated;

-- Control de concurrencia optimista: cada UPDATE incrementa version y actualiza updated_at.
create or replace function private.touch_row() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.version := old.version + 1; return new; end $$;
do $$ declare t text; begin
  foreach t in array array['studies','study_parameters','positions','staffing_entries','activities','measurability_assessments','suitability_assessments','risk_assessments','improvement_opportunities','redesign_proposals','action_items','sheet_connections']
  loop execute format('create trigger %I before update on public.%I for each row execute function private.touch_row()', t || '_touch', t); end loop;
end $$;

-- RLS: estudios y membresías (reglas propias)
alter table public.studies enable row level security;     alter table public.studies force row level security;
alter table public.memberships enable row level security; alter table public.memberships force row level security;
create policy studies_select on public.studies for select to authenticated using (private.can_read(id) or created_by = (select auth.uid()));
create policy studies_insert on public.studies for insert to authenticated with check (created_by = (select auth.uid()));
create policy studies_update on public.studies for update to authenticated using (private.is_owner(id)) with check (private.is_owner(id));
create policy studies_delete on public.studies for delete to authenticated using (private.is_owner(id));
create policy memberships_select on public.memberships for select to authenticated using (user_id = (select auth.uid()) or private.is_owner(study_id));
create policy memberships_insert on public.memberships for insert to authenticated with check (private.is_owner(study_id) or (private.can_bootstrap(study_id) and user_id = (select auth.uid()) and role = 'owner'));
create policy memberships_update on public.memberships for update to authenticated using (private.is_owner(study_id)) with check (private.is_owner(study_id));
create policy memberships_delete on public.memberships for delete to authenticated using (private.is_owner(study_id));

-- RLS: tablas del estudio (lectura: cualquier miembro; escritura: owner, editor, analyst)
do $$ declare t text; begin
  foreach t in array array['study_parameters','areas','sites','positions','staffing_entries','activities','measurability_assessments','suitability_assessments','risk_assessments','improvement_opportunities','redesign_proposals','action_items','validation_issues','agent_runs','agent_proposals','study_snapshots','measurements','deviations','sheet_connections','sync_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_read(study_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_write(study_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_write(study_id)) with check (private.can_write(study_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_write(study_id))', t || '_delete', t);
  end loop;
end $$;

-- Auditoría: solo se agrega (sin UPDATE ni DELETE)
alter table public.audit_log enable row level security; alter table public.audit_log force row level security;
create policy audit_select on public.audit_log for select to authenticated using (private.can_read(study_id));
create policy audit_insert on public.audit_log for insert to authenticated with check (private.can_write(study_id) and actor_id = (select auth.uid()));

-- Privilegios mínimos
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update, delete on public.audit_log from authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
