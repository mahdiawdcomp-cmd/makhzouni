package com.inventory.ui

import com.inventory.domain.model.Customer
import com.inventory.ui.invoices.InvoiceCreateUiState
import com.inventory.ui.operations.SalesOperationState
import org.junit.Assert.assertEquals
import org.junit.Test

class PartySuggestionFilterTest {
    private val customer = party("customer", isSupplier = false)
    private val supplier = party("supplier", isSupplier = true)

    @Test
    fun saleInvoiceSuggestsCustomersOnly() {
        val state = InvoiceCreateUiState(
            customers = listOf(customer, supplier),
            customerQuery = "party",
            invoiceType = "SALE",
        )

        assertEquals(listOf(customer.id), state.customerSuggestions.map { it.id })
    }

    @Test
    fun purchaseInvoiceSuggestsSuppliersOnly() {
        val state = InvoiceCreateUiState(
            customers = listOf(customer, supplier),
            customerQuery = "party",
            invoiceType = "PURCHASE",
        )

        assertEquals(listOf(supplier.id), state.customerSuggestions.map { it.id })
    }

    @Test
    fun posSuggestsCustomersOnly() {
        val state = SalesOperationState(
            customers = listOf(customer, supplier),
            customerQuery = "party",
        )

        assertEquals(listOf(customer.id), state.customerSuggestions.map { it.id })
    }

    private fun party(id: String, isSupplier: Boolean) = Customer(
        id = id,
        name = "party $id",
        phone = "964000$id",
        address = null,
        notes = null,
        openingBalance = 0.0,
        currentBalance = 0.0,
        isSupplier = isSupplier,
        lastTransactionAt = null,
        updatedAt = null,
    )
}
