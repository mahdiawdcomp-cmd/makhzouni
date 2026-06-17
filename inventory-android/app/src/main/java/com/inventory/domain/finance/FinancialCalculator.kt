package com.inventory.domain.finance

import kotlin.math.round

enum class FinancialInvoiceType { SALE, PURCHASE, SALES_RETURN }

data class InvoiceFinancials(
    val subtotal: Double,
    val discount: Double,
    val tax: Double,
    val totalAmount: Double,
    val paidAmount: Double,
    val remainingAmount: Double,
    val balanceDelta: Double,
    val finalBalance: Double,
    val paymentType: String,
    val overpayment: Double,
)

fun Double.roundMoney(): Double = if (isFinite()) round(this * 100.0) / 100.0 else 0.0

fun calculateInvoiceFinancials(
    type: FinancialInvoiceType,
    subtotal: Double,
    discount: Double = 0.0,
    tax: Double = 0.0,
    requestedPaid: Double = 0.0,
    previousBalance: Double = 0.0,
): InvoiceFinancials {
    val safeSubtotal = subtotal.coerceAtLeast(0.0).roundMoney()
    val safeDiscount = discount.coerceAtLeast(0.0).roundMoney()
    val safeTax = tax.coerceAtLeast(0.0).roundMoney()
    val total = (safeSubtotal - safeDiscount + safeTax).roundMoney()
    val safeRequestedPaid = requestedPaid.coerceAtLeast(0.0).roundMoney()
    val paid = minOf(safeRequestedPaid, total.coerceAtLeast(0.0)).roundMoney()
    val overpayment = (safeRequestedPaid - total.coerceAtLeast(0.0)).coerceAtLeast(0.0).roundMoney()
    val remaining = (total - paid).coerceAtLeast(0.0).roundMoney()
    val sign = if (type == FinancialInvoiceType.SALE) 1.0 else -1.0
    val delta = (sign * remaining).roundMoney()

    return InvoiceFinancials(
        subtotal = safeSubtotal,
        discount = safeDiscount,
        tax = safeTax,
        totalAmount = total,
        paidAmount = paid,
        remainingAmount = remaining,
        balanceDelta = delta,
        finalBalance = (previousBalance + delta).roundMoney(),
        paymentType = when {
            remaining <= 0.0 -> "CASH"
            paid > 0.0 -> "PARTIAL"
            else -> "CREDIT"
        },
        overpayment = overpayment,
    )
}
