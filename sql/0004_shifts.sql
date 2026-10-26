-- D-67: turnos del cargo y turnos de cada actividad. Mismas reglas de acceso que el resto de las tablas del estudio
-- (lectura: cualquier miembro; escritura: owner, editor, analyst). Se aplica DESPUÉS de drizzle/0004_position_shifts.sql.
do $$ declare t text; begin
  foreach t in array array['position_shifts','activity_shifts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_read(study_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_write(study_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_write(study_id)) with check (private.can_write(study_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_write(study_id))', t || '_delete', t);
  end loop;
end $$;
grant select, insert, update, delete on public.position_shifts, public.activity_shifts to authenticated;
revoke all on public.position_shifts, public.activity_shifts from anon;
