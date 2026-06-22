import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-slate-500">تم تجهيز المسار والLayout. سيتم بناء تفاصيل هذه الصفحة في الخطوات القادمة.</p>
      </CardContent>
    </Card>
  )
}
