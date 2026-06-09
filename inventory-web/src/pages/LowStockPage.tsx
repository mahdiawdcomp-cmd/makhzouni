import { Link, useNavigate } from "react-router-dom"
import { ArrowRight, Printer, ScanQrCode } from "lucide-react"
import { useProducts } from "../hooks/useProducts"
import { productCartonSheetPdf, productPieceLabelPdf } from "../api/endpoints"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"

function stockOf(product: Product) {
  return product.currentStock ?? product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton
}

async function openBlob(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function LowStockPage() {
  const navigate = useNavigate()
  const { productsQuery } = useProducts()
  const rows = (productsQuery.data ?? []).filter((product) => stockOf(product) <= product.minStock)

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" className="mb-2 px-0" onClick={() => navigate(-1)}>
          <ArrowRight className="h-4 w-4" /> رجوع
        </Button>
        <h1 className="text-2xl font-bold">المخزون الناقص</h1>
        <p className="text-slate-500">منتجات نزل مخزونها للحد الأدنى أو أقل.</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            لا يوجد منتجات ناقصة حالياً. كل المخزون فوق الحد الأدنى ✓
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((product) => (
            <Card key={product.id} className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>الكمية الحالية: <span className="font-bold">{stockOf(product)}</span> / الحد الأدنى: {product.minStock}</p>
                <p>رقم الآيتم: {product.itemNumber}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link to={`/inventory/${product.id}`}>عرض التفاصيل</Link>
                  </Button>
                  <Button variant="outline" onClick={async () => openBlob(await productPieceLabelPdf(product.id))}>
                    <ScanQrCode className="h-4 w-4" /> QR قطعة
                  </Button>
                  <Button variant="outline" onClick={async () => openBlob(await productCartonSheetPdf(product.id))}>
                    <Printer className="h-4 w-4" /> QR كرتون
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
