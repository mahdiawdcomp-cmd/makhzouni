import { useParams } from "react-router-dom"
import { InvoiceCreatePage } from "./InvoiceCreatePage"

/**
 * Full-page invoice editor — SAME component/UX as the create page, in edit
 * mode: loads the invoice, saves via PUT, and disables create-only extras
 * (tabs, drafts/autosave, coupon, walk-in, WhatsApp prompt, PDF/image export).
 * key={id} remounts the form when navigating between different invoices.
 */
export function InvoiceEditPage() {
  const { id } = useParams<{ id: string }>()
  return <InvoiceCreatePage key={id} editId={id} />
}

export default InvoiceEditPage
