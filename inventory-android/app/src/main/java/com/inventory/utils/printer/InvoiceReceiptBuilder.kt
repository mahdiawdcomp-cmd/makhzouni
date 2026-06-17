package com.inventory.utils.printer

import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InvoiceItem
import java.nio.charset.Charset

class InvoiceReceiptBuilder {
    private val output = mutableListOf<Byte>()
    // For Arabic support in ESC/POS printers, standard is usually CP864 or CP1256.
    // Some printers use standard UTF-8 if properly configured.
    private val charset = Charset.forName("UTF-8")

    fun build(invoice: Invoice, storeName: String = "المخزن"): ByteArray {
        reset()
        alignCenter()
        boldOn()
        textLine(storeName)
        textLine("فاتورة مبيعات")
        boldOff()
        textLine("------------------------------")
        
        alignLeft()
        textLine("رقم الفاتورة: ${invoice.invoiceNumber}")
        textLine("الزبون: ${invoice.customerName}")
        textLine("التاريخ: ${invoice.date}")
        textLine("------------------------------")
        
        // Items header
        text("المنتج")
        addSpaces(10)
        text("الكمية")
        addSpaces(4)
        textLine("المبلغ")
        textLine("------------------------------")
        
        // Items
        invoice.items.forEach { item ->
            val itemName = item.productName.take(15).padEnd(15)
            val qtyStr = "${item.quantity}".padEnd(6)
            val priceStr = "${item.totalPrice}"
            
            textLine("$itemName $qtyStr $priceStr")
        }
        
        textLine("------------------------------")
        alignRight()
        textLine("الإجمالي: ${invoice.totalAmount}")
        textLine("الواصل: ${invoice.paidAmount}")
        boldOn()
        textLine("المتبقي: ${invoice.remainingAmount}")
        boldOff()
        textLine("------------------------------")
        alignCenter()
        textLine("شكراً لتعاملكم معنا")
        
        feedLines(3)
        cutPaper()
        
        return output.toByteArray()
    }

    private fun reset() {
        output.add(0x1B)
        output.add(0x40)
    }

    private fun alignCenter() {
        output.add(0x1B)
        output.add(0x61)
        output.add(0x01)
    }

    private fun alignLeft() {
        output.add(0x1B)
        output.add(0x61)
        output.add(0x00)
    }

    private fun alignRight() {
        output.add(0x1B)
        output.add(0x61)
        output.add(0x02)
    }

    private fun boldOn() {
        output.add(0x1B)
        output.add(0x45)
        output.add(0x01)
    }

    private fun boldOff() {
        output.add(0x1B)
        output.add(0x45)
        output.add(0x00)
    }

    private fun text(str: String) {
        val bytes = str.toByteArray(charset)
        output.addAll(bytes.toList())
    }

    private fun textLine(str: String) {
        text(str)
        output.add(0x0A) // LF
    }

    private fun addSpaces(count: Int) {
        for (i in 0 until count) {
            output.add(0x20) // Space
        }
    }

    private fun feedLines(lines: Int) {
        output.add(0x1B)
        output.add(0x64)
        output.add(lines.toByte())
    }

    private fun cutPaper() {
        output.add(0x1D)
        output.add(0x56)
        output.add(0x41)
        output.add(0x03)
    }
}
