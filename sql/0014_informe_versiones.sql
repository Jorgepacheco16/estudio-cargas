-- D-106 · Versiones del informe de resultados (tabla report_versions). Va DESPUÉS de drizzle/0017_informe_versiones.sql.
-- La ve quien tiene «Resultados» (Lectura o Edición) y la crea, edita y aprueba quien lo tiene en Edición, y SOLO con acceso a todas las áreas: el texto resume todo el estudio, así
-- que una persona limitada a algunas áreas no lo lee (igual que el Agente de IA). Reglas que hace cumplir la base (no la pantalla):
--  · una versión nace como borrador, a nombre de quien la crea;
--  · un borrador se puede editar y se puede borrar; solo hay uno por estudio (índice único);
--  · aprobar es pasar el borrador a «approved», a nombre de quien aprueba; después NO se modifica ni se borra (salvo borrar el estudio entero);
--  · al aprobar otra, la anterior solo puede pasar a «superseded» sin cambiar nada más;
--  · una versión reemplazada no se modifica.
alter table public.report_versions enable row level security;
alter table public.report_versions force row level security;

drop policy if exists report_versions_select on public.report_versions;
drop policy if exists report_versions_insert on public.report_versions;
drop policy if exists report_versions_update on public.report_versions;
drop policy if exists report_versions_delete on public.report_versions;

create policy report_versions_select on public.report_versions for select to authenticated
  using (private.can_read_m(study_id, 'resultados') and private.all_areas(study_id));
create policy report_versions_insert on public.report_versions for insert to authenticated
  with check (private.can_write_m(study_id, 'resultados') and private.all_areas(study_id) and created_by = (select auth.uid()) and status = 'draft' and approved_by is null and approved_at is null);
create policy report_versions_update on public.report_versions for update to authenticated
  using (private.can_write_m(study_id, 'resultados') and private.all_areas(study_id))
  with check (private.can_write_m(study_id, 'resultados') and private.all_areas(study_id));
create policy report_versions_delete on public.report_versions for delete to authenticated
  using (private.can_write_m(study_id, 'resultados') and private.all_areas(study_id) and status = 'draft');

grant select, insert, update, delete on public.report_versions to authenticated;

create or replace function private.guard_report_versions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- un borrador se puede descartar; lo aprobado o reemplazado solo desaparece cuando se borra todo el estudio
    if old.status = 'draft' or not exists (select 1 from public.studies s where s.id = old.study_id) then return old; end if;
    raise exception 'Una versión aprobada del informe no se borra.' using errcode = '23514';
  end if;
  if new.id <> old.id or new.study_id <> old.study_id or new.number <> old.number or new.created_by <> old.created_by or new.created_at <> old.created_at or new.model <> old.model then
    raise exception 'El origen de una versión del informe no se modifica.' using errcode = '23514';
  end if;
  if old.status = 'superseded' then
    raise exception 'Una versión reemplazada del informe no se modifica.' using errcode = '23514';
  end if;
  if old.status = 'approved' then
    if new.status = 'superseded' and new.catalog = old.catalog and new.sections = old.sections and new.input_hash = old.input_hash
       and new.approved_by is not distinct from old.approved_by and new.approved_at is not distinct from old.approved_at and new.edited_at is not distinct from old.edited_at
       and new.input_tokens is not distinct from old.input_tokens and new.output_tokens is not distinct from old.output_tokens and new.base_number is not distinct from old.base_number then
      return new;
    end if;
    raise exception 'Una versión aprobada del informe no se modifica: cree una versión nueva.' using errcode = '23514';
  end if;
  -- borrador: sigue siendo borrador o se aprueba, y la aprobación queda a nombre de quien la hace
  if new.status = 'approved' then
    if new.approved_by is distinct from (select auth.uid()) or new.approved_at is null then
      raise exception 'La aprobación del informe debe quedar a nombre de quien la hace.' using errcode = '23514';
    end if;
  elsif new.status <> 'draft' then
    raise exception 'Un borrador solo puede seguir como borrador o aprobarse.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_report_versions() from public;

drop trigger if exists report_versions_guard on public.report_versions;
create trigger report_versions_guard before update or delete on public.report_versions for each row execute function private.guard_report_versions();
