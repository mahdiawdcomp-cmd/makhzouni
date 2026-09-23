import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getCatalogFunnel } from "../../api/catalogExperience"

const labels = ["فتح الكتلوك", "مشاهدة منتج", "إضافة للسلة", "بدء إرسال الطلب", "طلب ناجح"]
export function CatalogFunnel() {
  const [days, setDays] = useState(30)
  const query = useQuery({ queryKey: ["catalog-funnel", days], queryFn: () => getCatalogFunnel(days), staleTime: 60_000, retry: false })
  const stages = query.data?.stages ?? [0, 0, 0, 0, 0]
  const max = Math.max(1, ...stages)
  return <section dir="rtl" className="rounded-2xl border bg-white p-4" aria-label="قمع الكتلوك">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-bold text-slate-900">من زيارة الكتلوك إلى الطلب</h3>
      <select aria-label="فترة القمع" value={days} onChange={e => setDays(Number(e.target.value))} className="min-h-11 rounded-xl border px-3">
        {[7, 30, 90].map(n => <option key={n} value={n}>آخر {n} يوم</option>)}
      </select>
    </div>
    {query.isLoading ? <p role="status">جاري تحميل القمع…</p> : query.isError ? <button onClick={() => void query.refetch()}>تعذر تحميل القمع — إعادة المحاولة</button> : <>
      <ol className="space-y-3">{labels.map((label, i) => <li key={label}>
        <div className="mb-1 flex justify-between gap-2 text-sm"><span>{label}</span><span className="font-bold">{stages[i]} جلسة</span></div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${stages[i] / max * 100}%` }} /></div>
        {i > 0 && stages[i - 1] > 0 && <p className="mt-1 text-xs text-slate-500">وصل {Math.round(100 * stages[i] / stages[i - 1])}% من المرحلة السابقة؛ لم يكمل {stages[i - 1] - stages[i]} جلسة لهذه المرحلة.</p>}
      </li>)}</ol>
      <p className="mt-4 font-bold text-emerald-700">تحويل المسار الكامل إلى طلب: {stages[0] ? (100 * stages[4] / stages[0]).toFixed(1) : "0"}%</p>
      <p className="mt-2 text-sm">إجمالي جلسات الطلب الناجح: {query.data?.successfulSessions ?? 0}؛ منها {query.data?.incompletePathOrders ?? 0} خارج المسار الكامل (مثلاً سلة محفوظة أو تتبع غير مكتمل).</p>
      <p className="mt-2 text-xs leading-6 text-slate-500">القمع يحسب الجلسات التي مرّت بالمراحل السابقة، مرة لكل جلسة تصفح (تنتهي بعد 30 دقيقة خمول)، وليس عدد النقرات. الطلب الناجح يعني حُفظ طلبه بانتظار موافقة المحل، وليس فاتورة مدفوعة. يبدأ القياس من تفعيل هذه الميزة؛ منع التتبع أو انقطاع الشبكة قد ينقص الأرقام.</p>
    </>}
  </section>
}
