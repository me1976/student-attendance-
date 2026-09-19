-- One transaction; existing tables, policies and historical class snapshots stay intact.
create or replace function public.save_class_attendance(
  p_class_name text,
  p_date date,
  p_absent_ids bigint[],
  p_roster_ids bigint[] default null,
  p_expected_absent_ids bigint[] default null
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  current_roster bigint[];
  current_absent bigint[];
  requested_absent bigint[];
begin
  if p_class_name is null or btrim(p_class_name) = '' or p_date is null or p_absent_ids is null then
    raise exception 'Invalid attendance input' using errcode = '22023';
  end if;
  -- Serialize saves for the same school day, including students transferred that day.
  perform pg_catalog.pg_advisory_xact_lock(81270, p_date - date '2000-01-01');
  lock table public.students in share mode;
  select coalesce(array_agg(id order by id), '{}'::bigint[]) into current_roster
    from public.students where active and class_name = p_class_name;
  select coalesce(array_agg(distinct id order by id), '{}'::bigint[]) into requested_absent
    from unnest(p_absent_ids) as ids(id);
  if exists(select 1 from unnest(p_absent_ids) as ids(id) where id is null)
    or not requested_absent <@ current_roster then
    raise exception 'Students changed; reload the class' using errcode = '40001';
  end if;
  if p_roster_ids is not null and current_roster is distinct from
    array(select distinct id from unnest(p_roster_ids) as ids(id) order by id) then
    raise exception 'Students changed; reload the class' using errcode = '40001';
  end if;
  select coalesce(array_agg(student_id order by student_id), '{}'::bigint[]) into current_absent
    from public.attendance where attendance_date = p_date and student_id = any(current_roster);
  if p_expected_absent_ids is not null and current_absent is distinct from
    array(select distinct id from unnest(p_expected_absent_ids) as ids(id) order by id) then
    raise exception 'Attendance changed; reload the class' using errcode = '40001';
  end if;
  -- A moved/removed student's historical rows must never be deleted by an old class save.
  delete from public.attendance
    where attendance_date = p_date and class_name = p_class_name
      and student_id = any(current_roster) and not (student_id = any(requested_absent));
  insert into public.attendance(student_id, attendance_date, class_name, status)
    select id, p_date, p_class_name, 'absent' from unnest(requested_absent) as ids(id)
    on conflict (student_id, attendance_date) do nothing;
  return (select count(*)::integer from public.attendance
    where attendance_date = p_date and student_id = any(current_roster));
end;
$$;
revoke all on function public.save_class_attendance(text,date,bigint[],bigint[],bigint[]) from public, anon, authenticated;
grant execute on function public.save_class_attendance(text,date,bigint[],bigint[],bigint[]) to service_role;
