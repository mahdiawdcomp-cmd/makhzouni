package com.inventory.domain.finance

import org.junit.Assert.assertEquals
import org.junit.Test

class FinancialCalculatorTest {
    @Test
    fun saleAddsOnlyRemainingAmount() {
        val result = calculateInvoiceFinancials(
            type = FinancialInvoiceType.SALE,
            subtotal = 250_000.0,
            discount = 20_000.0,
            requestedPaid = 100_000.0,
            previousBalance = 30_000.0,
        )

        assertEquals(230_000.0, result.totalAmount, 0.0)
        assertEquals(130_000.0, result.remainingAmount, 0.0)
        assertEquals(160_000.0, result.finalBalance, 0.0)
        assertEquals("PARTIAL", result.paymentType)
    }

    @Test
    fun purchaseAndReturnReduceCustomerBalance() {
        val purchase = calculateInvoiceFinancials(
            FinancialInvoiceType.PURCHASE,
            subtotal = 80_000.0,
            requestedPaid = 20_000.0,
            previousBalance = 10_000.0,
        )
        val salesReturn = calculateInvoiceFinancials(
            FinancialInvoiceType.SALES_RETURN,
            subtotal = 45_000.0,
            previousBalance = 100_000.0,
        )

        assertEquals(-50_000.0, purchase.finalBalance, 0.0)
        assertEquals(55_000.0, salesReturn.finalBalance, 0.0)
    }

    @Test
    fun overpaymentBecomesChangeNotNegativeDebt() {
        val result = calculateInvoiceFinancials(
            FinancialInvoiceType.SALE,
            subtotal = 50_000.0,
            requestedPaid = 70_000.0,
            previousBalance = 25_000.0,
        )

        assertEquals(50_000.0, result.paidAmount, 0.0)
        assertEquals(0.0, result.remainingAmount, 0.0)
        assertEquals(20_000.0, result.overpayment, 0.0)
        assertEquals(25_000.0, result.finalBalance, 0.0)
    }
}
