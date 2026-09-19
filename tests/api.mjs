import assert from 'node:assert/strict';

// Read-only smoke tests against the real deployed function; no fixtures or student writes.
const endpoint = process.env.ATTENDANCE_API || 'https://lpskxevggdiwhtqgazvs.supabase.co/functions/v1/attendance-api';
let checks = 0;
async function request(payload, expected = 200) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, expected, `Unexpected status for ${payload.action}`);
  checks++;
  return response.json();
}
const { classes } = await request({ action: 'classes' });
assert.ok(classes.length > 0);
const { students } = await request({ action: 'students_admin' });
assert.equal(classes.reduce((sum, c) => sum + c.count, 0), students.filter(s => s.active).length);
for (const classInfo of classes) {
  const { students: roster } = await request({ action: 'students', className: classInfo.class_name });
  assert.equal(roster.length, classInfo.count);
  assert.ok(roster.every(s => s.active && s.class_name === classInfo.class_name));
}
const { dates } = await request({ action: 'dates' });
assert.deepEqual(dates, [...new Set(dates)].sort().reverse());
if (dates.length) {
  const day = dates[0];
  const { rows } = await request({ action: 'report', date: day });
  const legacy = await request({ action: 'report', from: day, to: day });
  assert.deepEqual(rows, legacy.rows);
  assert.ok(rows.length > 0 && rows.every(row => row.date === day));
  const className = rows[0].className;
  const filtered = await request({ action: 'report', date: day, className });
  assert.deepEqual(filtered.rows, rows.filter(row => row.className === className));
}
const { rows: top } = await request({ action: 'top_absent' });
assert.ok(top.length <= 20);
assert.ok(top.every((row, index) => index === 0 || top[index - 1].count >= row.count));
for (const row of top) {
  const history = await request({ action: 'student_history', studentId: row.studentId });
  assert.equal(row.className, history.student.class_name);
  assert.equal(row.count, history.rows.length);
  assert.deepEqual(history.rows.map(r => r.attendance_date), history.rows.map(r => r.attendance_date).sort().reverse());
}
await request({ action: 'day_attendance', className: classes[0].class_name, date: '2026-02-30' }, 400);
await request({ action: 'student_history', studentId: -1 }, 400);
await request({ action: 'student_add', name: ' ', className: classes[0].class_name }, 400);
await request({ action: 'unknown' }, 400);
console.log(`PASS: ${checks} real API requests; roster counts, single-date reports, current classes, history totals, validation.`);
