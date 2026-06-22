import { useState } from "react"
import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import type { Customer, CustomerTransaction } from "../types/api"

/**
 * Generates the customer account-statement PDF on demand.
 *
 * `@react-pdf/renderer` is large, so it is dynamically imported only when the
 * user clicks the button, keeping it out of CustomerDetailPage's initial chunk.
 */
export function CustomerStatementPdfButton({
  customer,
  rows,
}: {
  customer: Customer
  rows: CustomerTransaction[]
}) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const { Document, Page, Text, View, pdf } = await import("@react-pdf/renderer")
      const doc = (
        <Document>
          <Page size="A4">
            <View style={{ padding: 24 }}>
              <Text>كشف حساب: {customer.name}</Text>
              {rows.map((row) => (
                <Text key={row.id}>
                  {String(row.date).slice(0, 10)} - {row.type} - {row.runningBalance}
                </Text>
              ))}
            </View>
          </Page>
        </Document>
      )
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${customer.name}-statement.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: "تعذر إنشاء ملف PDF", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={loading}>
      {loading ? "جاري الإنشاء..." : "PDF"}
    </Button>
  )
}
