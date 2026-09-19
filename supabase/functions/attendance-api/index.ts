import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Existing school classes from the previous administration page. Keep empty sections available.
const schoolClasses = ["الثاني", "الثالث", "الرابع أ", "الرابع ب", "الخامس أ", "الخامس ب", "الخامس ج", "السادس أ", "السادس ب", "السادس ج", "السابع أ", "السابع ب", "السابع ج", "الثامن أ", "الثامن ب", "الثامن ج"];
const studentColumns = "id,name,class_name,active";
class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
  } });
}
function text(value: unknown, label: string, max = 150): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new InputError(`${label} غير صحيح`);
  }
  return value.trim();
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InputError("رقم الطالب غير صحيح");
  }
  return value;
}
function ids(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 2000) throw new InputError("قائمة الطلاب غير صحيحة");
  return [...new Set(value.map(id))];
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError("التاريخ غير صحيح");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new InputError("التاريخ غير صحيح");
  return value;
}
function grade(className: string): string { return className.trim().replace(/\s+[أابجدهو]$/, ""); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 64000) throw new InputError("الطلب أكبر من المسموح", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new InputError("صيغة الطلب غير صحيحة"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("صيغة الطلب غير صحيحة");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys.default;
    if (!secretKey) throw new Error("Supabase secret key is unavailable");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Page explicitly: Supabase's default row limit must not truncate dates or totals.
    async function allRows(makeQuery: () => any): Promise<any[]> {
      const rows: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await makeQuery().range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) return rows;
      }
    }
    async function knownClasses(): Promise<string[]> {
      const rows = await allRows(() => supabase.from("students").select("class_name").order("id"));
      return [...new Set([...schoolClasses, ...rows.map(s => s.class_name)])];
    }
    const action = body.action;
    if (action === "classes") {
      const rows = await allRows(() => supabase.from("students").select(studentColumns).order("id"));
      const counts = new Map<string, number>(schoolClasses.map(c => [c, 0]));
      for (const s of rows) counts.set(s.class_name, (counts.get(s.class_name) ?? 0) + (s.active ? 1 : 0));
      return json({ classes: [...counts].map(([class_name, count]) => ({ class_name, count })) });
    }
    if (action === "students" || action === "students_admin") {
      const className = action === "students" ? text(body.className, "الصف", 60) : null;
      const students = await allRows(() => {
        let query = supabase.from("students").select(studentColumns).order("id");
        if (className) query = query.eq("active", true).eq("class_name", className);
        return query;
      });
      return json({ students });
    }
    if (action === "day_attendance") {
      const className = text(body.className, "الصف", 60);
      const day = date(body.date);
      const rows = await allRows(() => supabase.from("attendance")
        .select("student_id,class_name,students!inner(class_name,active)")
        .eq("attendance_date", day).eq("students.class_name", className).eq("students.active", true).order("id"));
      return json({ absentIds: rows.map(r => r.student_id), lockedIds: rows.filter(r => r.class_name !== className).map(r => r.student_id) });
    }
    if (action === "save_attendance") {
      const { data, error } = await supabase.rpc("save_class_attendance", {
        p_class_name: text(body.className, "الصف", 60), p_date: date(body.date),
        p_absent_ids: ids(body.absentIds),
        p_roster_ids: body.rosterIds === undefined ? null : ids(body.rosterIds),
        p_expected_absent_ids: body.expectedAbsentIds === undefined ? null : ids(body.expectedAbsentIds),
      });
      if (error?.code === "40001") throw new InputError("تغيرت بيانات الصف أو الغياب. اضغط تحديث الكشف ثم راجع اختياراتك وأعد الحفظ.", 409);
      if (error) throw error;
      return json({ ok: true, count: data });
    }
    if (action === "report") {
      // Keep the previous frontend compatible while the single-page UI is deployed.
      const from = date(body.date ?? body.from);
      const to = date(body.date ?? body.to ?? from);
      const className = body.className ? text(body.className, "الصف", 60) : "";
      const rows = await allRows(() => {
        let query = supabase.from("attendance")
          .select("id,attendance_date,class_name,status,student_id,students(name)")
          .eq("status", "absent").gte("attendance_date", from).lte("attendance_date", to)
          .order("attendance_date", { ascending: false }).order("class_name").order("id");
        if (className) query = query.eq("class_name", className);
        return query;
      });
      return json({ rows: rows.map(r => ({ id: r.id, date: r.attendance_date, className: r.class_name, status: r.status, studentId: r.student_id, name: r.students?.name ?? "" })) });
    }
    if (action === "dates") {
      const rows = await allRows(() => supabase.from("attendance").select("attendance_date,class_name")
        .eq("status", "absent").order("attendance_date", { ascending: false }).order("id"));
      return json({ dates: [...new Set(rows.map(r => r.attendance_date))], classes: [...new Set(rows.map(r => r.class_name))] });
    }
    if (action === "top_absent") {
      const rows = await allRows(() => supabase.from("attendance").select("student_id,students(name,class_name,active)").eq("status", "absent").order("id"));
      const aggregate = new Map<number, any>();
      for (const row of rows) {
        const entry = aggregate.get(row.student_id) ?? {
          studentId: row.student_id, name: row.students?.name ?? "", className: row.students?.class_name ?? "",
          active: row.students?.active ?? false, count: 0,
        };
        entry.count++;
        aggregate.set(row.student_id, entry);
      }
      return json({ rows: [...aggregate.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar")).slice(0, 20) });
    }
    if (action === "student_history") {
      const studentId = id(body.studentId);
      const [{ data: student, error }, rows] = await Promise.all([
        supabase.from("students").select(studentColumns).eq("id", studentId).single(),
        allRows(() => supabase.from("attendance").select("attendance_date,class_name,status")
          .eq("student_id", studentId).eq("status", "absent").order("attendance_date", { ascending: false }).order("id")),
      ]);
      if (error?.code === "PGRST116") throw new InputError("الطالب غير موجود", 404);
      if (error) throw error;
      return json({ student, rows });
    }
    if (action === "student_add") {
      const name = text(body.name, "الاسم");
      const className = text(body.className, "الصف", 60);
      if (!(await knownClasses()).includes(className)) throw new InputError("الصف غير موجود");
      const { data, error } = await supabase.from("students").insert({ name, class_name: className, active: true }).select(studentColumns).single();
      if (error) throw error;
      return json({ student: data });
    }
    if (action === "student_update") {
      const studentId = id(body.id);
      const { data: original, error: readError } = await supabase.from("students").select(studentColumns).eq("id", studentId).single();
      if (readError?.code === "PGRST116") throw new InputError("الطالب غير موجود", 404);
      if (readError) throw readError;
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = text(body.name, "الاسم");
      if (body.className !== undefined) {
        const target = text(body.className, "الصف", 60);
        if (grade(target) !== grade(original.class_name) || !(await knownClasses()).includes(target)) {
          throw new InputError("النقل متاح بين شعب الصف نفسه فقط");
        }
        patch.class_name = target;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") throw new InputError("حالة الطالب غير صحيحة");
        patch.active = body.active;
      }
      if (!Object.keys(patch).length) throw new InputError("لا توجد بيانات للتعديل");
      patch.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from("students").update(patch).eq("id", studentId)
        .eq("class_name", original.class_name).select(studentColumns).maybeSingle();
      if (error) throw error;
      if (!data) throw new InputError("تغير صف الطالب؛ حدّث القائمة وحاول مجددًا", 409);
      return json({ student: data });
    }
    throw new InputError("عملية غير معروفة");
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, error.status);
    console.error("attendance-api failed", error);
    return json({ error: "تعذر إتمام العملية. حاول مرة أخرى." }, 500);
  }
});
