'use strict';

const API = 'https://lpskxevggdiwhtqgazvs.supabase.co/functions/v1/attendance-api';
const $ = id => document.getElementById(id);
const state = {
  mode: 'attendance', panel: 'reports', classes: [], students: [], studentsReady: false,
  currentClass: '', drafts: new Map(), rosterToken: 0, reportToken: 0, historyToken: 0,
  adminToken: 0, analyticsToken: 0, historyStudentId: null, saving: false, mutating: false, dialog: null,
};
const draftKey = 'school-attendance-drafts-v1';
const collator = new Intl.Collator('ar', { numeric: true });
const gradeNames = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
function schoolDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
const today = schoolDate();
function formatDate(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('ar-JO', { timeZone: 'Asia/Amman', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function normalize(value) { return value.normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim(); }
function grade(value) { return value.trim().replace(/\s+[أابجدهو]$/, ''); }
function sortClasses(a, b) {
  const ai = gradeNames.indexOf(grade(a)), bi = gradeNames.indexOf(grade(b));
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || collator.compare(a, b);
}
function message(text, kind = 'success') {
  $('message').textContent = text;
  $('message').className = `notice ${kind}`;
  $('message').hidden = !text;
}
async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }), signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('استجابة الخادم غير صالحة. حاول مرة أخرى.'); }
    if (!response.ok || data.error) {
      const error = new Error(data.error || 'تعذر إتمام الطلب');
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('انتهت مهلة الاتصال. قد يكون الطلب وصل؛ حدّث البيانات قبل إعادة العملية.');
    if (error instanceof TypeError) throw new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function run(task) { return Promise.resolve().then(task).catch(error => message(error.message, 'error')); }
function emptyRow(text, columns = 2) { return `<tr><td colspan="${columns}" class="empty">${esc(text)}</td></tr>`; }
function options(select, values, emptyLabel) {
  const previous = select.value;
  select.replaceChildren();
  if (emptyLabel !== undefined) select.add(new Option(emptyLabel, ''));
  values.forEach(value => select.add(new Option(value, value)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function classNames() { return state.classes.map(c => c.class_name).sort(sortClasses); }
function fillClassSelectors() {
  options($('studentClassFilter'), classNames());
  options($('newClass'), classNames());
}
function persistDrafts() {
  const entries = [...state.drafts].filter(([, draft]) => draft.changes.size)
    .map(([className, draft]) => [className, [...draft.changes]]);
  try { sessionStorage.setItem(draftKey, JSON.stringify({ date: today, entries })); }
  catch { /* Navigation still preserves drafts in memory if storage is unavailable. */ }
}
function restoreDrafts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (saved?.date !== today || !Array.isArray(saved.entries)) return;
    for (const [className, entries] of saved.entries) {
      if (typeof className !== 'string' || !Array.isArray(entries)) continue;
      const changes = new Map(entries.filter(pair => Array.isArray(pair) && Number.isSafeInteger(pair[0]) && typeof pair[1] === 'boolean'));
      state.drafts.set(className, { students: [], baseline: new Set(), locked: new Set(), changes, ready: false });
    }
  } catch { /* Corrupt or disabled browser storage must not block taking attendance. */ }
}
function currentDraft() { return state.drafts.get(state.currentClass); }
function selectedIds(draft) {
  return new Set(draft.students.filter(s => draft.locked.has(s.id) || (draft.changes.has(s.id) ? draft.changes.get(s.id) : draft.baseline.has(s.id))).map(s => s.id));
}
function renderClasses() {
  $('schoolSummary').textContent = `${state.classes.reduce((sum, c) => sum + c.count, 0)} طالبًا · ${state.classes.length} صفًا وشعبة`;
  $('classList').innerHTML = state.classes.length ? classNames().map(name => {
    const item = state.classes.find(c => c.class_name === name);
    const dirty = state.drafts.get(name)?.changes.size;
    return `<button class="class-card" data-class="${esc(name)}"><span class="class-symbol" aria-hidden="true">▤</span><strong>${esc(name)}</strong><span class="muted">${item.count} طالبًا</span><span class="arrow" aria-hidden="true">←</span>${dirty ? '<span class="draft-badge">تحديدات لم تُحفظ</span>' : ''}</button>`;
  }).join('') : '<p class="empty">لا توجد صفوف متاحة</p>';
}
async function loadClasses() {
  $('refreshClasses').disabled = true;
  try {
    const data = await api('classes');
    state.classes = data.classes;
    renderClasses();
    fillClassSelectors();
  } catch (error) {
    $('classList').innerHTML = '<p class="empty">تعذر تحميل الصفوف. اضغط «تحديث الصفوف» للمحاولة مجددًا.</p>';
    throw error;
  } finally { $('refreshClasses').disabled = false; }
}
async function openClass(className) {
  if (state.saving) return;
  state.currentClass = className;
  const token = ++state.rosterToken;
  $('classesScreen').hidden = true;
  $('studentsScreen').hidden = false;
  $('classTitle').textContent = className;
  $('rosterDate').textContent = formatDate(today);
  $('studentsList').innerHTML = '<p class="empty">جارٍ تحميل الطلاب والغياب المحفوظ…</p>';
  $('rosterStats').textContent = '';
  setRosterEnabled(false);
  let draft = state.drafts.get(className);
  if (draft) draft.ready = false;
  try {
    const [roster, attendance] = await Promise.all([
      api('students', { className }), api('day_attendance', { className, date: today }),
    ]);
    if (token !== state.rosterToken) return;
    const rosterIds = new Set(roster.students.map(s => s.id));
    const baseline = new Set(attendance.absentIds);
    const locked = new Set(attendance.lockedIds || []);
    const changes = new Map([...(draft?.changes || [])].filter(([id, absent]) => rosterIds.has(id) && !locked.has(id) && absent !== baseline.has(id)));
    draft = { students: roster.students, baseline, locked, changes, ready: true };
    state.drafts.set(className, draft);
    persistDrafts();
    renderRoster();
  } catch (error) {
    if (token !== state.rosterToken) return;
    $('studentsList').innerHTML = '<p class="empty">تعذر تحميل الكشف. اضغط «تحديث الكشف» لإعادة المحاولة.</p>';
    throw error;
  }
}
function setRosterEnabled(enabled) {
  for (const name of ['allPresent', 'allAbsent', 'saveAttendance']) $(name).disabled = !enabled;
  $('refreshRoster').disabled = state.saving;
  if (!enabled) { $('absentCount').textContent = 'الكشف غير جاهز للحفظ'; $('saveState').textContent = 'انتظر اكتمال تحميل بيانات الصف'; }
}
function renderRoster() {
  const draft = currentDraft();
  if (!draft?.ready) return;
  const selected = selectedIds(draft);
  const focusedId = document.activeElement?.dataset.studentId;
  $('studentsList').innerHTML = draft.students.length ? draft.students.map((student, index) => {
    const absent = selected.has(student.id), locked = draft.locked.has(student.id);
    return `<button class="student-row" data-student-id="${student.id}" aria-pressed="${absent}" ${state.saving || locked ? 'disabled' : ''}><span class="number">${index + 1}</span><span class="student-name">${esc(student.name)}${locked ? '<span class="locked-note">غياب اليوم محفوظ في شعبته السابقة</span>' : ''}</span><span class="attendance-mark">${absent ? '✕ غائب' : '✓ حاضر'}</span></button>`;
  }).join('') : '<p class="empty">لا يوجد طلاب حاليون في هذا الصف. يمكنك إضافة طالب من إدارة الصف.</p>';
  $('rosterStats').textContent = `${draft.students.length} طالبًا · ${draft.students.length - selected.size} حاضرًا · ${selected.size} غائبًا`;
  $('absentCount').textContent = `${selected.size} غائب`;
  $('saveState').textContent = draft.changes.size ? 'تحديدات لم تُحفظ — اضغط حفظ لتثبيتها' : 'الكشف مطابق للغياب المحفوظ';
  setRosterEnabled(!state.saving);
  if (state.saving) { $('absentCount').textContent = 'جارٍ الحفظ…'; $('saveState').textContent = 'انتظر تأكيد الحفظ'; }
  if (focusedId) $('studentsList').querySelector(`[data-student-id="${focusedId}"]`)?.focus({ preventScroll: true });
}
function changeAbsence(id, absent) {
  const draft = currentDraft();
  if (!draft?.ready || state.saving || draft.locked.has(id)) return;
  if (absent === draft.baseline.has(id)) draft.changes.delete(id);
  else draft.changes.set(id, absent);
}
function markAll(absent) {
  const draft = currentDraft();
  if (!draft?.ready || state.saving) return;
  draft.students.forEach(s => changeAbsence(s.id, absent));
  persistDrafts();
  renderRoster();
}
async function saveAttendance() {
  const draft = currentDraft(), className = state.currentClass;
  if (!draft?.ready || state.saving) return;
  if (schoolDate() !== today) throw new Error('بدأ يوم جديد. أعد تحميل الصفحة لفتح كشف اليوم الجديد. لم تُحفظ التحديدات القديمة بتاريخ جديد.');
  const absentIds = [...selectedIds(draft)];
  state.saving = true;
  renderRoster();
  try {
    const data = await api('save_attendance', { className, date: today, absentIds,
      rosterIds: draft.students.map(s => s.id), expectedAbsentIds: [...draft.baseline] });
    draft.baseline = new Set(absentIds);
    draft.changes.clear();
    persistDrafts();
    message(`تم حفظ غياب ${className} بنجاح — ${data.count} غائب.`);
  } catch (error) {
    message(error.message, error.status === 409 ? 'warning' : 'error');
  } finally {
    state.saving = false;
    renderRoster();
  }
}
function showClasses() {
  if (state.saving) return;
  ++state.rosterToken;
  $('studentsScreen').hidden = true;
  $('classesScreen').hidden = false;
  renderClasses();
  run(loadClasses);
}
async function showMode(mode, manageClass = false) {
  if (state.saving || state.mutating) return;
  state.mode = mode;
  $('attendanceView').hidden = mode !== 'attendance';
  $('adminView').hidden = mode !== 'admin';
  $('attendanceMode').setAttribute('aria-pressed', String(mode === 'attendance'));
  $('adminMode').setAttribute('aria-pressed', String(mode === 'admin'));
  if (mode === 'attendance') {
    if (state.currentClass) await openClass(state.currentClass);
    else await loadClasses();
  } else {
    if (manageClass) {
      $('studentSearch').value = '';
      fillClassSelectors();
      $('studentClassFilter').value = state.currentClass;
      $('newClass').value = state.currentClass;
    }
    await showPanel(manageClass ? 'students' : state.panel);
  }
}
async function showPanel(panel) {
  state.panel = panel;
  for (const name of ['reports', 'students', 'analytics']) $(`${name}Panel`).hidden = name !== panel;
  document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === panel)));
  if (panel === 'reports') await loadReportFilters();
  if (panel === 'students') await loadAdminStudents();
  if (panel === 'analytics') await loadAnalytics();
}
async function loadReportFilters() {
  const token = ++state.reportToken;
  $('printReport').disabled = true;
  $('dateFilter').disabled = true;
  $('classFilter').disabled = true;
  $('reportBody').innerHTML = emptyRow('جارٍ تحميل التواريخ…');
  try {
    const data = await api('dates');
    if (token !== state.reportToken) return;
    const previous = $('dateFilter').value;
    $('dateFilter').replaceChildren();
    data.dates.forEach(day => $('dateFilter').add(new Option(formatDate(day), day)));
    if (data.dates.includes(previous)) $('dateFilter').value = previous;
    if (!data.dates.length) $('dateFilter').add(new Option('لا يوجد غياب مسجل', ''));
    options($('classFilter'), [...new Set([...classNames(), ...(data.classes || [])])].sort(sortClasses), 'كل الصفوف');
    $('dateFilter').disabled = !data.dates.length;
    $('classFilter').disabled = false;
    await loadReport();
  } catch (error) {
    if (token !== state.reportToken) return;
    $('reportBody').innerHTML = emptyRow('تعذر التحميل. اضغط تبويب الغياب لإعادة المحاولة.');
    $('kpiCount').textContent = '—'; $('kpiClasses').textContent = '—';
    throw error;
  }
}
async function loadReport() {
  const token = ++state.reportToken;
  const date = $('dateFilter').value, className = $('classFilter').value;
  $('printReport').disabled = true;
  $('classesKpi').hidden = Boolean(className);
  $('kpiCount').textContent = '—'; $('kpiClasses').textContent = '—';
  $('reportBody').innerHTML = emptyRow('جارٍ تحديث التقرير…');
  try {
    const data = date ? await api('report', { date, from: date, to: date, className }) : { rows: [] };
    if (token !== state.reportToken) return;
    const rows = data.rows;
    $('reportBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.className)}</td></tr>`).join('') : emptyRow('لا يوجد غياب في هذا الاختيار');
    $('kpiCount').textContent = new Set(rows.map(row => row.studentId)).size;
    $('kpiClasses').textContent = new Set(rows.map(row => row.className)).size;
    $('printContext').textContent = `${date ? formatDate(date) : 'لا يوجد غياب مسجل'} · ${className || 'كل الصفوف'}`;
    $('printReport').disabled = !date;
  } catch (error) {
    if (token !== state.reportToken) return;
    $('reportBody').innerHTML = emptyRow('تعذر تحميل التقرير. غيّر الاختيار أو أعد فتح القسم للمحاولة.');
    throw error;
  }
}
async function loadAdminStudents() {
  const token = ++state.adminToken;
  state.studentsReady = false;
  $('adminStudents').innerHTML = '<p class="empty">جارٍ تحميل الطلاب…</p>';
  $('refreshAdmin').disabled = true;
  try {
    const data = await api('students_admin');
    if (token !== state.adminToken) return;
    state.students = data.students;
    state.studentsReady = true;
    updateClassCounts();
    renderAdminStudents();
    renderSuggestions();
  } catch (error) {
    if (token !== state.adminToken) return;
    $('adminStudents').innerHTML = '<p class="empty">تعذر التحميل. اضغط «تحديث الطلاب» لإعادة المحاولة.</p>';
    throw error;
  } finally { if (token === state.adminToken) $('refreshAdmin').disabled = false; }
}
function updateClassCounts() {
  const names = [...new Set([...classNames(), ...state.students.map(s => s.class_name)])];
  state.classes = names.map(class_name => ({ class_name, count: state.students.filter(s => s.active && s.class_name === class_name).length }));
  fillClassSelectors();
  renderClasses();
}
function renderAdminStudents() {
  if (!state.studentsReady) return;
  const className = $('studentClassFilter').value, query = normalize($('studentSearch').value);
  const rows = state.students.filter(s => s.active && s.class_name === className && normalize(s.name).includes(query)).sort((a, b) => collator.compare(a.name, b.name));
  $('adminCount').textContent = `${rows.length} طالبًا في ${className}`;
  $('adminStudents').innerHTML = rows.length ? rows.map(student => {
    const targets = classNames().filter(name => name !== student.class_name && grade(name) === grade(student.class_name));
    return `<article class="admin-student card" data-admin-id="${student.id}"><div><h3>${esc(student.name)}</h3><span class="badge">${esc(student.class_name)}</span></div><div class="transfer-actions">${targets.length ? `<select aria-label="نقل ${esc(student.name)} إلى" data-target="${student.id}">${targets.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select><button data-action="move" class="secondary">نقل</button>` : '<span class="muted">لا توجد شعبة أخرى لهذا الصف</span>'}</div><div class="actions"><button data-action="edit" class="secondary">تعديل الاسم</button><button data-action="remove" class="soft-red">إزالة</button></div></article>`;
  }).join('') : '<p class="empty">لا يوجد طلاب مطابقون للاختيار</p>';
}
function openStudentDialog(action, studentId) {
  if (state.mutating) return;
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;
  const target = action === 'move' ? $('adminStudents').querySelector(`[data-target="${studentId}"]`)?.value : null;
  if (action === 'move' && !target) return;
  state.dialog = { action, studentId, target };
  $('dialogTitle').textContent = { edit: 'تعديل اسم الطالب', move: 'نقل الطالب', remove: 'إزالة الطالب' }[action];
  $('dialogDescription').textContent = action === 'remove' ? `إزالة ${student.name} من القوائم الحالية؟ سيبقى سجل غيابه السابق محفوظًا.` : action === 'move' ? `نقل ${student.name} من ${student.class_name} إلى ${target}؟ سيبقى صف الغياب السابق كما سُجّل.` : 'صحّح الاسم ثم احفظ التعديل.';
  $('editNameLabel').hidden = action !== 'edit';
  $('editName').required = action === 'edit';
  $('editName').value = student.name;
  $('dialogError').textContent = '';
  $('confirmStudent').textContent = action === 'remove' ? 'تأكيد الإزالة' : 'حفظ';
  $('confirmStudent').className = action === 'remove' ? 'soft-red' : 'primary';
  $('studentDialog').showModal();
  if (action === 'edit') $('editName').focus();
}
function syncStudent(student) {
  const index = state.students.findIndex(s => s.id === student.id);
  if (index < 0) state.students.push(student); else state.students[index] = student;
  for (const [className, draft] of state.drafts) {
    if (!student.active || className !== student.class_name) draft.changes.delete(student.id);
  }
  persistDrafts();
  updateClassCounts();
  renderAdminStudents();
  renderSuggestions();
}
async function confirmStudent(event) {
  event.preventDefault();
  if (state.mutating || !state.dialog) return;
  const { action, studentId, target } = state.dialog;
  const patch = action === 'edit' ? { name: $('editName').value.trim() } : action === 'move' ? { className: target } : { active: false };
  if (action === 'edit' && !patch.name) { $('dialogError').textContent = 'اكتب اسمًا صحيحًا'; return; }
  state.mutating = true;
  $('confirmStudent').disabled = true; $('cancelDialog').disabled = true;
  try {
    const data = await api('student_update', { id: studentId, ...patch });
    syncStudent(data.student);
    $('studentDialog').close();
    message(action === 'move' ? `تم نقل ${data.student.name} إلى ${target}. اختر الشعبة الجديدة لعرضه.` : action === 'remove' ? 'تمت إزالة الطالب من القوائم الحالية مع حفظ تاريخه.' : 'تم حفظ الاسم.');
  } catch (error) { $('dialogError').textContent = error.message; }
  finally { state.mutating = false; $('confirmStudent').disabled = false; $('cancelDialog').disabled = false; }
}
async function addStudent(event) {
  event.preventDefault();
  if (state.mutating || !state.studentsReady) return;
  const name = $('newName').value.trim(), className = $('newClass').value;
  if (!name || !className) throw new Error('اسم الطالب والصف مطلوبان');
  state.mutating = true;
  $('addStudent').disabled = true;
  try {
    const data = await api('student_add', { name, className });
    $('studentSearch').value = '';
    $('studentClassFilter').value = className;
    syncStudent(data.student);
    $('newName').value = '';
    message(`تمت إضافة ${name} إلى ${className}.`);
  } finally { state.mutating = false; $('addStudent').disabled = false; }
}
async function loadAnalytics() {
  await Promise.all([run(loadAdminStudents), run(loadTopAbsent),
    state.historyStudentId ? run(() => loadStudentHistory(state.historyStudentId)) : Promise.resolve()]);
}
async function loadTopAbsent() {
  const token = ++state.analyticsToken;
  $('topAbsentBody').innerHTML = emptyRow('جارٍ تحميل الإحصائيات…', 3);
  try {
    const data = await api('top_absent');
    if (token !== state.analyticsToken) return;
    $('topAbsentBody').innerHTML = data.rows.length ? data.rows.map(row => `<tr><td><button class="text-button" data-history-id="${row.studentId}">${esc(row.name)}</button>${row.active === false ? '<span class="badge">أُزيل من القوائم</span>' : ''}</td><td>${esc(row.className)}</td><td><strong>${row.count}</strong></td></tr>`).join('') : emptyRow('لا يوجد غياب مسجل بعد', 3);
  } catch (error) {
    if (token !== state.analyticsToken) return;
    $('topAbsentBody').innerHTML = emptyRow('تعذر التحميل. اضغط تحديث للمحاولة.', 3);
    throw error;
  }
}
function renderSuggestions() {
  if (state.historyStudentId) { $('historySuggestions').replaceChildren(); return; }
  const query = normalize($('historySearch').value);
  if (!query) { $('historySuggestions').replaceChildren(); return; }
  if (!state.studentsReady) { $('historySuggestions').textContent = 'بيانات الطلاب غير جاهزة؛ اضغط تحديث.'; return; }
  const matches = state.students.filter(s => normalize(s.name).includes(query)).sort((a, b) => Number(b.active) - Number(a.active) || collator.compare(a.name, b.name)).slice(0, 8);
  $('historySuggestions').innerHTML = matches.length ? matches.map(student => `<button class="suggestion" data-history-id="${student.id}">${esc(student.name)}<small>${esc(student.class_name)}${student.active ? '' : ' · أُزيل من القوائم الحالية'}</small></button>`).join('') : '<p class="empty">لا يوجد طالب مطابق</p>';
}
async function loadStudentHistory(studentId) {
  state.historyStudentId = studentId;
  const token = ++state.historyToken;
  $('historySuggestions').replaceChildren();
  $('historySummary').hidden = true;
  $('historyBody').innerHTML = emptyRow('جارٍ تحميل سجل الطالب…');
  try {
    const data = await api('student_history', { studentId });
    if (token !== state.historyToken) return;
    $('historySearch').value = data.student.name;
    $('historySummary').innerHTML = `<strong>${esc(data.student.name)}</strong><p>${esc(data.student.class_name)}${data.student.active ? '' : ' · أُزيل من القوائم الحالية'}</p><p>مجموع مرات الغياب: <strong>${data.rows.length}</strong></p>`;
    $('historySummary').hidden = false;
    $('historyBody').innerHTML = data.rows.length ? data.rows.map(row => `<tr><td>${esc(formatDate(row.attendance_date))}</td><td>${esc(row.class_name)}</td></tr>`).join('') : emptyRow('لا يوجد غياب مسجل لهذا الطالب');
  } catch (error) {
    if (token !== state.historyToken) return;
    $('historyBody').innerHTML = emptyRow('تعذر تحميل السجل. اختر الطالب مجددًا للمحاولة.');
    throw error;
  }
}
function bindEvents() {
  $('attendanceMode').onclick = $('returnAttendance').onclick = () => run(() => showMode('attendance'));
  $('adminMode').onclick = () => run(() => showMode('admin'));
  $('manageClass').onclick = () => run(() => showMode('admin', true));
  $('refreshClasses').onclick = () => run(loadClasses);
  $('backClasses').onclick = showClasses;
  $('classList').onclick = event => { const button = event.target.closest('[data-class]'); if (button) run(() => openClass(button.dataset.class)); };
  $('studentsList').onclick = event => {
    const button = event.target.closest('[data-student-id]');
    if (!button || button.disabled) return;
    const id = Number(button.dataset.studentId);
    changeAbsence(id, !selectedIds(currentDraft()).has(id));
    persistDrafts(); renderRoster();
  };
  $('allPresent').onclick = () => markAll(false);
  $('allAbsent').onclick = () => markAll(true);
  $('saveAttendance').onclick = () => run(saveAttendance);
  $('refreshRoster').onclick = () => run(() => openClass(state.currentClass));
  document.querySelectorAll('[data-panel]').forEach(button => { button.onclick = () => run(() => showPanel(button.dataset.panel)); });
  $('dateFilter').onchange = $('classFilter').onchange = () => run(loadReport);
  $('printReport').onclick = () => window.print();
  $('studentClassFilter').onchange = () => { $('newClass').value = $('studentClassFilter').value; renderAdminStudents(); };
  $('studentSearch').oninput = renderAdminStudents;
  $('refreshAdmin').onclick = () => run(loadAdminStudents);
  $('addStudentForm').onsubmit = event => { event.preventDefault(); run(() => addStudent(event)); };
  $('adminStudents').onclick = event => {
    const button = event.target.closest('[data-action]');
    if (button) openStudentDialog(button.dataset.action, Number(button.closest('[data-admin-id]').dataset.adminId));
  };
  $('studentDialogForm').onsubmit = confirmStudent;
  $('cancelDialog').onclick = () => $('studentDialog').close();
  $('studentDialog').addEventListener('cancel', event => { if (state.mutating) event.preventDefault(); });
  $('refreshAnalytics').onclick = () => run(loadAnalytics);
  $('historySearch').oninput = () => {
    state.historyStudentId = null;
    ++state.historyToken;
    $('historySummary').hidden = true;
    $('historyBody').innerHTML = emptyRow('اختر طالبًا من نتائج البحث');
    renderSuggestions();
  };
  for (const container of ['historySuggestions', 'topAbsentBody']) $(container).onclick = event => {
    const button = event.target.closest('[data-history-id]');
    if (button) run(() => loadStudentHistory(Number(button.dataset.historyId)));
  };
  $('historySearch').onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); $('historySuggestions').querySelector('button')?.focus(); }
    if (event.key === 'Escape') $('historySuggestions').replaceChildren();
  };
  window.addEventListener('beforeunload', event => {
    if (state.saving || state.mutating || [...state.drafts.values()].some(draft => draft.changes.size)) { event.preventDefault(); event.returnValue = ''; }
  });
}
restoreDrafts();
bindEvents();
$('todayDate').textContent = formatDate(today);
$('todayDate').dateTime = today;
run(loadClasses);
