-- D-104 · Orden de las tareas del Reparto semanal (tabla schedule_orders). Va DESPUÉS de drizzle/0016_orden_reparto.sql.
-- Es una preferencia de esa vista, no un dato del estudio: solo guarda códigos de actividad en orden. La ve quien tiene «Resultados» (Lectura o Edición) y la cambia quien lo tiene
-- en Edición; nadie fuera del estudio la ve. Quien escribe queda como autor (updated_by = su identidad: no se puede escribir a nombre de otra persona).
alter table public.schedule_orders enable row level security;
alter table public.schedule_orders force row level security;

drop policy if exists schedule_orders_select on public.schedule_orders;
drop policy if exists schedule_orders_insert on public.schedule_orders;
drop policy if exists schedule_orders_update on public.schedule_orders;
drop policy if exists schedule_orders_delete on public.schedule_orders;

create policy schedule_orders_select on public.schedule_orders for select to authenticated
  using (private.can_read_m(study_id, 'resultados'));
create policy schedule_orders_insert on public.schedule_orders for insert to authenticated
  with check (private.can_write_m(study_id, 'resultados') and updated_by = (select auth.uid()));
create policy schedule_orders_update on public.schedule_orders for update to authenticated
  using (private.can_write_m(study_id, 'resultados'))
  with check (private.can_write_m(study_id, 'resultados') and updated_by = (select auth.uid()));
create policy schedule_orders_delete on public.schedule_orders for delete to authenticated
  using (private.can_write_m(study_id, 'resultados'));

grant select, insert, update, delete on public.schedule_orders to authenticated;
