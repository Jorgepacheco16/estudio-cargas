-- D-96 · Registro de cambios (pestaña de Historia). Va DESPUÉS de drizzle/0014_registro_cambios.sql (columnas actor_name, actor_email, area_name, position_name y subject de audit_log).
-- (1) Un disparador llena, en cada cambio nuevo, QUIÉN lo hizo y SOBRE QUÉ ESTABA (área, cargo y registro) tal como eran en ese momento: así siguen ahí aunque la persona pierda
--     el acceso o el registro se elimine. Si algo no se puede resolver, queda vacío: el registro de cambios NUNCA impide el cambio que se está guardando.
-- (2) Lo ya registrado se completa con la mejor información disponible (lo eliminado antes de esta migración no guardó qué era y queda sin área ni cargo).
-- (3) El registro es de SOLO CONSULTA: nadie puede modificar ni borrar una fila (ni siquiera quien administra); solo desaparece junto con todo el estudio.

create or replace function private.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return p::uuid; exception when others then return null; end $$;

-- Área, cargo y registro de un cambio. Para insertar y modificar se mira el registro (que existe); para eliminar, los datos que quedaron en el cambio (diff.campo.from).
create or replace function private.audit_context(p_study uuid, p_entity text, p_id uuid, p_diff jsonb, out o_area text, out o_position text, out o_subject text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pos uuid; v_act uuid; v_area uuid; v_pos_name text; v_code text; v_name text; v_emp text;
  d_from constant jsonb := coalesce(p_diff, '{}'::jsonb);
begin
  case p_entity
    when 'staffing' then
      select s.position_id, s.employee_code into v_pos, v_emp from public.staffing_entries s where s.id = p_id and s.study_id = p_study;
      if not found then v_pos := private.try_uuid(d_from -> 'positionId' ->> 'from'); v_emp := d_from -> 'employeeCode' ->> 'from'; end if;
      o_subject := v_emp;
    when 'activity', 'measurability', 'suitability', 'risk', 'measurement', 'activity_shifts' then
      if p_entity = 'activity' then v_act := p_id;
      elsif p_entity = 'activity_shifts' then v_act := p_id;
      elsif p_entity = 'measurability' then select t.activity_id into v_act from public.measurability_assessments t where t.id = p_id and t.study_id = p_study;
      elsif p_entity = 'suitability' then select t.activity_id into v_act from public.suitability_assessments t where t.id = p_id and t.study_id = p_study;
      elsif p_entity = 'risk' then select t.activity_id into v_act from public.risk_assessments t where t.id = p_id and t.study_id = p_study;
      else select t.activity_id into v_act from public.measurements t where t.id = p_id and t.study_id = p_study;
      end if;
      if v_act is null then v_act := private.try_uuid(d_from -> 'activityId' ->> 'from'); end if;
      select a.position_id, a.code, a.name into v_pos, v_code, v_name from public.activities a where a.id = v_act and a.study_id = p_study;
      if not found then
        v_pos := private.try_uuid(d_from -> 'positionId' ->> 'from'); v_code := d_from -> 'code' ->> 'from'; v_name := d_from -> 'name' ->> 'from';
      end if;
      o_subject := case when p_entity = 'activity' and v_name is not null then concat_ws(' · ', v_code, v_name) else v_code end;
    when 'opportunity' then
      select t.area_id, t.position_name, t.code into v_area, v_pos_name, v_code from public.improvement_opportunities t where t.id = p_id and t.study_id = p_study;
      if not found then v_area := private.try_uuid(d_from -> 'areaId' ->> 'from'); v_pos_name := d_from -> 'positionName' ->> 'from'; v_code := d_from -> 'code' ->> 'from'; end if;
      o_subject := v_code;
    when 'action' then
      select t.area_id, t.position_name, t.code into v_area, v_pos_name, v_code from public.action_items t where t.id = p_id and t.study_id = p_study;
      if not found then v_area := private.try_uuid(d_from -> 'areaId' ->> 'from'); v_pos_name := d_from -> 'positionName' ->> 'from'; v_code := d_from -> 'code' ->> 'from'; end if;
      o_subject := v_code;
    when 'redesign' then
      select t.area_id, t.current_position_name, t.code into v_area, v_pos_name, v_code from public.redesign_proposals t where t.id = p_id and t.study_id = p_study;
      if not found then v_area := private.try_uuid(d_from -> 'areaId' ->> 'from'); v_pos_name := d_from -> 'currentPositionName' ->> 'from'; v_code := d_from -> 'code' ->> 'from'; end if;
      o_subject := v_code;
    when 'position_operation', 'position_shift_type' then
      v_pos := p_id;
    when 'position_shift' then
      select s.position_id, s.name into v_pos, v_name from public.position_shifts s where s.id = p_id and s.study_id = p_study;
      if not found then v_pos := private.try_uuid(d_from -> 'positionId' ->> 'from'); v_name := d_from -> 'name' ->> 'from'; end if;
      o_subject := v_name;
    when 'parameters' then
      o_subject := 'Parámetros de cálculo';
    when 'membership', 'membership_name', 'member_password_reset' then
      select coalesce(m.display_name, m.email) into o_subject from public.memberships m where m.id = p_id and m.study_id = p_study;
    when 'invitation', 'invitation_accepted' then
      select i.email into o_subject from public.invitations i where i.id = p_id and i.study_id = p_study;
    when 'role' then
      select r.name into o_subject from public.roles r where r.id = p_id and r.study_id = p_study;
      if o_subject is null then o_subject := d_from -> 'name' ->> 'to'; end if;
    when 'snapshot' then
      o_subject := d_from -> 'label' ->> 'to';
    else null;
  end case;
  if v_pos is not null then
    select p.name, a.name into o_position, o_area from public.positions p join public.areas a on a.id = p.area_id and a.study_id = p.study_id where p.id = v_pos and p.study_id = p_study;
  end if;
  if v_area is not null then select a.name into o_area from public.areas a where a.id = v_area and a.study_id = p_study; end if;
  if o_position is null then o_position := v_pos_name; end if;
exception when others then
  o_area := null; o_position := null; o_subject := null;
end $$;
revoke all on function private.audit_context(uuid, text, uuid, jsonb) from public;

create or replace function private.audit_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  begin
    if new.actor_id is not null and new.actor_name is null and new.actor_email is null then
      select m.display_name, m.email into new.actor_name, new.actor_email from public.memberships m where m.study_id = new.study_id and m.user_id = new.actor_id;
    end if;
    if new.area_name is null and new.position_name is null and new.subject is null then
      select * into c from private.audit_context(new.study_id, new.entity, new.entity_id, new.diff);
      new.area_name := c.o_area; new.position_name := c.o_position; new.subject := c.o_subject;
    end if;
  exception when others then null; -- el registro de cambios nunca impide el cambio que se guarda
  end;
  return new;
end $$;
revoke all on function private.audit_fill() from public;
drop trigger if exists audit_log_fill on public.audit_log;
create trigger audit_log_fill before insert on public.audit_log for each row execute function private.audit_fill();

-- (2) Relleno de lo ya registrado (se quita la protección un momento y se vuelve a poner; esta migración se puede repetir).
drop trigger if exists audit_log_immutable on public.audit_log;
update public.audit_log a set actor_name = m.display_name, actor_email = m.email
from public.memberships m
where m.study_id = a.study_id and m.user_id = a.actor_id and a.actor_name is null and a.actor_email is null;
update public.audit_log a set (area_name, position_name, subject) =
  (select c.o_area, c.o_position, c.o_subject from private.audit_context(a.study_id, a.entity, a.entity_id, a.diff) c)
where a.area_name is null and a.position_name is null and a.subject is null;

-- (3) Solo consulta: ni modificar ni borrar (salvo cuando se borra todo el estudio, que arrastra su registro).
create or replace function private.guard_audit_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.studies s where s.id = old.study_id) then return old; end if;
  raise exception 'El registro de cambios es de solo consulta: no se puede modificar ni borrar.' using errcode = '23514';
end $$;
revoke all on function private.guard_audit_log() from public;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function private.guard_audit_log();

create index if not exists audit_study_id_idx on public.audit_log (study_id, id desc);
