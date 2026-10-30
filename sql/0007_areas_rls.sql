-- D-92 · Restricción por áreas (etapa 2 de usuarios, roles y áreas). Va DESPUÉS de drizzle/0011_area_obligatoria.sql y de sql/0005_roles_rls.sql.
-- Una persona con «todas las áreas» ve y edita como antes; una persona con algunas áreas ve y edita solo los registros de esas áreas, en TODOS los módulos:
--  · por su propia área: áreas, cargos, oportunidades, rediseño y plan de acción (columna area_id);
--  · por el cargo: dotación, turnos del cargo y actividades; por la actividad: turnos de la actividad, evaluaciones (5, 6 y 7) y mediciones;
--  · lo que no pertenece a un área (fotos del estudio, desviaciones, agente de IA, auditoría y la conexión con Google) solo lo ve quien tiene todas las áreas.
-- Los centros de operaciones y los parámetros del estudio no son de un área: los ve cualquier miembro con acceso al módulo.

create or replace function private.all_areas(p_study uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid()) and m.all_areas)
$$;
create or replace function private.area_ok(p_study uuid, p_area uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.study_id = p_study and m.user_id = (select auth.uid())
    and (m.all_areas or exists (select 1 from public.member_areas ma where ma.study_id = m.study_id and ma.user_id = m.user_id and ma.area_id = p_area)))
$$;
create or replace function private.area_of_position(p_position uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select p.area_id from public.positions p where p.id = p_position $$;
create or replace function private.area_of_activity(p_activity uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.area_id from public.activities a join public.positions p on p.id = a.position_id where a.id = p_activity
$$;
revoke all on function private.all_areas(uuid), private.area_ok(uuid, uuid), private.area_of_position(uuid), private.area_of_activity(uuid) from public;
grant execute on function private.all_areas(uuid), private.area_ok(uuid, uuid), private.area_of_position(uuid), private.area_of_activity(uuid) to authenticated;

-- t = tabla; r = quién lee; i = quién inserta; w = quién actualiza y borra.
do $$ declare x record; t text; begin
  for x in select * from (values
    ('areas', 'private.can_read(study_id) and private.area_ok(study_id, id)', 'private.can_write_m(study_id, ''parametros'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''parametros'') and private.all_areas(study_id)'),
    ('positions', 'private.can_read_m(study_id, ''cargos'') and private.area_ok(study_id, area_id)',
       '(private.can_write_m(study_id, ''cargos'') or private.can_write_m(study_id, ''actividades'')) and private.area_ok(study_id, area_id)',
       'private.can_write_m(study_id, ''cargos'') and private.area_ok(study_id, area_id)'),
    ('staffing_entries', 'private.can_read_m(study_id, ''cargos'') and private.area_ok(study_id, private.area_of_position(position_id))', 'private.can_write_m(study_id, ''cargos'') and private.area_ok(study_id, private.area_of_position(position_id))', 'private.can_write_m(study_id, ''cargos'') and private.area_ok(study_id, private.area_of_position(position_id))'),
    ('position_shifts', 'private.can_read_m(study_id, ''cargos'') and private.area_ok(study_id, private.area_of_position(position_id))', 'private.can_write_m(study_id, ''cargos'') and private.area_ok(study_id, private.area_of_position(position_id))', 'private.can_write_m(study_id, ''cargos'') and private.area_ok(study_id, private.area_of_position(position_id))'),
    ('activities', 'private.can_read_m(study_id, ''actividades'') and private.area_ok(study_id, private.area_of_position(position_id))', 'private.can_write_m(study_id, ''actividades'') and private.area_ok(study_id, private.area_of_position(position_id))', 'private.can_write_m(study_id, ''actividades'') and private.area_ok(study_id, private.area_of_position(position_id))'),
    ('activity_shifts', 'private.can_read_m(study_id, ''actividades'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''actividades'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''actividades'') and private.area_ok(study_id, private.area_of_activity(activity_id))'),
    ('measurability_assessments', 'private.can_read_m(study_id, ''medibilidad'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''medibilidad'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''medibilidad'') and private.area_ok(study_id, private.area_of_activity(activity_id))'),
    ('suitability_assessments', 'private.can_read_m(study_id, ''pertinencia'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''pertinencia'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''pertinencia'') and private.area_ok(study_id, private.area_of_activity(activity_id))'),
    ('risk_assessments', 'private.can_read_m(study_id, ''riesgos'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''riesgos'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''riesgos'') and private.area_ok(study_id, private.area_of_activity(activity_id))'),
    ('improvement_opportunities', 'private.can_read_m(study_id, ''oportunidades'') and private.area_ok(study_id, area_id)', 'private.can_write_m(study_id, ''oportunidades'') and private.area_ok(study_id, area_id)', 'private.can_write_m(study_id, ''oportunidades'') and private.area_ok(study_id, area_id)'),
    ('redesign_proposals', 'private.can_read_m(study_id, ''rediseno'') and private.area_ok(study_id, area_id)', 'private.can_write_m(study_id, ''rediseno'') and private.area_ok(study_id, area_id)', 'private.can_write_m(study_id, ''rediseno'') and private.area_ok(study_id, area_id)'),
    ('action_items', 'private.can_read_m(study_id, ''plan'') and private.area_ok(study_id, area_id)', 'private.can_write_m(study_id, ''plan'') and private.area_ok(study_id, area_id)', 'private.can_write_m(study_id, ''plan'') and private.area_ok(study_id, area_id)'),
    ('measurements', 'private.can_read_m(study_id, ''historia'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''historia'') and private.area_ok(study_id, private.area_of_activity(activity_id))', 'private.can_write_m(study_id, ''historia'') and private.area_ok(study_id, private.area_of_activity(activity_id))'),
    ('study_snapshots', 'private.can_read_m(study_id, ''historia'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''historia'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''historia'') and private.all_areas(study_id)'),
    ('deviations', 'private.can_read_m(study_id, ''historia'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''historia'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''historia'') and private.all_areas(study_id)'),
    -- La conexión con Google la consulta cualquiera que edite (para que su cambio llegue a la hoja) y todos pueden dejar el evento de sincronización, con o sin áreas.
    ('sheet_connections', '(private.can_read_m(study_id, ''integraciones'') and private.all_areas(study_id)) or private.can_write(study_id)', 'private.can_write_m(study_id, ''integraciones'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''integraciones'') and private.all_areas(study_id)'),
    ('sync_events', 'private.can_read_m(study_id, ''integraciones'') and private.all_areas(study_id)', 'private.can_write(study_id)', 'private.can_write_m(study_id, ''integraciones'') and private.all_areas(study_id)'),
    ('validation_issues', 'private.can_read_m(study_id, ''integraciones'') and private.all_areas(study_id)', 'private.can_write(study_id)', 'private.can_write_m(study_id, ''integraciones'') and private.all_areas(study_id)'),
    ('agent_runs', 'private.can_read_m(study_id, ''agente'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''agente'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''agente'') and private.all_areas(study_id)'),
    ('agent_proposals', 'private.can_read_m(study_id, ''agente'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''agente'') and private.all_areas(study_id)', 'private.can_write_m(study_id, ''agente'') and private.all_areas(study_id)')
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

-- Auditoría: la lee quien tiene Historia o Usuarios y todas las áreas (el registro mezcla todas las áreas); la escribe cualquiera que edite, a su nombre.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using ((private.can_read_m(study_id, 'historia') or private.can_read_m(study_id, 'usuarios')) and private.all_areas(study_id));
