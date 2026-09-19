-- Run in the SQL editor. Everything, including fixtures, is rolled back.
begin;
do $$
declare
  test_id bigint;
  result integer;
begin
  insert into public.students(name,class_name) values ('attendance regression fixture','__test أ') returning id into test_id;
  result := public.save_class_attendance('__test أ','2099-01-01',array[test_id],array[test_id],'{}');
  assert result = 1, 'save failed';
  result := public.save_class_attendance('__test أ','2099-01-01',array[test_id],array[test_id],array[test_id]);
  assert result = 1, 'idempotent save failed';
  begin
    perform public.save_class_attendance('__test أ','2099-01-01','{}',array[test_id],'{}');
    raise exception 'stale save was accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.save_class_attendance('__test أ','2099-01-01',array[test_id,-1],array[test_id],array[test_id]);
    raise exception 'invalid student was accepted';
  exception when serialization_failure then null;
  end;
  assert (select count(*) = 1 from public.attendance where student_id=test_id), 'failed save changed data';
  update public.students set class_name='__test ب' where id=test_id;
  perform public.save_class_attendance('__test أ','2099-01-01','{}','{}','{}');
  assert (select class_name='__test أ' from public.attendance where student_id=test_id), 'old class save erased history';
  perform public.save_class_attendance('__test ب','2099-01-01',array[test_id],array[test_id],array[test_id]);
  assert (select class_name='__test أ' from public.attendance where student_id=test_id), 'transfer rewrote historical class';
  update public.students set active=false where id=test_id;
  perform public.save_class_attendance('__test ب','2099-01-01','{}','{}','{}');
  assert (select count(*)=1 from public.attendance where student_id=test_id), 'removal erased history';
  update public.students set active=true where id=test_id;
  perform public.save_class_attendance('__test ب','2099-01-02',array[test_id],array[test_id],'{}');
  perform public.save_class_attendance('__test ب','2099-01-02','{}',array[test_id],array[test_id]);
  assert not exists(select 1 from public.attendance where student_id=test_id and attendance_date='2099-01-02'), 'correction failed';
  assert not has_function_privilege('anon','public.save_class_attendance(text,date,bigint[],bigint[],bigint[])','execute'), 'anon can execute';
  assert not has_function_privilege('authenticated','public.save_class_attendance(text,date,bigint[],bigint[],bigint[])','execute'), 'authenticated can execute';
  assert has_function_privilege('service_role','public.save_class_attendance(text,date,bigint[],bigint[],bigint[])','execute'), 'service role cannot execute';
end $$;
rollback;
